//! 便签文档：字段定义，以及用同目录临时文件 + rename 完成的原子保存。

use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::frame::{Rect, Size};

/// 底色分两组，各十枚：`docs/color/Soft Pastel Dreams.png`（= `stickies-color.md` 的 style-2，
/// 其中 `Porcelain`/`AlabasterGrey` 是补的中性色）与
/// `docs/color/Enchanted Forest Hues.png`（style-3），第二组是新增的，没有旧名要认。
/// 磁盘上的文件不用重写，下次保存时自动写成新值。别删已有 alias：磁盘上还有
/// 两代以前的文档（实测有一张 paper=mistBlue），认不出来就等于便签打不开。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Paper {
    #[serde(alias = "pastelPetal", alias = "cottonRose", alias = "terracotta")]
    CottonCandy,
    #[serde(alias = "blush")]
    PowderBlush,
    #[serde(alias = "apricot")]
    PeachFuzz,
    #[serde(alias = "pearlBeige", alias = "straw")]
    LightApricot,
    FrostedMint,
    PearlAqua,
    #[serde(alias = "frozenWater", alias = "mistBlue", alias = "sage")]
    PaleSky,
    #[serde(alias = "thistle")]
    Periwinkle,
    Porcelain,
    #[serde(alias = "dustGrey", alias = "ivory")]
    AlabasterGrey,
    /// 第二组：`docs/color/Enchanted Forest Hues.png`（= `stickies-color.md` 的 style-3），
    /// 抽屉里排在第一组右侧。新加的值没有旧名要认，所以没有 alias。
    CharcoalBlue,
    PineBlue,
    Verdigris,
    MutedOlive,
    DrySage,
    TuscanSun,
    SunlitClay,
    SandyBrown,
    CoralGlow,
    BurntPeach,
}

/// 底纹。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Pattern {
    Plain,
    Dots,
    Grid,
}

/// 标题栏高度档位。界面已经固定成 20px，这里只为旧文档保留字段。
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SpineSize {
    #[default]
    Min,
    Normal,
    Max,
}

/// 标题栏这一组控件（脊条、工具栏、色块行）的尺寸档位。
/// 各档的具体像素在 `src/note/chrome.css` 里从 `--chrome-scale` 派生，这里只存档位。
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChromeSize {
    Small,
    #[default]
    Normal,
    Large,
    /// 显式改名：camelCase 会把 `XLarge` 写成 `xLarge`，前端那边用的是 `xlarge`。
    #[serde(rename = "xlarge")]
    XLarge,
}

/// 右下角字符统计的字号档位。`off` 整行不渲染，其余三档的像素在 chrome.css。
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StatusSize {
    Off,
    Small,
    /// 默认档：旧文档没有这个字段，落回这一档。
    #[default]
    Normal,
    Large,
}
/// 一张便签的完整文档。字段与设计文档一致。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    /// 分页顺序，元素为分页 id。
    pub tabs: Vec<String>,
    /// 当前分页 id，必须出现在 `tabs` 中。
    pub active_tab: String,
    /// 分页 id -> 该分页的 Tiptap JSON 文档。
    pub content: BTreeMap<String, serde_json::Value>,
    pub paper: Paper,
    pub pattern: Pattern,
    pub pinned: bool,
    pub translucent: bool,
    pub collapsed: bool,
    /// 冻结的正文行数：滚动时前 N 行固定在顶部。旧文档没有这个字段，按 0 读进来。
    #[serde(default)]
    pub frozen_rows: i64,
    /// 正文字号，单位 px。旧文档没有这个字段，读进来落回 `DEFAULT_FONT_SIZE`。
    #[serde(default = "default_font_size")]
    pub font_size: f64,
    /// 是否显示 Markdown 工具栏。默认不显示：便签窗口很窄，工具栏按需开。
    #[serde(default)]
    pub toolbar: bool,
    pub spine_size: SpineSize,
    /// 标题栏这一组控件的尺寸档位。旧文档没有这个字段，按默认档读进来。
    #[serde(default)]
    pub chrome_size: ChromeSize,
    /// 右下角字符统计的字号档位。旧文档没有这个字段，按默认档读进来。
    #[serde(default)]
    pub status_size: StatusSize,
    /// 字符统计是否用更淡的一档颜色。旧文档没有这个字段，按勾选读进来。
    #[serde(default = "status_faded_default")]
    pub status_faded: bool,
    pub frame: Rect,
    /// 折叠前保存的展开尺寸；未折叠时为 None。
    pub expanded_size: Option<Size>,
    /// 是否处于放大态。旧文档没有这个字段，按没放大读进来。
    #[serde(default)]
    pub maximized: bool,
    /// 放大之前的 frame，双击才回得去；不在放大态时为 None。
    /// `Option` 字段在 serde 里本来就认缺省，所以旧文档少这个键也能读。
    pub restore_frame: Option<Rect>,
    pub z_order: i64,
    pub visible: bool,
}

