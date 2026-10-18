pub mod frame;
pub mod note;
pub mod tray;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::frame::{Placement, Rect};
use crate::note::{DEFAULT_HEIGHT, DEFAULT_WIDTH, MIN_HEIGHT, MIN_WIDTH, Note};

/// 窗口当前应当采用的 frame。展开尺寸先抬到手动缩放下限：窗口层只约束以后的手动缩放，
/// 旧文档里已经被拖到很小的尺寸要靠这里补回来，否则那张便签会一直小到没法用。
fn window_frame(note: &Note) -> Rect {
    frame::at_least(note.frame, MIN_WIDTH, MIN_HEIGHT)
}

/// 物理坐标换算成文档用的逻辑坐标。
fn logical_rect(
    position: tauri::PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
    scale: f64,
) -> Rect {
    let position = position.to_logical::<f64>(scale);
    let size = size.to_logical::<f64>(scale);
    Rect::new(position.x, position.y, size.width, size.height)
}

/// 窗口位置写盘的节流：一次拖动里 Moved/Resized 会连着来几十次。
/// shortcut: 只在起始处节流，快速拖动后立刻强杀进程仍可能丢掉最后一次移动；
/// 便签数量或文档体量上来后再改成停止后再写一次。
#[derive(Default)]
struct FrameWrites(Mutex<HashMap<String, Instant>>);

const FRAME_WRITE_INTERVAL: Duration = Duration::from_millis(500);

fn frame_write_allowed<R: Runtime>(app: &AppHandle<R>, label: &str) -> bool {
    let Some(state) = app.try_state::<FrameWrites>() else {
        return false;
    };
    let Ok(mut writes) = state.0.lock() else {
        return false;
    };
    let now = Instant::now();
    let due = writes
        .get(label)
        .is_none_or(|last| now.duration_since(*last) >= FRAME_WRITE_INTERVAL);
    if due {
        writes.insert(label.to_string(), now);
    }
    due
}

/// 把窗口当前的位置与尺寸写回文档。没有变化时不写。
fn save_frame(dir: &Path, label: &str, rect: Rect) {
    let Ok(mut note) = note::load(dir, label) else {
        return;
    };
    if note.frame == rect {
        return;
    }
    note.frame = rect;
    if let Err(err) = note::save(dir, &note) {
        eprintln!("便签 {label} 保存位置失败: {err}");
    }
}

/// 单个显示器的可见区域，换算成逻辑坐标，与文档里的 frame 同一套单位。
/// 取 work area，避开菜单栏和 Dock。
fn monitor_rect(monitor: &tauri::Monitor) -> Rect {
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let position = area.position.to_logical::<f64>(scale);
    let size = area.size.to_logical::<f64>(scale);
    Rect::new(position.x, position.y, size.width, size.height)
}

/// 当前显示器的可见区域列表。
///
/// `available_monitors` 在 macOS 上取自 `CGDisplay::active_displays`，这个列表可能为空
/// （本机就是：active 为 0，online 为 2）。这时用主显示器兜底，否则窗口位置无从校验。
fn monitor_rects<R: Runtime>(app: &AppHandle<R>) -> Vec<Rect> {
    let mut monitors = app.available_monitors().unwrap_or_default();
    if monitors.is_empty()
        && let Ok(Some(primary)) = app.primary_monitor()
    {
        monitors.push(primary);
    }
    monitors.iter().map(monitor_rect).collect()
}

/// 打开窗口前要用的 frame：文档描述的位置不在任何可见显示器内时落到可见工作区。
fn visible_frame(note: &Note, monitors: &[Rect]) -> Rect {
    frame::fit(window_frame(note), monitors)
}
/// 窗口当前的位置与尺寸，换算成逻辑坐标，与文档里的 frame 同一套单位。
fn live_frame<R: Runtime>(window: &WebviewWindow<R>) -> Result<Rect, String> {
    let scale = window.scale_factor().map_err(|err| err.to_string())?;
    let position = window.outer_position().map_err(|err| err.to_string())?;
    let size = window.inner_size().map_err(|err| err.to_string())?;
    Ok(logical_rect(position, size, scale))
}

/// 把文档描述的状态和给定 frame 应用到窗口。置顶、尺寸和位置都取自文档，
/// 半透明不在这里做：它是内容 CSS opacity，由前端读 `translucent` 决定。
fn apply_window_state<R: Runtime>(
    window: &WebviewWindow<R>,
    note: &Note,
    frame: Rect,
) -> Result<(), String> {
    window
        .set_always_on_top(note.pinned)
        .map_err(|err| err.to_string())?;
    // 手动缩放下限必须在 set_size 之前设，否则目标尺寸先被旧下限挡一次。
    window
        .set_min_size(Some(LogicalSize::new(MIN_WIDTH, MIN_HEIGHT)))
        .map_err(|err| err.to_string())?;
    window
        .set_size(LogicalSize::new(frame.width, frame.height))
        .map_err(|err| err.to_string())?;
    window
        .set_position(LogicalPosition::new(frame.x, frame.y))
        .map_err(|err| err.to_string())?;
    Ok(())
}
/// 便签目录。macOS 上是 `~/Library/Application Support/<identifier>/notes`。
fn notes_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("notes"))
        .map_err(|err| err.to_string())
}

/// 便签窗口的入口。窗口只渲染查询参数指到的那份文档。
fn note_url(id: &str) -> WebviewUrl {
    WebviewUrl::App(format!("index.html?note={id}").into())
}

