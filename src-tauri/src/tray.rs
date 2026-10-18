//! 菜单栏托盘：菜单构造和菜单事件分发。
//!
//! 菜单本身不碰文档，动作都调 `lib.rs` 里的便签操作，
//! 这样托盘和窗口走的是同一条数据路径。

use std::sync::Mutex;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Runtime};


/// 托盘列表名。旧标题还在就用标题；否则用正文里第一行非空文字。
/// 整张都是空的，给一个能认出来的名字，不拿随机 id 充数。
pub fn display_label(note: &crate::note::Note) -> String {
    let title = note.title.trim();
    if !title.is_empty() {
        return title.to_string();
    }
    for page in &note.tabs {
        if let Some(line) = first_text_line(note.content.get(page)) {
            return line;
        }
    }
    "空白便签".to_string()
}

fn first_text_line(doc: Option<&serde_json::Value>) -> Option<String> {
    let mut found = None;
    if let Some(doc) = doc {
        let _ = walk_text(doc, &mut |text| {
            let line = text.lines().find(|part| !part.trim().is_empty())?;
            found = Some(truncate_label(line.trim()));
            Some(())
        });
    }
    found
}

/// 找到第一段正文就停。返回 true 表示上层不用再往下走。
fn walk_text(value: &serde_json::Value, visit: &mut dyn FnMut(&str) -> Option<()>) -> bool {
    if let Some(text) = value.get("text").and_then(|text| text.as_str())
        && visit(text).is_some() {
            return true;
        }
    let Some(children) = value.get("content").and_then(|content| content.as_array()) else {
        return false;
    };
    children.iter().any(|child| walk_text(child, visit))
}

fn truncate_label(line: &str) -> String {
    let mut end = line.len();
    let mut count = 0;
    for (index, _) in line.char_indices() {
        if count == 24 {
            end = index;
            break;
        }
        count += 1;
    }
    let mut label = line[..end].to_string();
    if end < line.len() {
        label.push('…');
    }
    label
}

/// 过滤只看菜单上的标签，不看文档 id。空串表示不过滤。
pub fn label_matches(label: &str, query: &str) -> bool {
    let query = query.trim();
    query.is_empty() || label.to_lowercase().contains(&query.to_lowercase())
}

/// 菜单里展示的过滤词。空串不显示，避免标签上挂一个空括号。
pub fn filter_caption(query: &str) -> String {
    let query = query.trim();
    if query.is_empty() {
        "过滤标签".to_string()
    } else {
        format!("过滤标签：{query}")
    }
}

pub const MENU_NEW: &str = "new";
pub const MENU_LIST: &str = "note-list";
pub const MENU_SHOW_ALL: &str = "show-all";
pub const MENU_HIDE_ALL: &str = "hide-all";
pub const MENU_FILTER: &str = "filter-labels";
pub const MENU_QUIT: &str = "quit";
pub const NOTE_PREFIX: &str = "note:";


/// 便签列表当前的过滤词。菜单重建后还要留着，否则点一次就丢。
#[derive(Default)]
pub struct LabelFilter(pub Mutex<String>);

impl LabelFilter {
    pub fn get(&self) -> String {
        self.0.lock().ok().map(|query| query.clone()).unwrap_or_default()
    }

    pub fn set(&self, query: &str) {
        if let Ok(mut current) = self.0.lock() {
            *current = query.trim().to_string();
        }
    }
}



/// 按当前文档集合构造托盘菜单。
pub fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    notes: &[crate::note::Note],
    filter: &str,
) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(
        app,
        MENU_NEW,
        "新建便签",
        true,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    // 便签列表：勾选表示当前可见。全部显示/隐藏和过滤都是同一类操作。
    let list = Submenu::with_id(app, MENU_LIST, "便签列表", true)?;
    list.append(&MenuItem::with_id(
        app,
        MENU_SHOW_ALL,
        "全部显示",
        true,
        None::<&str>,
    )?)?;
    list.append(&MenuItem::with_id(
        app,
        MENU_HIDE_ALL,
        "全部隐藏",
        true,
        None::<&str>,
    )?)?;
    list.append(&MenuItem::with_id(
        app,
        MENU_FILTER,
        filter_caption(filter),
        true,
        None::<&str>,
    )?)?;
    list.append(&PredefinedMenuItem::separator(app)?)?;
    let shown: Vec<_> = notes
        .iter()
        .filter(|note| label_matches(&display_label(note), filter))
        .collect();
    if shown.is_empty() {
        list.append(&MenuItem::with_id(
            app,
            "note-list-empty",
            if filter.trim().is_empty() {
                "还没有便签"
            } else {
                "没有匹配的便签"
            },
            false,
            None::<&str>,
        )?)?;
    } else {
        for note in shown {
            list.append(&CheckMenuItem::with_id(
                app,
                format!("{NOTE_PREFIX}{}", note.id),
                display_label(note),
                true,
                note.visible,
                None::<&str>,
            )?)?;
        }
    }
    menu.append(&list)?;


    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        MENU_QUIT,
        "退出",
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}

