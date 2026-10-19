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

export function pastePlainText(
  editor: Editor,
  clipboard: DataTransfer | null,
): boolean {
  const text = clipboard?.getData("text/plain");
  if (!text) {
    // 没有纯文本（例如粘贴图片）时交回默认处理。
    return false;
  }

  // 只解析纯文本里的 Markdown。来源 HTML 的字体、颜色和链接不进入文档，
  // 插入结果继承当前正文样式。
  return editor.commands.insertContent(spreadFence(text), { contentType: "markdown" });
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