/// 菜单窗口的入口。菜单活在独立窗口里，便签再小也裁不到它。
fn menu_url(id: &str) -> WebviewUrl {
    WebviewUrl::App(format!("index.html?menu={id}").into())
}

/// 菜单窗口 label 前缀。它同时是「这个窗口是不是菜单」的判据。
pub(crate) const MENU_LABEL_PREFIX: &str = "menu-";

/// 菜单窗口的初始尺寸：卡片四周留 16px 给 CSS 阴影，并给菜单内容留出首次渲染余量。
/// shortcut: 这 16px 是 note-menu.css 里 `.menu-window #root` 的 padding，两边要一致；
/// 卡片靠这个内缩量和按钮错开，改一处要改两处。
/// 初始高度必须覆盖完整菜单，否则窗口还没完成前端实测收窄时，字体子菜单会被底部裁掉。
/// 卡片渲染后 NoteMenuWindow 会按实测高度收窄；二级菜单展开时再按实际矩形变宽。
/// 宽度是二级菜单收起来时的宽度，展开宽度由 NoteMenuWindow 根据卡片和子菜单矩形计算。
const MENU_WINDOW_WIDTH: f64 = 240.0;
const MENU_WINDOW_HEIGHT: f64 = 480.0;

/// 触发按钮的边长，前端 `NoteMenu` 的按钮就是 18×18。
/// shortcut: 必须与 NoteMenu.tsx 的 size-[18px] 一致，改一处要改两处。
const MENU_ANCHOR_SIZE: f64 = 18.0;

/// 触发按钮在便签视口里的位置，CSS 像素。前端量出来交给窗口层换算屏幕坐标。
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuAnchor {
    /// 按钮右边缘。
    pub right: f64,
    /// 按钮下边缘。
    pub bottom: f64,
}

/// 菜单左上角在屏幕上的逻辑坐标。默认贴在按钮右下，放不下就往左上翻。
fn menu_origin<R: Runtime>(note_window: &WebviewWindow<R>, anchor: MenuAnchor) -> Result<(f64, f64), String> {
    let scale = note_window.scale_factor().map_err(|err| err.to_string())?;
    let origin = note_window
        .outer_position()
        .map_err(|err| err.to_string())?
        .to_logical::<f64>(scale);
    // 窗口从按钮右下角开始排。卡片在窗口里内缩 16px 阴影留白，所以卡片看起来离按钮
    // 16px；反过来提前留白会让窗口的透明区压住按钮 —— 指针落在按钮上却被菜单窗口
    // 吃掉，按钮既收不到 hover 也点不到，「再点一次收起」就没法做。
    let mut x = origin.x + anchor.right;
    let mut y = origin.y + anchor.bottom;

    if let Ok(Some(monitor)) = note_window.current_monitor() {
        let monitor_scale = monitor.scale_factor();
        let area = monitor.work_area();
        let area_pos = area.position.to_logical::<f64>(monitor_scale);
        let area_size = area.size.to_logical::<f64>(monitor_scale);
        let max_x = area_pos.x + area_size.width;
        let max_y = area_pos.y + area_size.height;
        if x + MENU_WINDOW_WIDTH > max_x {
            // 翻到按钮左边，并让开按钮本身的宽度，保证不压住按钮。
            x = (origin.x + anchor.right - MENU_ANCHOR_SIZE - MENU_WINDOW_WIDTH).max(area_pos.x);
        }
        if y + MENU_WINDOW_HEIGHT > max_y {
            y = (max_y - MENU_WINDOW_HEIGHT).max(area_pos.y);
        }
    }
    Ok((x, y))
}

/// 打开便签的菜单窗口。菜单是便签的子窗口：跟随移动、层级在它之上，
/// 便签关掉时一起消失。
fn open_menu<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    anchor: MenuAnchor,
) -> Result<(), String> {
    let label = format!("{MENU_LABEL_PREFIX}{id}");
    if let Some(existing) = app.get_webview_window(&label) {
        existing.close().map_err(|err| err.to_string())?;
    }
    let note_window = app
        .get_webview_window(id)
        .ok_or_else(|| format!("便签 {id} 没有打开的窗口"))?;
    let (x, y) = menu_origin(&note_window, anchor)?;
    WebviewWindowBuilder::new(app, &label, menu_url(id))
        .title("")
        .inner_size(MENU_WINDOW_WIDTH, MENU_WINDOW_HEIGHT)
        .position(x, y)
        .decorations(false)
        // 菜单自带 CSS 阴影，窗口本身不投影，否则会出现一圈方形阴影。
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .parent(&note_window)
        .map_err(|err| err.to_string())?
        .build()
        .map_err(|err| err.to_string())?;
    Ok(())
}

/// 用给定 frame 显示一张便签。窗口 label 就是文档 uuid，已经存在时复用，不创建第二个。
fn show_at<R: Runtime>(
    app: &AppHandle<R>,
    note: &Note,
    frame: Rect,
) -> Result<WebviewWindow<R>, String> {
    if let Some(window) = app.get_webview_window(&note.id) {
        return Ok(window);
    }
    let window = WebviewWindowBuilder::new(app, &note.id, note_url(&note.id))
        .title(&note.title)
        .inner_size(frame.width, frame.height)
        .position(frame.x, frame.y)
        .decorations(false)
        // 圆角要露出桌面，窗口本身必须透明；透明窗口没有原生投影，补回阴影。
        .transparent(true)
        .shadow(true)
        .build()
        .map_err(|err| err.to_string())?;
    apply_window_state(&window, note, frame)?;

    Ok(window)
}

