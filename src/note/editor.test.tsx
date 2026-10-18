import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import type { NoteContent } from "./document";
import { NoteBody, useNoteEditor } from "./editor";

/** 用真实的 Tiptap 实例挂载一个正文区域。 */
function Body({
  content,
  onChange = () => {},
}: {
  content: NoteContent;
  onChange?: (content: NoteContent) => void;
}) {
  const editor = useNoteEditor(content, onChange, "p1");
  return <NoteBody editor={editor} />;
}


const empty = (): NoteContent => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});

function paste(target: Element, text: string, html?: string) {
  const data: Record<string, string> = { "text/plain": text };
  if (html) data["text/html"] = html;
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => data[type] ?? "" },
  });
  target.dispatchEvent(event);
}

afterEach(cleanup);

describe("所见即所得正文", () => {
  it("把 JSON 里的排版直接显示出来", () => {
    const content: NoteContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "标题文字" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "普通" },
            { type: "text", marks: [{ type: "bold" }], text: "加粗" },
            { type: "text", marks: [{ type: "italic" }], text: "斜体" },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "列表项" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const { container } = render(<Body content={content} />);

    expect(container.querySelector("h3")?.textContent).toBe("标题文字");
    expect(container.querySelector("strong")?.textContent).toBe("加粗");
    expect(container.querySelector("em")?.textContent).toBe("斜体");
    expect(container.querySelector("li")?.textContent).toContain("列表项");
    expect(container.textContent).not.toContain("**加粗**");
  });
});

describe("粘贴", () => {
  it("带格式的外部文本只留下文字", async () => {
    const { container } = render(<Body content={empty()} />);
    const editable = container.querySelector(".ProseMirror") as HTMLElement;

    paste(
      editable,
      "只有文字",
      '<p><strong>粗</strong><a href="https://example.com">链接</a></p>',
    );

    await waitFor(() =>
      expect(container.textContent).toContain("只有文字"),
    );
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).not.toContain("粗");
  });

  it("单个换行仍属于同一段", async () => {
    const { container } = render(<Body content={empty()} />);
    const editable = container.querySelector(".ProseMirror") as HTMLElement;

    paste(editable, "第一行\n第二行");

    await waitFor(() => expect(container.textContent).toContain("第二行"));
    const paragraphs = [...container.querySelectorAll(".ProseMirror > p")];
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].querySelector("br")).toBeNull();
    expect(paragraphs[0].textContent).toBe(`第一行
第二行`);
  });

  it("空行把普通文本分成两段", async () => {
    const { container } = render(<Body content={empty()} />);
    const editable = container.querySelector(".ProseMirror") as HTMLElement;

    paste(editable, "第一行\n\n第二行");

    await waitFor(() => expect(container.textContent).toContain("第二行"));
    const paragraphs = [...container.querySelectorAll(".ProseMirror > p")];
    expect(paragraphs.map((p) => p.textContent)).toEqual(["第一行", "第二行"]);
  });

  it("识别标题、行内代码、代码块和分割线", async () => {
    const { container } = render(<Body content={empty()} />);
    const editable = container.querySelector(".ProseMirror") as HTMLElement;

    paste(editable, "# 大标题\n\n`代码`\n\n```\nconst n = 1\n```\n\n---");

    await waitFor(() => expect(container.querySelector("hr")).not.toBeNull());
    expect(container.querySelector("h1")?.textContent).toBe("大标题");
    expect(container.querySelector("p code")?.textContent).toBe("代码");
    expect(container.querySelector("pre")?.textContent).toContain("const n = 1");
  });

  it("识别 Markdown 表格，并丢掉来源字体", async () => {
    const { container } = render(<Body content={empty()} />);
    const editable = container.querySelector(".ProseMirror") as HTMLElement;

    paste(
      editable,
      "| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 2 |",
      '<table style="font-family:SimSun"><tr><td>苹果</td></tr></table>',
    );

    await waitFor(() => expect(container.querySelector("table")).not.toBeNull());
    const cells = [...container.querySelectorAll("td, th")].map((cell) => cell.textContent);
    expect(cells).toEqual(expect.arrayContaining(["名称", "数量", "苹果", "2"]));
    expect(container.querySelector("[style*='SimSun']")).toBeNull();
    expect(container.innerHTML).not.toContain("SimSun");
  });
});


describe("图像", () => {
  const image = (): NoteContent => ({
    type: "doc",
    content: [
      {
        type: "image",
        attrs: {
          src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
          width: 2000,
          height: 1000,
        },
      },
    ],
  });

  it("图像不带原始像素宽度，宽度交给所在栏", () => {
    const { container } = render(<Body content={image()} />);

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    // 不写死像素宽度，宽图因此撑不开便签
    expect(img?.getAttribute("width")).toBeNull();
    expect(img?.getAttribute("style") ?? "").not.toContain("2000");
    // 宽度规则落在正文区域内的图像上
    expect(img?.closest(".note-body")).not.toBeNull();
  });

  it("正文图像的宽度规则是 100%", () => {
    const css = readFileSync("src/App.css", "utf8");
    expect(css).toMatch(/\.note-body img\s*\{[^}]*width:\s*100%/);
    expect(css).toMatch(/\.note-body img\s*\{[^}]*height:\s*auto/);
  });
});
