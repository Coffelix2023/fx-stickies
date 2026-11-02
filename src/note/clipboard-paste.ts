import { invoke } from "@tauri-apps/api/core";
import { Extension, type Editor } from "@tiptap/core";

import { encodeClipboardImage, type ClipboardImage } from "./image-paste";
import { insertPastedText } from "./plain-text-paste";

/** Rust 侧 `read_clipboard` 的返回。 */
type ClipboardContent =
  | ({ kind: "image" } & ClipboardImage)
  | { kind: "text"; text: string }
  | { kind: "empty" };

/**
 * ⌘/Ctrl+V 由自己接管。
 *
 * 走 webview 的 paste 事件拿不到 Finder 里复制的图片：剪贴板上只有一条文件 URL，
 * 事件里既没有 `files` 也没有像素，只能由 Rust 侧读剪贴板。既然要等一次异步结果，
 * 按键就先整块吃掉，再由我们决定插图片还是走原来的 Markdown 文本通路。
 */
async function pasteFromSystemClipboard(editor: Editor): Promise<void> {
  try {
    if (editor.isDestroyed) return;
    const content = await invoke<ClipboardContent>("read_clipboard");
    if (editor.isDestroyed) return;

    if (content.kind === "text") {
      insertPastedText(editor, content.text);
      return;
    }
    if (content.kind !== "image") return;

    const src = await encodeClipboardImage(content);
    if (!src || editor.isDestroyed) return;
    // 宽度交给正文栏（CSS width: 100%），高度按比例，所以不带像素宽高。
    editor.commands.insertContent({ type: "image", attrs: { src } });
  } catch (err: unknown) {
    // 粘贴失败不该让编辑器停摆：剪贴板可能被别的进程占着，或者图解不出来。
    console.error("粘贴剪贴板内容失败", err);
  }
}

export const SystemClipboardPaste = Extension.create({
  name: "systemClipboardPaste",

  addKeyboardShortcuts() {
    return {
      "Mod-v": () => {
        // 同步返回 true 才算吃掉按键：晚一步 webview 就会自己粘一遍，
        // 而它粘不到文件型图片，于是这一次粘贴等于什么都没发生。
        void pasteFromSystemClipboard(this.editor);
        return true;
      },
    };
  },
});