/// 显示一张便签。打开前先把保存的位置校正到当前可见区域。
fn show<R: Runtime>(app: &AppHandle<R>, note: &Note) -> Result<WebviewWindow<R>, String> {
    let frame = visible_frame(note, &monitor_rects(app));
    show_at(app, note, frame)
}

/// 隐藏一张便签：关掉窗口，文档留在磁盘上。
fn hide<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<(), String> {
    match app.get_webview_window(id) {
        Some(window) => window.close().map_err(|err| err.to_string()),
        None => Ok(()),
    }
}

/// 打开一份已保存文档。先读完整校验，通过后、且文档可见时才创建窗口。
/// 读失败时不会出现窗口，也不会回写文件。
fn open<R: Runtime>(app: &AppHandle<R>, dir: &Path, id: &str) -> Result<(), String> {
    let note = note::load(dir, id).map_err(|err| err.to_string())?;
    if !note.visible {
        return Ok(());
    }
    show(app, &note).map(|_| ())
}

/// 启动时恢复全部可见便签。坏文档单独跳过，不影响其他便签。
fn restore_visible<R: Runtime>(app: &AppHandle<R>, dir: &Path) {
    let ids = match note::list_ids(dir) {
        Ok(ids) => ids,
        Err(err) => {
            eprintln!("读取便签目录失败: {err}");
            return;
        }
    };
    for id in ids {
        if let Err(err) = open(app, dir, &id) {
            eprintln!("便签 {id} 无法打开: {err}");
        }
    }
}

/// 新建一张便签并显示。默认位置先给一个固定值，打开前由 `frame::fit` 校正到可见区域。
fn create<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let dir = notes_dir(app)?;
    let id = uuid::Uuid::new_v4().to_string();
    let note = Note::new(
        id.clone(),
        Rect::new(40.0, 40.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
    );
    note::save(&dir, &note).map_err(|err| err.to_string())?;
    show(app, &note)?;
    Ok(id)
}

#[tauri::command]
fn new_note<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    create(&app)
}

/// 写入置顶状态并应用到窗口。文档是唯一事实来源，所以重启后仍然保持。
fn save_pinned<R: Runtime>(
    app: &AppHandle<R>,
    dir: &Path,
    id: &str,
    pinned: bool,
) -> Result<Note, String> {
    let mut note = note::load(dir, id).map_err(|err| err.to_string())?;
    note.pinned = pinned;
    note::save(dir, &note).map_err(|err| err.to_string())?;
    if let Some(window) = app.get_webview_window(id) {
        window
            .set_always_on_top(pinned)
            .map_err(|err| err.to_string())?;
    }
    Ok(note)
}

#[tauri::command]
fn set_pinned<R: Runtime>(app: AppHandle<R>, id: String, pinned: bool) -> Result<Note, String> {
    let dir = notes_dir(&app)?;
    save_pinned(&app, &dir, &id, pinned)
}

/// 读取一份文档给前端。校验不过就返回错误，界面不渲染内容。
#[tauri::command]
fn get_note<R: Runtime>(app: AppHandle<R>, id: String) -> Result<Note, String> {
    let dir = notes_dir(&app)?;
    note::load(&dir, &id).map_err(|err| err.to_string())
}

/// 把前端送来的内容合并进磁盘上的文档。
///
/// 位置、展开尺寸、可见性、折叠、置顶和层叠顺序由窗口层负责，前端手里这些字段
/// 可能是旧的（刚拖动过、刚被托盘改过），所以一律保留磁盘上的值；
/// 标题、分页、正文、底色、底纹和半透明以前端为准。
fn merge_frontend_fields(stored: &Note, incoming: &Note) -> Note {
    Note {
        title: incoming.title.clone(),
        tabs: incoming.tabs.clone(),
        active_tab: incoming.active_tab.clone(),
        content: incoming.content.clone(),
        paper: incoming.paper,
        pattern: incoming.pattern,
        translucent: incoming.translucent,
        ..stored.clone()
    }
}

/// 保存前端改动的内容。只落盘，不碰窗口：每次编辑都重设窗口几何会打断拖动和缩放。
fn save_note_content(dir: &Path, incoming: &Note) -> Result<Note, String> {
    let stored = note::load(dir, &incoming.id).map_err(|err| err.to_string())?;
    let merged = merge_frontend_fields(&stored, incoming);
    note::save(dir, &merged).map_err(|err| err.to_string())?;
    Ok(merged)
}

#[tauri::command]
fn save_note<R: Runtime>(app: AppHandle<R>, note: Note) -> Result<(), String> {
    let dir = notes_dir(&app)?;
    save_note_content(&dir, &note).map(|_| ())
}

/// 目录里全部可用文档。坏文档跳过，托盘和服务启动都不因此中断。
fn load_notes<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<Note>, String> {
    let dir = notes_dir(app)?;
    let ids = note::list_ids(&dir).map_err(|err| err.to_string())?;
    Ok(ids
        .iter()
        .filter_map(|id| note::load(&dir, id).ok())
        .collect())
}

