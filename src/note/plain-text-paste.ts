import { Extension, type Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

import { fenceBody } from "./fenced-paragraph";

/**
 * 外部文本粘贴只取纯文本，再识别其中的 Markdown。
 *
 * 不把 HTML 交给编辑器解析，来源字体、颜色和链接样式因此进不来；
 * 插入的文字继承当前正文样式。
 */
/**
 * 把单行围栏摊成多行。
 *
 * CommonMark 把段落里的 ```内容``` 读成行内代码，粘进来只会得到一段 `<code>`；
 * 摊成开头一行、内容一行、结尾一行，才是代码块。
 */
function spreadFence(text: string): string {
  const body = fenceBody(text);
  return body === null ? text : `\`\`\`\n${body}\n\`\`\``;
}

/**
 * 统一换行，去掉首尾空行。
 *
 * 剪贴板里的纯文本常以换行收尾，按块插入会在末尾多出一个空段落，
 * 用户看到的是「粘完最后多一行」。
 */
function trimBlankLines(raw: string): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && (lines[0] ?? "").trim() === "") lines.shift();
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();
  return lines.join("\n");
}

/**
 * 把一段纯文本按 Markdown 插到光标处。
 *
 * 解析出来只有一个段落时按行内插：整块插会把光标所在的段落切成两段，
 * 用户看到的是「粘贴总是另起一行」，段落外边距还把行距撑宽。
 */
export function insertPastedText(editor: Editor, raw: string): boolean {
  const text = trimBlankLines(raw);
  // 只粘了空行：什么都不插，也不在文档里留下空段落。
  if (!text) return true;

  const markdown = editor.markdown;
  if (!markdown) return false;

  // 只解析纯文本里的 Markdown。来源 HTML 的字体、颜色和链接不进入文档，
  // 插入结果继承当前正文样式。
  const parsed = markdown.parse(spreadFence(text));
  const blocks = parsed.content ?? [];
  const only = blocks[0];
  if (blocks.length === 1 && only?.type === "paragraph" && only.content) {
    return editor.commands.insertContent(only.content);
  }
  return editor.commands.insertContent(parsed);
}

/** 剪贴板里的纯文本粘贴。没有纯文本（例如图片文件）时交回默认处理。 */
export function pastePlainText(
  editor: Editor,
  clipboard: DataTransfer | null,
): boolean {
  const raw = clipboard?.getData("text/plain");
  if (!raw) return false;
  return insertPastedText(editor, raw);
}

export const PlainTextPaste = Extension.create({
  name: "plainTextPaste",

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handlePaste: (_view, event) => pastePlainText(editor, event.clipboardData),
        },
      }),
    ];
  },
});
