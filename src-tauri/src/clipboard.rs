//! 系统剪贴板取图。
//!
//! 两种来源必须分开处理：Finder 里复制的图片在剪贴板上只是一条文件 URL，
//! 里面没有像素，只能自己去读文件；截图复制的才是位图，直接把 RGBA 交给前端。
//! 前端拿到的都是可以交给画布重编码的东西，宽度适配和压缩都在那一侧做。

use std::path::{Path, PathBuf};
use std::process::Command;

use arboard::Clipboard;
use base64::Engine as _;
use serde::Serialize;

/// 读到的剪贴板内容。`width` / `height` 只有位图那一路有：文件那一路由前端解码时自己量。
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ClipboardContent {
    Image {
        /// base64。位图那一路是 RGBA 原始像素，其余是文件原文。
        data: String,
        /// 位图那一路固定是 `image/rgba`，前端据此走 ImageData 而不是 Blob。
        mime: String,
        width: Option<u32>,
        height: Option<u32>,
    },
    Text {
        text: String,
    },
    Empty,
}

/// 文件类型：能直接交给前端解码的给 mime，要转换的单独标出来。
#[derive(Debug, PartialEq)]
enum FileKind {
    Ready(&'static str),
    /// HEIC/HEIF。webview 解不动，先在系统侧转成 JPEG。
    NeedsConvert,
}

/// 按扩展名判断这张文件是不是图片。不认的一律 None：剪贴板上可能是个文件夹或 PDF。
fn file_kind(path: &Path) -> Option<FileKind> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some(FileKind::Ready("image/png")),
        "jpg" | "jpeg" => Some(FileKind::Ready("image/jpeg")),
        "gif" => Some(FileKind::Ready("image/gif")),
        "webp" => Some(FileKind::Ready("image/webp")),
        "heic" | "heif" => Some(FileKind::NeedsConvert),
        _ => None,
    }
}

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// HEIC 交给系统自带的 `sips` 转成 JPEG：`image` 那套解码库不认 HEIC，
/// 而 macOS 上 `sips` 一定有，多引一个解码器不值得。
fn convert_with_sips(path: &Path) -> Result<Vec<u8>, String> {
    let out = std::env::temp_dir().join(format!("fx-stickies-{}.jpg", uuid::Uuid::new_v4()));
    let status = Command::new("sips")
        .args(["-s", "format", "jpeg"])
        .arg(path)
        .arg("--out")
        .arg(&out)
        .status()
        .map_err(|err| format!("转换 HEIC 失败: {err}"))?;
    if !status.success() {
        return Err("转换 HEIC 失败：sips 返回了错误".into());
    }
    let bytes = std::fs::read(&out).map_err(|err| format!("读取转换结果失败: {err}"))?;
    // 临时文件只是中转，读出来就没用了。
    let _ = std::fs::remove_file(&out);
    Ok(bytes)
}

/// 从文件列表里取一张图片。只认单张：多选时说不清该插哪一张，交给用户重选。
fn image_from_files(files: &[PathBuf]) -> Option<Result<ClipboardContent, String>> {
    let [path] = files else { return None };
    let path: &Path = path;
    let kind = file_kind(path)?;
    let (bytes, mime) = match kind {
        FileKind::Ready(mime) => (std::fs::read(path).ok()?, mime),
        FileKind::NeedsConvert => (convert_with_sips(path).ok()?, "image/jpeg"),
    };
    Some(Ok(ClipboardContent::Image {
        data: encode(&bytes),
        mime: mime.into(),
        width: None,
        height: None,
    }))
}

/// 读一次系统剪贴板。优先级：图片文件 → 位图 → 文本 → 空。
pub fn read() -> Result<ClipboardContent, String> {
    let mut clipboard = Clipboard::new().map_err(|err| format!("打不开剪贴板: {err}"))?;

    if let Ok(files) = clipboard.get().file_list()
        && let Some(found) = image_from_files(&files) {
            return found;
        }

    if let Ok(image) = clipboard.get().image() {
        // 位图原样交给前端：它自己缩到上限再重编码，这里不引解码器。
        // shortcut: 中转体积是 RGBA 的 4/3（一张 5K 截图约 60MB → 80MB 字符串）；
        // 屏幕分辨率继续涨、或者粘贴明显卡顿时，在 Rust 侧先缩放或编码成 PNG 再送。
        return Ok(ClipboardContent::Image {
            data: encode(&image.bytes),
            mime: "image/rgba".into(),
            width: Some(image.width as u32),
            height: Some(image.height as u32),
        });
    }

    match clipboard.get().text() {
        Ok(text) => Ok(ClipboardContent::Text { text }),
        Err(_) => Ok(ClipboardContent::Empty),
    }
}

#[cfg(test)]
mod tests {
    use super::{FileKind, file_kind};
    use std::path::Path;

    #[test]
    fn only_image_extensions_are_images() {
        assert_eq!(
            file_kind(Path::new("/tmp/a.PNG")),
            Some(FileKind::Ready("image/png"))
        );
        assert_eq!(
            file_kind(Path::new("/tmp/a.jpeg")),
            Some(FileKind::Ready("image/jpeg"))
        );
        // HEIC 要转码，webview 自己解不动
        assert_eq!(
            file_kind(Path::new("/tmp/a.HEIC")),
            Some(FileKind::NeedsConvert)
        );
        // 文件夹、文档不当图片粘
        assert_eq!(file_kind(Path::new("/tmp/a.pdf")), None);
        assert_eq!(file_kind(Path::new("/tmp/a")), None);
    }
}