/// 切换一张便签的可见性。隐藏只关窗口，文档和托盘列表都留着。
fn apply_visible<R: Runtime>(
    app: &AppHandle<R>,
    dir: &Path,
    id: &str,
    visible: bool,
) -> Result<Note, String> {
    let mut note = note::load(dir, id).map_err(|err| err.to_string())?;
    if !visible {
        // 隐藏前先把窗口当前的位置与尺寸记下来，下次显示才回到原处。
        note.frame = live_frame_for(app, &note);
    }
    note.visible = visible;
    note::save(dir, &note).map_err(|err| err.to_string())?;
    if visible {
        show(app, &note)?;
    } else {
        hide(app, id)?;
    }
    Ok(note)
}


/// 窗口侧的显示开关。关闭按钮走这里，和托盘菜单同一条路径：
/// 先把窗口当前位置写回文档，再关窗口，最后刷新托盘列表的勾选。
#[tauri::command]
fn set_visible<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    visible: bool,
) -> Result<Note, String> {
    let dir = notes_dir(&app)?;
    let note = apply_visible(&app, &dir, &id, visible)?;
    tray::rebuild(&app);
    Ok(note)
}

/// 删除一张便签：文档从磁盘移除，窗口跟着关掉，托盘列表刷新。删除不可恢复，
/// 所以二次确认放在前端，这里只管执行。
fn remove_note<R: Runtime>(app: &AppHandle<R>, dir: &Path, id: &str) -> Result<(), String> {
    match std::fs::remove_file(note::note_path(dir, id)) {
        Ok(()) => {}
        // 文件已经不在了说明上一次删除其实成功了，重试按成功处理。
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(format!("删除便签 {id} 失败: {err}")),
    }
    hide(app, id)?;
    tray::rebuild(app);
    Ok(())
}

#[tauri::command]
fn delete_note<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let dir = notes_dir(&app)?;
    remove_note(&app, &dir, &id)
}

/// 弹出便签的「更多操作」菜单窗口。
#[tauri::command]
fn open_menu_window<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    anchor: MenuAnchor,
) -> Result<(), String> {
    open_menu(&app, &id, anchor)
}

/// 对齐的执行部分。`area` 由调用方给，测试才能喂假显示器数据。
/// 窗口不在或拿不到可见区域时原样返回，不动窗口也不写盘。
fn align_note_to<R: Runtime>(
    app: &AppHandle<R>,
    dir: &Path,
    id: &str,
    area: Option<Rect>,
    placement: Placement,
) -> Result<Note, String> {
    let mut note = note::load(dir, id).map_err(|err| err.to_string())?;
    let (Some(area), Some(window)) = (area, app.get_webview_window(id)) else {
        return Ok(note);
    };
    // 尺寸取窗口当前的：这里只挪位置，缩放交给手动缩放。
    let target = frame::align(live_frame(&window)?, area, placement);
    window
        .set_position(LogicalPosition::new(target.x, target.y))
        .map_err(|err| err.to_string())?;
    if target != note.frame {
        note.frame = target;
        note::save(dir, &note).map_err(|err| err.to_string())?;
    }
    Ok(note)
}

/// 把一张便签贴到屏幕的某个位置。屏幕坐标只有窗口层知道，所以走命令：
/// 它算好坐标、移动窗口、写回文档，并把磁盘上的最新版本返回给前端。
/// 目标是窗口当前所在的那块屏，多屏时不会跳到别的屏去。
#[tauri::command]
fn align_note<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    placement: Placement,
) -> Result<Note, String> {
    let dir = notes_dir(&app)?;
    align_note_to(&app, &dir, &id, current_area(&app, &id), placement)
}

/// 窗口所在那块屏的可见区域；窗口不在或拿不到显示器时用第一块屏兜底。
fn current_area<R: Runtime>(app: &AppHandle<R>, id: &str) -> Option<Rect> {
    app.get_webview_window(id)
        .and_then(|window| {
            window
                .current_monitor()
                .ok()
                .flatten()
                .map(|monitor| monitor_rect(&monitor))
                .or_else(|| monitor_rects(app).first().copied())
        })
}

/// 双击脊条放大/恢复的执行部分。`area` 由调用方给，测试才能喂假显示器数据。
///
/// 放大就是铺满所在屏幕的可见区域（避开菜单栏和 Dock），恢复时回到放大前的位置与尺寸。
/// `monitors` 用来夹住旧的 `restore_frame`：拔掉一块屏之后双击恢复，便签不会弹到看不见的地方。
fn toggle_maximize_to<R: Runtime>(
    app: &AppHandle<R>,
    dir: &Path,
    id: &str,
    area: Option<Rect>,
    monitors: &[Rect],
) -> Result<Note, String> {
    let mut note = note::load(dir, id).map_err(|err| err.to_string())?;
    let (Some(area), Some(window)) = (area, app.get_webview_window(id)) else {
        return Ok(note);
    };
    let target = if note.maximized {
        // 取走这份 frame：恢复之后就不再需要它了，下次放大会重新存。
        // 老文档可能没有它（None），那就留在放大态的位置，不乱跳。
        note.restore_frame
            .take()
            .map(|restore| frame::fit(restore, monitors))
            .unwrap_or(area)
    } else {
        // 放大前先记下当前 frame，否则双击回去没有位置可回。
        note.restore_frame = Some(live_frame(&window)?);
        area
    };
    note.maximized = !note.maximized;
    note.frame = target;
    window
        .set_size(LogicalSize::new(target.width, target.height))
        .map_err(|err| err.to_string())?;
    window
        .set_position(LogicalPosition::new(target.x, target.y))
        .map_err(|err| err.to_string())?;
    note::save(dir, &note).map_err(|err| err.to_string())?;
    Ok(note)
}