/// 建托盘：主键点击直接出菜单，不依赖平台 click 事件。
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    TrayIconBuilder::with_id("main")
        .icon(tauri::include_image!("icons/tray-note.png"))
        .icon_as_template(true)
        .tooltip("便签")
        // 主键直接出菜单，不依赖平台 click 事件（Linux 不提供）。
        .show_menu_on_left_click(true)
        .menu(&build_menu(app, &[], "")?)
        .build(app)?;
    Ok(())
}

/// 文档集合变化后重建菜单。第一版不做驻留的动态菜单状态。
pub fn rebuild<R: Runtime>(app: &AppHandle<R>) {
    let notes = crate::load_notes(app).unwrap_or_default();
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    let filter = app.state::<LabelFilter>().get();
    match build_menu(app, &notes, &filter) {
        Ok(menu) => {
            if let Err(err) = tray.set_menu(Some(menu)) {
                eprintln!("重建托盘菜单失败: {err}");
            }
        }
        Err(err) => eprintln!("构造托盘菜单失败: {err}"),
    }
}

/// 菜单项 id 解析：返回便签 id 或批量操作。
pub fn parse_id(id: &str) -> MenuAction {
    if id == MENU_NEW {
        MenuAction::New
    } else if id == MENU_SHOW_ALL {
        MenuAction::SetAll(true)
    } else if id == MENU_HIDE_ALL {
        MenuAction::SetAll(false)
    } else if id == MENU_FILTER {
        MenuAction::Filter
    } else if id == MENU_QUIT {
        MenuAction::Quit
    } else if let Some(note) = id.strip_prefix(NOTE_PREFIX) {
        MenuAction::ToggleVisible(note.to_string())
    } else {
        MenuAction::Ignore
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum MenuAction {
    New,
    SetAll(bool),
    Filter,
    ToggleVisible(String),
    Quit,
    Ignore,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_menu_ids() {
        assert_eq!(parse_id("new"), MenuAction::New);
        assert_eq!(parse_id("show-all"), MenuAction::SetAll(true));
        assert_eq!(parse_id("hide-all"), MenuAction::SetAll(false));
        assert_eq!(parse_id("filter-labels"), MenuAction::Filter);
        assert_eq!(parse_id("quit"), MenuAction::Quit);
        assert_eq!(
            parse_id("note:abc"),
            MenuAction::ToggleVisible("abc".into())
        );
        assert_eq!(parse_id("别的"), MenuAction::Ignore);
    }


    #[test]
    fn label_filter_matches_text_not_id() {
        assert!(label_matches("买牛奶", ""));
        assert!(label_matches("买牛奶", " 牛奶 "));
        assert!(label_matches("Buy Milk", "buy"));
        assert!(!label_matches("买牛奶", "面包"));
        assert_eq!(filter_caption(""), "过滤标签");
        assert_eq!(filter_caption(" 牛奶 "), "过滤标签：牛奶");
    }

    #[test]
    fn empty_title_uses_the_first_body_line() {
        let mut note = crate::note::Note::new(
            "01234567-89ab-cdef-0123-456789abcdef".into(),
            crate::frame::Rect::new(0.0, 0.0, 300.0, 200.0),
        );
        note.content.insert(
            note.active_tab.clone(),
            serde_json::json!({
                "type": "doc",
                "content": [
                    { "type": "paragraph" },
                    { "type": "paragraph", "content": [{ "type": "text", "text": "  " }] },
                    { "type": "paragraph", "content": [{ "type": "text", "text": "买牛奶" }] }
                ]
            }),
        );
        let long = "一二三四五六七八九十一二三四五六七八九十一二三四五";
        note.content.get_mut(&note.active_tab).unwrap()["content"][2]["content"][0]["text"] =
            serde_json::Value::String(long.into());
        assert_eq!(display_label(&note).chars().count(), 25);
        note.content.get_mut(&note.active_tab).unwrap()["content"][2]["content"][0]["text"] =
            serde_json::json!("买牛奶");

        assert_eq!(display_label(&note), "买牛奶");

        note.title = "旧标题".into();
        assert_eq!(display_label(&note), "旧标题");

        note.title.clear();
        note.content.insert(note.active_tab.clone(), crate::note::empty_doc());
        assert_eq!(display_label(&note), "空白便签");
    }
}