/// 新建便签的默认尺寸。
/// 300×200 装不下几行字，改成 420×320：正文能一次看到十几行，又不会占掉半屏。
pub const DEFAULT_WIDTH: f64 = 420.0;
pub const DEFAULT_HEIGHT: f64 = 320.0;
/// 新建便签的正文默认字号。
pub const DEFAULT_FONT_SIZE: f64 = 14.0;
/// 手动缩放字号的上下限。下限 8px 是「还认得出是字」的那一档；上限放到 100px，
/// 让大字也够得着，再大一行就放不下几个字了。
pub const MIN_FONT_SIZE: f64 = 8.0;
pub const MAX_FONT_SIZE: f64 = 100.0;

/// 手动缩放的下限。到下限还能看见脊条、分页条和几行正文；再小就点不到窗口按钮、也读不到字了。
pub const MIN_WIDTH: f64 = 200.0;
pub const MIN_HEIGHT: f64 = 120.0;

/// 一个空分页的内容。前端 Tiptap 用同一形状的空文档。
pub fn empty_doc() -> serde_json::Value {
    serde_json::json!({
        "type": "doc",
        "content": [{ "type": "paragraph" }],
    })
}

/// `font_size` 的缺省值。serde 的 `default` 只认无参函数，所以写在这里。
fn default_font_size() -> f64 {
    DEFAULT_FONT_SIZE
}

/// `status_faded` 的缺省值。bool 的 `serde(default)` 只会给 false，
/// 而这一档的默认是勾选，所以必须显式指定。
fn status_faded_default() -> bool {
    true
}

impl Note {
    /// 新建便签：象牙底色、纯色底纹、可见。
    pub fn new(id: String, frame: Rect) -> Self {
        let page = uuid::Uuid::new_v4().to_string();
        Self {
            id,
            title: String::new(),
            tabs: vec![page.clone()],
            active_tab: page.clone(),
            content: BTreeMap::from([(page, empty_doc())]),
            paper: Paper::LightApricot,
            pattern: Pattern::Plain,
            pinned: false,
            translucent: false,
            collapsed: false,
            frozen_rows: 0,
            font_size: DEFAULT_FONT_SIZE,
            toolbar: false,
            spine_size: SpineSize::Min,
            chrome_size: ChromeSize::Normal,
            status_size: StatusSize::Normal,
            status_faded: true,
            frame,
            expanded_size: None,
            maximized: false,
            restore_frame: None,
            z_order: 0,
            visible: true,
        }
    }