/// 双击脊条在铺满屏幕和原尺寸之间切换。屏幕坐标只有窗口层知道，所以走命令，
/// 它顺手把放大前的位置写回文档，重启后双击还能回去。
#[tauri::command]
fn toggle_maximize<R: Runtime>(app: AppHandle<R>, id: String) -> Result<Note, String> {
    let dir = notes_dir(&app)?;
    toggle_maximize_to(
        &app,
        &dir,
        &id,
        current_area(&app, &id),
        &monitor_rects(&app),
    )
}
/// 收起菜单窗口。窗口不在时按成功处理，重复收起不出错。
#[tauri::command]
fn close_menu_window<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let label = format!("{MENU_LABEL_PREFIX}{id}");
    match app.get_webview_window(&label) {
        Some(window) => window.close().map_err(|err| err.to_string()),
        None => Ok(()),
    }
}

/// 窗口当前 frame；窗口不在时改用文档里的值。
fn live_frame_for<R: Runtime>(app: &AppHandle<R>, note: &Note) -> Rect {
    app.get_webview_window(&note.id)
        .and_then(|window| live_frame(&window).ok())
        .unwrap_or(note.frame)
}

/// 成批显示或隐藏。不删除任何文档。
fn set_all_visible<R: Runtime>(
    app: &AppHandle<R>,
    dir: &Path,
    visible: bool,
) -> Result<(), String> {
    for id in note::list_ids(dir).map_err(|err| err.to_string())? {
        if let Err(err) = apply_visible(app, dir, &id, visible) {
            eprintln!("便签 {id} 切换可见性失败: {err}");
        }
    }
    Ok(())
}


/// 退出前把还开着的便签位置写回文档。
fn save_open_frames<R: Runtime>(app: &AppHandle<R>, dir: &Path) {
    for (label, window) in app.webview_windows() {
        let Ok(mut note) = note::load(dir, &label) else {
            continue;
        };
        if let Ok(live) = live_frame(&window) {
            note.frame = live;
        }
        if let Err(err) = note::save(dir, &note) {
            eprintln!("便签 {label} 保存位置失败: {err}");
        }
    }
}


fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, dir: &Path, id: &str) {
    let action = tray::parse_id(id);
    match action {
        tray::MenuAction::Ignore => return,
        tray::MenuAction::New => {
            if let Err(err) = create(app) {
                eprintln!("新建便签失败: {err}");
            }
        }
        tray::MenuAction::SetAll(visible) => {
            if let Err(err) = set_all_visible(app, dir, visible) {
                eprintln!("批量切换可见性失败: {err}");
            }
        }
        tray::MenuAction::ToggleVisible(ref note_id) => {
            let visible = note::load(dir, note_id).map(|note| !note.visible);
            match visible {
                Ok(visible) => {
                    if let Err(err) = apply_visible(app, dir, note_id, visible) {
                        eprintln!("便签 {note_id} 切换可见性失败: {err}");
                    }
                }
                Err(err) => eprintln!("便签 {note_id} 无法读取: {err}"),
            }
        }
        tray::MenuAction::Quit => {
            save_open_frames(app, dir);
            app.exit(0);
        }
    }
    tray::rebuild(app);
}


/// 托盘应用没有常驻主窗口。最后一张便签关闭时运行时会请求退出，这里拦住。
fn on_run_event<R: Runtime>(handle: &AppHandle<R>, event: tauri::RunEvent) {
    // 最后一张便签关闭时运行时会请求退出。托盘还在，除重启外都拦住。
    if let tauri::RunEvent::ExitRequested { api, code, .. } = &event
        && should_keep_running(*code) {
            api.prevent_exit();
        }
    // setup 阶段 available_monitors 还是空的，恢复窗口必须等到应用就绪。
    if matches!(event, tauri::RunEvent::Ready) {
        // 只出现在菜单栏：托盘就是应用的入口，Dock 里不显示图标。
        #[cfg(target_os = "macos")]
        if let Err(err) = handle.set_activation_policy(tauri::ActivationPolicy::Accessory) {
            eprintln!("设置菜单栏模式失败: {err}");
        }

        match tray::build(handle) {
            Ok(()) => println!("菜单栏托盘已创建"),
            Err(err) => eprintln!("创建托盘失败: {err}"),
        }
        match notes_dir(handle) {
            Ok(dir) => restore_visible(handle, &dir),
            Err(err) => eprintln!("无法定位便签目录: {err}"),
        }
        tray::rebuild(handle);
    }
}