    /// 字段之间的约束，单看一个字段看不出来的那部分。
    fn validate(&self) -> Result<(), NoteError> {
        if self.tabs.is_empty() {
            return Err(NoteError::Invalid("没有分页".into()));
        }
        if !self.tabs.contains(&self.active_tab) {
            return Err(NoteError::Invalid(format!(
                "当前分页 {} 不在分页列表中",
                self.active_tab
            )));
        }
        for tab in &self.tabs {
            if !self.content.contains_key(tab) {
                return Err(NoteError::Invalid(format!("分页 {tab} 没有正文")));
            }
        }
        // 字号越界的文档照样能读，但不能开窗口：0 号字在界面上是一张白纸，
        // 用户会以为便签内容丢了，而正文其实还在文件里。
        if !(MIN_FONT_SIZE..=MAX_FONT_SIZE).contains(&self.font_size) {
            return Err(NoteError::Invalid(format!(
                "字号 {} 不在 {}–{} 之间",
                self.font_size, MIN_FONT_SIZE, MAX_FONT_SIZE
            )));
        }
        if self.collapsed && self.expanded_size.is_none() {
            return Err(NoteError::Invalid("已折叠但没有展开尺寸".into()));
        }
        Ok(())
    }
}

#[derive(Debug)]
pub enum NoteError {
    Io(io::Error),
    /// 文档结构无法识别。读取时用它拒绝打开，且不回写原文件。
    Invalid(String),
}

impl fmt::Display for NoteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(err) => write!(f, "{err}"),
            Self::Invalid(reason) => write!(f, "文档结构无法识别: {reason}"),
        }
    }
}

impl std::error::Error for NoteError {}

impl From<io::Error> for NoteError {
    fn from(err: io::Error) -> Self {
        Self::Io(err)
    }
}

/// 文档路径。`dir` 是便签目录，即 `app_data_dir()/notes`。
pub fn note_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.json"))
}

/// 同目录临时文件路径。rename 的原子性依赖同目录，临时文件不得放到别处。
fn temp_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    dest.with_file_name(name)
}

/// 把完整文档写进同目录临时文件并落盘。这一步被中断时目标文件保持原样。
pub fn write_temp(dest: &Path, note: &Note) -> Result<PathBuf, NoteError> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes =
        serde_json::to_vec_pretty(note).map_err(|err| NoteError::Invalid(err.to_string()))?;
    let tmp = temp_path(dest);
    let mut file = fs::File::create(&tmp)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    Ok(tmp)
}

/// 用临时文件替换目标文件。
pub fn commit(tmp: &Path, dest: &Path) -> Result<(), NoteError> {
    fs::rename(tmp, dest)?;
    Ok(())
}

/// 完整保存：先校验，再走临时文件 + rename。
/// 校验挡在这里，磁盘上就不会出现一份读不回来的文档。
pub fn save(dir: &Path, note: &Note) -> Result<(), NoteError> {
    note.validate()?;
    let dest = note_path(dir, &note.id);
    let tmp = write_temp(&dest, note)?;
    commit(&tmp, &dest)
}

/// 读取并校验一份完整文档。
/// 返回 Err 时调用方不得创建窗口，也不得回写该文件。
pub fn load(dir: &Path, id: &str) -> Result<Note, NoteError> {
    let bytes = fs::read(note_path(dir, id))?;
    parse(&bytes)
}

/// 校验完整文档。缺字段或类型错误由 serde 拒绝，字段之间的约束由 `Note::validate` 拒绝。
pub fn parse(bytes: &[u8]) -> Result<Note, NoteError> {
    let note: Note =
        serde_json::from_slice(bytes).map_err(|err| NoteError::Invalid(err.to_string()))?;
    note.validate()?;
    Ok(open_expanded(note))
}

/// 折叠功能已经移除：旧文档里的折叠态恢复成展开尺寸，否则那张便签只剩脊条高，
/// 又没有展开入口，会永远卡住。字段仍写回文档，只是恒为展开态。
fn open_expanded(mut note: Note) -> Note {
    if note.collapsed {
        if let Some(size) = note.expanded_size {
            note.frame = Rect::new(note.frame.x, note.frame.y, size.width, size.height);
        }
        note.collapsed = false;
        note.expanded_size = None;
    }
    note
}