/// 只有没有退出码的隐式退出（最后一张便签关掉）才需要拦住。
/// `app.exit(_)` 和重启都带退出码，一律放行，否则菜单里的「退出」会被自己拦掉。
pub(crate) fn should_keep_running(code: Option<i32>) -> bool {
    code.is_none()
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(FrameWrites::default())
        .invoke_handler(tauri::generate_handler![
            new_note,
            get_note,
            save_note,
            set_pinned,
            set_visible,
            delete_note,
            align_note,
            open_menu_window,
            close_menu_window,
            toggle_maximize
        ])
        .on_menu_event(|app, event| match notes_dir(app) {
            Ok(dir) => handle_menu_event(app, &dir, event.id().as_ref()),
            Err(err) => eprintln!("无法定位便签目录: {err}"),
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            match event {
                // 菜单只是浮层：失去焦点就收起来，不留在桌面上。
                tauri::WindowEvent::Focused(false)
                    if window.label().starts_with(MENU_LABEL_PREFIX) =>
                {
                    let _ = window.close();
                }
                // 菜单关掉都要通知便签窗口一声（点外面、Escape、收起、点按钮关闭）。
                // 不通知的话按钮以为菜单还开着，再点一次会去「关」一个已经关掉的窗口，
                // 表现为点了没反应。
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
                    if window.label().starts_with(MENU_LABEL_PREFIX) =>
                {
                    if let Some(id) = window.label().strip_prefix(MENU_LABEL_PREFIX) {
                        let _ = window
                            .app_handle()
                            .emit_to(id, "note-menu-closed", serde_json::json!({ "id": id }));
                    }
                }
                // 拖动和缩放后把位置与尺寸记回文档，重启或强杀后仍在原处。
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    if !frame_write_allowed(app, window.label()) {
                        return;
                    }
                    let Ok(dir) = notes_dir(app) else {
                        return;
                    };
                    if let (Ok(position), Ok(size), Ok(scale)) = (
                        window.outer_position(),
                        window.inner_size(),
                        window.scale_factor(),
                    ) {
                        save_frame(&dir, window.label(), logical_rect(position, size, scale));
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(on_run_event);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::note::Paper;
    use tauri::test::mock_app;

    fn test_note(id: &str) -> Note {
        Note::new(
            id.into(),
            Rect::new(0.0, 0.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        )
    }


    fn test_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fx-stickies-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn showing_the_same_note_twice_keeps_one_window() {
        let app = mock_app();
        let note = test_note("n1");

        let first = show_at(app.handle(), &note, note.frame).unwrap();
        let second = show_at(app.handle(), &note, note.frame).unwrap();

        assert_eq!(first.label(), "n1");
        assert_eq!(second.label(), "n1");
        assert_eq!(app.webview_windows().len(), 1);
    }

    #[test]
    fn note_window_is_undecorated() {
        let app = mock_app();
        let note = test_note("n1");

        let window = show_at(app.handle(), &note, note.frame).unwrap();

        assert_eq!(window.label(), "n1");
        assert!(window.is_decorated().is_ok_and(|decorated| !decorated));
    }

    #[test]
    fn hiding_keeps_the_document() {
        let app = mock_app();
        let dir = test_dir();
        let note = test_note("n1");
        note::save(&dir, &note).unwrap();
        show_at(app.handle(), &note, note.frame).unwrap();

        hide(app.handle(), &note.id).unwrap();

        // MockRuntime 不真的销毁窗口，窗口消失由实机验收覆盖；这里只钉住文档不丢。
        assert_eq!(note::load(&dir, "n1").unwrap(), note);
    }

    #[test]
    fn hiding_a_note_without_window_is_fine() {
        let app = mock_app();

        assert!(hide(app.handle(), "没有这个").is_ok());
    }

    #[test]
    fn damaged_document_does_not_open_a_window() {
        let app = mock_app();
        let dir = test_dir();
        std::fs::write(note::note_path(&dir, "broken"), "{\"id\":\"broken\"}").unwrap();

        assert!(open(app.handle(), &dir, "broken").is_err());
        assert_eq!(app.webview_windows().len(), 0);
    }






    #[test]
    fn window_frame_raises_a_too_small_expanded_frame() {
        let mut note = test_note("n1");
        // 旧文档里可能存着被拖到几乎看不见的尺寸
        note.frame = Rect::new(30.0, 40.0, 40.0, 30.0);

        assert_eq!(
            window_frame(&note),
            Rect::new(30.0, 40.0, MIN_WIDTH, MIN_HEIGHT)
        );
    }


    #[test]
    fn save_pinned_writes_the_state_to_the_document() {
        let app = mock_app();
        let dir = test_dir();
        let note = test_note("n1");
        note::save(&dir, &note).unwrap();
        show_at(app.handle(), &note, note.frame).unwrap();

        let stored = save_pinned(app.handle(), &dir, "n1", true).unwrap();

        assert!(stored.pinned);
        assert!(note::load(&dir, "n1").unwrap().pinned);
    }

    #[test]
    fn aligning_moves_the_window_and_records_the_frame() {
        let app = mock_app();
        let dir = test_dir();
        let mut note = test_note("n1");
        note.frame = Rect::new(500.0, 400.0, DEFAULT_WIDTH, DEFAULT_HEIGHT);
        note::save(&dir, &note).unwrap();
        show_at(app.handle(), &note, note.frame).unwrap();

        // shortcut: MockRuntime 的窗口位置和尺寸恒为 0、也取不到显示器，
        // 所以这里只钉住「算出的坐标写回了文档」；尺寸相关的算法在 frame::align 的测试里。
        let area = Some(Rect::new(0.0, 25.0, 1920.0, 1055.0));
        let aligned = align_note_to(app.handle(), &dir, "n1", area, Placement::TopLeft).unwrap();

        assert_eq!(aligned.frame, Rect::new(12.0, 37.0, 0.0, 0.0));
        assert_eq!(note::load(&dir, "n1").unwrap().frame, aligned.frame);
    }

    #[test]
    fn maximizing_fills_the_screen_and_restoring_returns_to_the_old_frame() {
        let app = mock_app();
        let dir = test_dir();
        let mut note = test_note("n1");
        note.frame = Rect::new(500.0, 400.0, DEFAULT_WIDTH, DEFAULT_HEIGHT);
        note::save(&dir, &note).unwrap();
        show_at(app.handle(), &note, note.frame).unwrap();
        let area = Some(Rect::new(0.0, 25.0, 1920.0, 1055.0));
        let monitors = [Rect::new(0.0, 25.0, 1920.0, 1055.0)];

        // shortcut: MockRuntime 的窗口位置和尺寸恒为 0，所以 restore_frame 记下来的是 0×0；
        // 这里钉住的是「铺满工作区」「记住原尺寸再回来」这条状态链。
        let maximized = toggle_maximize_to(app.handle(), &dir, "n1", area, &monitors).unwrap();
        assert_eq!(maximized.frame, area.unwrap());
        assert!(maximized.maximized);

        let restored = toggle_maximize_to(app.handle(), &dir, "n1", area, &monitors).unwrap();
        assert!(!restored.maximized);
        // 记下来的原 frame 要过一遍可见性校正：MockRuntime 的窗口恒为 0×0，
        // 那个点不算「可见」，因此结果比原值低一档 y，真机上才是原位。
        assert_eq!(
            restored.frame,
            frame::fit(maximized.restore_frame.unwrap(), &monitors)
        );
        // 恢复完就不再留着旧 frame，下一次放大重新记
        assert_eq!(restored.restore_frame, None);
    }

    #[test]
    fn restoring_clamps_a_frame_left_on_a_disconnected_screen() {
        let app = mock_app();
        let dir = test_dir();
        let mut note = test_note("n1");
        note.frame = Rect::new(500.0, 400.0, DEFAULT_WIDTH, DEFAULT_HEIGHT);
        // 拔屏之前放大过，恢复目标在另一块屏上
        note.maximized = true;
        note.restore_frame = Some(Rect::new(3000.0, 200.0, DEFAULT_WIDTH, DEFAULT_HEIGHT));
        note::save(&dir, &note).unwrap();
        show_at(app.handle(), &note, note.frame).unwrap();
        let area = Some(Rect::new(0.0, 25.0, 1920.0, 1055.0));

        let restored = toggle_maximize_to(
            app.handle(),
            &dir,
            "n1",
            area,
            &[Rect::new(0.0, 25.0, 1920.0, 1055.0)],
        )
        .unwrap();

        // 恢复目标被夹到当前屏幕内：x 收到 3000 → 1500，y 保持 200
        assert_eq!(
            restored.frame,
            Rect::new(1500.0, 200.0, DEFAULT_WIDTH, DEFAULT_HEIGHT)
        );
    }

    #[test]
    fn aligning_without_a_visible_area_keeps_the_frame() {
        let app = mock_app();
        let dir = test_dir();
        let note = test_note("n1");
        note::save(&dir, &note).unwrap();
        show_at(app.handle(), &note, note.frame).unwrap();

        // 拿不到可见区域就无从判断该贴哪，原样返回而不是乱挪窗口。
        assert_eq!(
            align_note_to(app.handle(), &dir, "n1", None, Placement::Center)
                .unwrap()
                .frame,
            note.frame
        );
    }




    #[test]
    fn hiding_keeps_the_document_readable() {
        let app = mock_app();
        let dir = test_dir();
        note::save(&dir, &test_note("n1")).unwrap();

        let hidden = apply_visible(app.handle(), &dir, "n1", false).unwrap();

        assert!(!hidden.visible);
        // 隐藏只是状态，文档还在托盘列表里，也还能再显示
        assert_eq!(note::load(&dir, "n1").unwrap(), hidden);
    }


    #[test]
    fn deleting_a_note_removes_only_that_document() {
        let app = mock_app();
        let dir = test_dir();
        note::save(&dir, &test_note("a")).unwrap();
        note::save(&dir, &test_note("b")).unwrap();

        remove_note(app.handle(), &dir, "a").unwrap();

        assert_eq!(note::list_ids(&dir).unwrap(), vec!["b".to_string()]);
    }

    #[test]
    fn menu_window_starts_at_the_button_corner() {
        // MockRuntime 下窗口在 (0,0)，菜单窗口左上角就落在按钮的右下角：
        // 再往回缩就会盖住按钮，按钮点不到、也收不到 hover。
        // shortcut: 真正建窗口要 bind 真实 NSWindow，MockRuntime 会段错，
        // 所以这里只钉定位；窗口能否建出来由实机验收覆盖。
        let app = mock_app();
        let note = test_note("n1");
        let window = show_at(app.handle(), &note, note.frame).unwrap();

        let (x, y) = menu_origin(
            &window,
            MenuAnchor {
                right: 200.0,
                bottom: 20.0,
            },
        )
        .unwrap();

        assert_eq!(x, 200.0);
        assert_eq!(y, 20.0);
    }

    #[test]
    fn menu_window_without_its_note_is_an_error() {
        let app = mock_app();

        let opened = open_menu(
            app.handle(),
            "没有这个",
            MenuAnchor {
                right: 0.0,
                bottom: 0.0,
            },
        );

        assert!(opened.is_err());
    }

    #[test]
    fn closing_a_menu_window_that_is_not_open_is_fine() {
        let app = mock_app();

        assert!(close_menu_window(app.handle().clone(), "n1".into()).is_ok());
    }

    #[test]
    fn deleting_a_missing_document_is_a_no_op() {
        // 重试删除不该因为文件已经不在而失败。
        let app = mock_app();
        let dir = test_dir();

        assert!(remove_note(app.handle(), &dir, "没有这个").is_ok());
    }

    #[test]
    fn offscreen_frame_lands_on_visible_work_area() {
        // 假显示器数据：外接屏已经不在了，只剩主屏。
        let monitors = [Rect::new(0.0, 25.0, 1920.0, 1055.0)];
        let mut note = test_note("n1");
        note.frame = Rect::new(-1680.0, 200.0, DEFAULT_WIDTH, DEFAULT_HEIGHT);

        assert_eq!(
            visible_frame(&note, &monitors),
            Rect::new(0.0, 200.0, DEFAULT_WIDTH, DEFAULT_HEIGHT)
        );
    }

    #[test]
    fn frame_already_on_screen_is_kept() {
        let monitors = [Rect::new(0.0, 25.0, 1920.0, 1055.0)];
        let mut note = test_note("n1");
        note.frame = Rect::new(120.0, 140.0, DEFAULT_WIDTH, DEFAULT_HEIGHT);

        assert_eq!(visible_frame(&note, &monitors), note.frame);
    }

    #[test]
    fn without_monitor_data_frame_is_kept() {
        let mut note = test_note("n1");
        note.frame = Rect::new(-1680.0, 200.0, DEFAULT_WIDTH, DEFAULT_HEIGHT);

        assert_eq!(visible_frame(&note, &[]), note.frame);
    }


    #[test]
    fn save_note_content_takes_frontend_content_and_keeps_window_state() {
        let dir = test_dir();
        let mut stored = test_note("n1");
        stored.frame = Rect::new(10.0, 20.0, 300.0, 200.0);
        stored.pinned = true;
        stored.spine_size = note::SpineSize::Min;
        stored.visible = false;
        note::save(&dir, &stored).unwrap();

        // 前端手里是旧的位置、旧的置顶和旧的可见性，内容是新写的
        let mut incoming = stored.clone();
        incoming.frame = Rect::new(900.0, 900.0, 100.0, 100.0);
        incoming.pinned = false;
        incoming.spine_size = note::SpineSize::Max;
        incoming.visible = true;
        incoming.title = "改过的标题".into();
        incoming.paper = Paper::LightApricot;

        let merged = save_note_content(&dir, &incoming).unwrap();

        assert_eq!(merged.title, "改过的标题");
        assert_eq!(merged.paper, Paper::LightApricot);
        // 窗口层负责的字段保留磁盘上的值
        assert_eq!(merged.frame, Rect::new(10.0, 20.0, 300.0, 200.0));
        assert!(merged.pinned);
        assert_eq!(merged.spine_size, note::SpineSize::Min);
        assert!(!merged.visible);
        assert_eq!(note::load(&dir, "n1").unwrap(), merged);
    }

    #[test]
    fn save_frame_records_position_and_size() {
        let dir = test_dir();
        note::save(&dir, &test_note("n1")).unwrap();
        let moved = Rect::new(320.0, 240.0, 300.0, 200.0);

        save_frame(&dir, "n1", moved);

        assert_eq!(note::load(&dir, "n1").unwrap().frame, moved);
    }


    #[test]
    fn save_frame_ignores_unknown_windows() {
        let dir = test_dir();

        // 没有对应文档时不能新建文件
        save_frame(&dir, "没有这个", Rect::new(0.0, 0.0, 300.0, 200.0));

        assert!(note::list_ids(&dir).unwrap().is_empty());
    }

    #[test]
    fn logical_rect_converts_physical_pixels() {
        // Retina 上物理像素是逻辑点的两倍
        let rect = logical_rect(
            tauri::PhysicalPosition::new(400, 300),
            tauri::PhysicalSize::new(600, 400),
            2.0,
        );

        assert_eq!(rect, Rect::new(200.0, 150.0, 300.0, 200.0));
    }

    #[test]
    fn hide_all_from_the_tray_keeps_every_document() {
        let app = mock_app();
        let dir = test_dir();
        note::save(&dir, &test_note("a")).unwrap();
        note::save(&dir, &test_note("b")).unwrap();

        handle_menu_event(app.handle(), &dir, "hide-all");

        for id in ["a", "b"] {
            let stored = note::load(&dir, id).unwrap();
            assert!(!stored.visible);
        }
        assert_eq!(note::list_ids(&dir).unwrap().len(), 2);
    }

    #[test]
    fn closing_the_last_note_does_not_quit() {
        assert!(should_keep_running(None));
        // 菜单「退出」走 app.exit(0)，带退出码，不能被自己拦住。
        assert!(!should_keep_running(Some(0)));
        // 重启仍要退出，不能被托盘拦截。
        assert!(!should_keep_running(Some(i32::MAX)));
    }



    #[test]
    fn tray_note_item_toggles_visibility_both_ways() {
        let app = mock_app();
        let dir = test_dir();
        note::save(&dir, &test_note("a")).unwrap();

        // 隐藏方向不需要显示器信息，显示方向要开窗口，由实机验收覆盖。
        handle_menu_event(app.handle(), &dir, "note:a");

        assert!(!note::load(&dir, "a").unwrap().visible);
        assert_eq!(note::list_ids(&dir).unwrap(), vec!["a".to_string()]);
    }
}