/// 列出目录里全部便签 id。这里只看文件名，内容是否可用由 `load` 判断。
/// 目录不存在时返回空列表。
pub fn list_ids(dir: &Path) -> Result<Vec<String>, NoteError> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut ids = Vec::new();
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) {
            ids.push(stem.to_string());
        }
    }
    ids.sort();
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fx-stickies-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn new_note_has_one_empty_page_and_defaults() {
        let note = Note::new(
            "n1".into(),
            Rect::new(10.0, 20.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        );

        assert_eq!(note.tabs.len(), 1);
        assert_eq!(note.tabs[0], note.active_tab);
        assert_eq!(note.content.len(), 1);
        assert_eq!(note.content[&note.active_tab], empty_doc());
        assert_eq!(note.paper, Paper::LightApricot);
        assert_eq!(note.pattern, Pattern::Plain);
        assert_eq!(note.font_size, DEFAULT_FONT_SIZE);
        assert!(!note.toolbar);
        assert_eq!(note.chrome_size, ChromeSize::Normal);
        assert_eq!(note.status_size, StatusSize::Normal);
        assert!(note.status_faded);
        assert!(note.visible);
    }

    #[test]
    fn chrome_size_uses_the_same_words_as_the_frontend() {
        // 前端发来的是这四个词，认错一个就等于存不进盘。
        for (value, text) in [
            (ChromeSize::Small, "small"),
            (ChromeSize::Normal, "normal"),
            (ChromeSize::Large, "large"),
            (ChromeSize::XLarge, "xlarge"),
        ] {
            assert_eq!(serde_json::to_value(value).unwrap(), serde_json::json!(text));
            assert_eq!(
                serde_json::from_value::<ChromeSize>(serde_json::json!(text)).unwrap(),
                value
            );
        }
    }

    #[test]
    fn status_size_uses_the_same_words_as_the_frontend() {
        // off 是小写：前端枚举写的就是 "off"，camelCase 不会变，但这四个词必须完全对上。
        for (value, text) in [
            (StatusSize::Off, "off"),
            (StatusSize::Small, "small"),
            (StatusSize::Normal, "normal"),
            (StatusSize::Large, "large"),
        ] {
            assert_eq!(serde_json::to_value(value).unwrap(), serde_json::json!(text));
            assert_eq!(
                serde_json::from_value::<StatusSize>(serde_json::json!(text)).unwrap(),
                value
            );
        }
    }

    #[test]
    fn document_without_later_fields_falls_back_to_defaults() {
        // 字号和工具栏是后加的字段，磁盘上早于它们的文档必须照常打开。
        let dir = test_dir();
        let note = Note::new(
            "n1".into(),
            Rect::new(0.0, 0.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        );
        let mut value = serde_json::to_value(&note).unwrap();
        let object = value.as_object_mut().unwrap();
        // 字体功能删了，磁盘上早于它的文档仍带 font：读进来必须忽略这个键。
        object.insert("font".into(), serde_json::json!("songti"));
        object.remove("fontSize");
        object.remove("toolbar");
        object.remove("maximized");
        object.remove("restoreFrame");
        object.remove("chromeSize");
        object.remove("statusSize");
        object.remove("statusFaded");
        write_raw(&dir, "n1", &value);

        let loaded = load(&dir, "n1").unwrap();
        assert_eq!(loaded.font_size, DEFAULT_FONT_SIZE);
        assert!(!loaded.toolbar);
        assert_eq!(loaded.chrome_size, ChromeSize::Normal);
        assert_eq!(loaded.status_size, StatusSize::Normal);
        assert!(loaded.status_faded);
        assert!(!loaded.maximized);
        assert_eq!(loaded.restore_frame, None);
    }

    #[test]
    fn status_faded_false_survives_save_and_load() {
        // 默认是 true，于是 false 只能靠显式写入：存不回来等于开关按了没用。
        let dir = test_dir();
        let mut note = Note::new(
            "n1".into(),
            Rect::new(0.0, 0.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        );
        note.status_faded = false;
        note.status_size = StatusSize::Off;
        save(&dir, &note).unwrap();

        let loaded = load(&dir, "n1").unwrap();
        assert!(!loaded.status_faded);
        assert_eq!(loaded.status_size, StatusSize::Off);
    }

    #[test]
    fn font_size_outside_the_zoom_range_is_rejected() {
        let dir = test_dir();
        for size in [0.0, MIN_FONT_SIZE - 1.0, MAX_FONT_SIZE + 1.0] {
            let note = Note::new(
                "n1".into(),
                Rect::new(0.0, 0.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
            );
            let mut value = serde_json::to_value(&note).unwrap();
            value["fontSize"] = serde_json::json!(size);
            write_raw(&dir, "n1", &value);

            assert!(
                matches!(load(&dir, "n1"), Err(NoteError::Invalid(_))),
                "{size} 应被拒绝"
            );
        }
    }

    #[test]
    fn multi_page_document_keeps_every_page_through_save_and_load() {
        // 界面已经不提供分页入口，但旧文档里的多页正文必须原样存取。
        let dir = test_dir();
        let mut note = Note::new(
            "n1".into(),
            Rect::new(10.0, 20.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        );
        for text in ["第一页", "第二页", "第三页"] {
            let page = uuid::Uuid::new_v4().to_string();
            note.content.insert(
                page.clone(),
                serde_json::json!({
                    "type": "doc",
                    "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }],
                }),
            );
            note.tabs.push(page.clone());
            note.active_tab = page;
        }
        save(&dir, &note).unwrap();

        let loaded = load(&dir, "n1").unwrap();

        assert_eq!(loaded.tabs, note.tabs);
        assert_eq!(loaded.active_tab, note.active_tab);
        assert_eq!(loaded.content.len(), 4);
        assert_eq!(loaded.content, note.content);
    }

    #[test]
    fn interrupted_replace_keeps_previous_document() {
        let dir = test_dir();
        let mut note = Note::new(
            "n1".into(),
            Rect::new(10.0, 20.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        );
        note.title = "第一版".into();
        save(&dir, &note).unwrap();

        let dest = note_path(&dir, "n1");
        let before = fs::read(&dest).unwrap();

        // 模拟替换中断：临时文件已经写完并落盘，但还没有 rename。
        note.title = "第二版".into();
        let tmp = write_temp(&dest, &note).unwrap();
        assert!(tmp.exists());
        assert_eq!(fs::read(&dest).unwrap(), before);
        assert_eq!(
            serde_json::from_slice::<Note>(&fs::read(&dest).unwrap())
                .unwrap()
                .title,
            "第一版"
        );

        // 完成替换后目标文件是新的完整文档，临时文件不再存在。
        commit(&tmp, &dest).unwrap();
        assert!(!tmp.exists());
        let after: Note = serde_json::from_slice(&fs::read(&dest).unwrap()).unwrap();
        assert_eq!(after, note);
    }

    #[test]
    fn temp_file_sits_next_to_target() {
        let dir = test_dir().join("notes");
        let dest = note_path(&dir, "n1");
        let note = Note::new(
            "n1".into(),
            Rect::new(0.0, 0.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        );

        let tmp = write_temp(&dest, &note).unwrap();

        assert_eq!(tmp.parent(), dest.parent());
        assert_eq!(tmp.file_name().unwrap(), "n1.json.tmp");
    }

    #[test]
    fn save_creates_missing_directory() {
        let dir = test_dir().join("notes");
        let note = Note::new(
            "n2".into(),
            Rect::new(0.0, 0.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        );

        save(&dir, &note).unwrap();

        let stored: Note =
            serde_json::from_slice(&fs::read(note_path(&dir, "n2")).unwrap()).unwrap();
        assert_eq!(stored, note);
    }

    fn write_raw(dir: &Path, id: &str, value: &serde_json::Value) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        let path = note_path(dir, id);
        fs::write(&path, value.to_string()).unwrap();
        path
    }

    /// 读坏文档必须返回 Err 且不碰原文件。窗口只能拿 Ok 的 Note 去开，
    /// 所以 Err 在这里就断掉了创建窗口的路径。
    #[test]
    fn missing_field_is_rejected_without_rewriting() {
        let dir = test_dir();
        let note = Note::new(
            "n1".into(),
            Rect::new(0.0, 0.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        );
        let mut value = serde_json::to_value(&note).unwrap();
        value.as_object_mut().unwrap().remove("pinned");
        let path = write_raw(&dir, "n1", &value);
        let before = fs::read(&path).unwrap();

        assert!(matches!(load(&dir, "n1"), Err(NoteError::Invalid(_))));
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn wrong_field_type_is_rejected_without_rewriting() {
        let dir = test_dir();
        let note = Note::new(
            "n1".into(),
            Rect::new(0.0, 0.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        );
        let mut value = serde_json::to_value(&note).unwrap();
        value["pinned"] = serde_json::json!("yes");
        let path = write_raw(&dir, "n1", &value);
        let before = fs::read(&path).unwrap();

        assert!(matches!(load(&dir, "n1"), Err(NoteError::Invalid(_))));
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn unknown_paper_value_is_rejected() {
        let dir = test_dir();
        let note = Note::new(
            "n1".into(),
            Rect::new(0.0, 0.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        );
        let mut value = serde_json::to_value(&note).unwrap();
        value["paper"] = serde_json::json!("neon");
        let path = write_raw(&dir, "n1", &value);
        let before = fs::read(&path).unwrap();

        assert!(matches!(load(&dir, "n1"), Err(NoteError::Invalid(_))));
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn active_tab_outside_tabs_is_rejected() {
        let dir = test_dir();
        let note = Note::new(
            "n1".into(),
            Rect::new(0.0, 0.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        );
        let mut value = serde_json::to_value(&note).unwrap();
        value["activeTab"] = serde_json::json!("不存在");
        let path = write_raw(&dir, "n1", &value);
        let before = fs::read(&path).unwrap();

        assert!(matches!(load(&dir, "n1"), Err(NoteError::Invalid(_))));
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn tab_without_content_is_rejected() {
        let dir = test_dir();
        let note = Note::new(
            "n1".into(),
            Rect::new(0.0, 0.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        );
        let mut value = serde_json::to_value(&note).unwrap();
        value["content"] = serde_json::json!({});
        write_raw(&dir, "n1", &value);

        assert!(matches!(load(&dir, "n1"), Err(NoteError::Invalid(_))));
    }

    #[test]
    fn collapsed_without_expanded_size_is_rejected() {
        let dir = test_dir();
        let mut note = Note::new(
            "n1".into(),
            Rect::new(0.0, 0.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        );
        note.collapsed = true;
        let value = serde_json::to_value(&note).unwrap();
        write_raw(&dir, "n1", &value);

        assert!(matches!(load(&dir, "n1"), Err(NoteError::Invalid(_))));
    }

    #[test]
    fn saved_document_loads_back_unchanged() {
        let dir = test_dir();
        let mut note = Note::new(
            "n1".into(),
            Rect::new(5.0, 6.0, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        );
        note.paper = Paper::PaleSky;
        note.pattern = Pattern::Grid;
        save(&dir, &note).unwrap();

        assert_eq!(load(&dir, "n1").unwrap(), note);
    }

    #[test]
    fn old_collapsed_document_opens_expanded() {
        // 折叠入口已经移除，旧文档必须自己回到展开尺寸，否则用户没有别的办法展开它。
        let dir = test_dir();
        let mut note = Note::new("n1".into(), Rect::new(5.0, 6.0, DEFAULT_WIDTH, 20.0));
        note.collapsed = true;
        note.expanded_size = Some(Size {
            width: 640.0,
            height: 480.0,
        });
        save(&dir, &note).unwrap();

        let opened = load(&dir, "n1").unwrap();

        assert!(!opened.collapsed);
        assert_eq!(opened.expanded_size, None);
        assert_eq!(opened.frame, Rect::new(5.0, 6.0, 640.0, 480.0));
    }

    #[test]
    fn old_paper_names_still_open_and_land_on_the_nearest_new_colour() {
        // 换色板前的旧颜色全是 alias：认不出来就会拒绝打开，用户会以为便签丢了。
        // 覆盖三代旧名，别只测最近这一代。
        for (old, expected) in [
            // 第一代
            ("ivory", Paper::AlabasterGrey),
            ("mistBlue", Paper::PaleSky),
            ("sage", Paper::PaleSky),
            ("terracotta", Paper::CottonCandy),
            ("straw", Paper::LightApricot),
            // 第二代（换到 Soft Pastel Dreams 之前那版）
            ("dustGrey", Paper::AlabasterGrey),
            ("blush", Paper::PowderBlush),
            ("apricot", Paper::PeachFuzz),
            ("pearlBeige", Paper::LightApricot),
            ("frozenWater", Paper::PaleSky),
            ("thistle", Paper::Periwinkle),
            ("pastelPetal", Paper::CottonCandy),
            ("cottonRose", Paper::CottonCandy),
        ] {
            let parsed: Paper =
                serde_json::from_value(serde_json::Value::String(old.into())).unwrap();
            assert_eq!(parsed, expected, "{old} 应当落到最接近的新色");
        }
        assert!(serde_json::from_value::<Paper>(serde_json::json!("unknown")).is_err());
    }

    #[test]
    fn second_palette_writes_and_reads_back_the_names_the_frontend_uses() {
        // 前端 document.ts 的 PAPER 是逐字对应这里的 camelCase 名字：
        // 拼错一个字母，写出去的文档前端就再也读不回来。
        for (written, expected) in [
            ("charcoalBlue", Paper::CharcoalBlue),
            ("pineBlue", Paper::PineBlue),
            ("verdigris", Paper::Verdigris),
            ("mutedOlive", Paper::MutedOlive),
            ("drySage", Paper::DrySage),
            ("tuscanSun", Paper::TuscanSun),
            ("sunlitClay", Paper::SunlitClay),
            ("sandyBrown", Paper::SandyBrown),
            ("coralGlow", Paper::CoralGlow),
            ("burntPeach", Paper::BurntPeach),
        ] {
            let parsed: Paper =
                serde_json::from_value(serde_json::Value::String(written.into())).unwrap();
            assert_eq!(parsed, expected);
            assert_eq!(serde_json::to_value(expected).unwrap(), serde_json::json!(written));
        }
    }
    #[test]
    fn missing_file_is_an_io_error() {
        let dir = test_dir();

        assert!(matches!(load(&dir, "没有这个"), Err(NoteError::Io(_))));
    }

    #[test]
    fn list_ids_reads_json_documents_only() {
        let dir = test_dir();
        save(&dir, &Note::new("b".into(), Rect::new(0.0, 0.0, 1.0, 1.0))).unwrap();
        save(&dir, &Note::new("a".into(), Rect::new(0.0, 0.0, 1.0, 1.0))).unwrap();
        fs::write(dir.join("a.json.tmp"), "半截").unwrap();
        fs::write(dir.join("备注.txt"), "无关文件").unwrap();

        assert_eq!(
            list_ids(&dir).unwrap(),
            vec!["a".to_string(), "b".to_string()]
        );
    }

    #[test]
    fn list_ids_of_missing_directory_is_empty() {
        let dir = test_dir().join("还没有");

        assert!(list_ids(&dir).unwrap().is_empty());
    }
}
