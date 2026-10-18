import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";

import type { JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import type { NoteContent } from "./document";
import { NoteBody, NoteStatus, NoteToolbar, useNoteEditor } from "./editor";

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

/** 滚动箭头到头了会置灰而不是消失。没装 jest-dom，直接读属性。 */
function disabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled;
}

/** 只挂一个编辑器，不渲染任何界面：按键和计数行为用不着看得见的东西。 */
function Harness({
  content,
  expose,
}: {
  content: NoteContent;
  expose: (editor: Editor | null) => void;
}) {
  const editor = useNoteEditor(content, () => {}, "p1");
  expose(editor);
  return null;
}

/** 工具栏挂在真实编辑器上，同时把编辑器交给测试。 */
function ToolbarBar({
  content,
  expose,
}: {
  content: NoteContent;
  expose: (editor: Editor | null) => void;
}) {
  const editor = useNoteEditor(content, () => {}, "p1");
  expose(editor);
  return <NoteToolbar editor={editor} />;
}

/** 挂一个带工具栏的编辑器，等它建好。 */
async function mountToolbar(content: NoteContent) {
  const ref: { current: Editor | null } = { current: null };
  render(<ToolbarBar content={content} expose={(value) => (ref.current = value)} />);
  await waitFor(() => expect(ref.current).not.toBeNull());
  return ref.current as Editor;
}

/** 挂一个裸编辑器，等它建好。 */
async function mount(content: NoteContent) {
  // 挂在一个 ref 上：编辑器是渲染后才有的，直接用局部变量 TS 会当成 never。
  const ref: { current: Editor | null } = { current: null };
  render(<Harness content={content} expose={(value) => (ref.current = value)} />);
  await waitFor(() => expect(ref.current).not.toBeNull());
  return ref.current as Editor;
}

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

describe("Markdown 工具栏", () => {
  /** 工具栏挂在真实的编辑器上，按钮点的是真的命令；编辑器交给测试自己摆选区。 */
  function Toolbar({
    content,
    expose,
  }: {
    content: NoteContent;
    expose: (editor: Editor | null) => void;
  }) {
    const editor = useNoteEditor(content, () => {}, "p1");
    expose(editor);
    return <NoteToolbar editor={editor} />;
  }

  const para = (value: string, marks?: { type: string }[]): NoteContent => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", ...(marks ? { marks } : {}), text: value }],
      },
    ],
  });

  /** 挂一个工具栏，等编辑器建好并选中全文。 */
  async function selectAll(content: NoteContent) {
    // 挂在一个 ref 上：编辑器是渲染后才有的，直接用局部变量 TS 会当成 never。
    const ref: { current: Editor | null } = { current: null };
    render(<Toolbar content={content} expose={(value) => (ref.current = value)} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    ref.current?.commands.selectAll();
    return ref.current as Editor;
  }


  it("每个操作都有按钮，一个都不能漏掉", async () => {
    render(<Toolbar content={para("要点")} expose={() => {}} />);

    const labels = [
      "撤销", "重做",
      "一级标题", "二级标题", "三级标题",
      "粗体", "斜体", "删除线", "行内代码",
      "无序列表", "有序列表", "引用",
      "代码块", "分割线",
      "缩进", "减少缩进",
      "左对齐", "居中对齐", "右对齐",
    ];
    for (const label of labels) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    // 上面 19 项按 after 标记切成 7 组，组间 6 条线
    expect(document.querySelectorAll(".note-toolbar button")).toHaveLength(labels.length);
    expect(document.querySelectorAll(".note-toolbar-sep")).toHaveLength(6);
  });

  it("按钮把命令跑在编辑器上", async () => {
    const editor = await selectAll(para("要点"));

    fireEvent.click(screen.getByRole("button", { name: "粗体" }));

    await waitFor(() =>
      expect(editor.getJSON().content?.[0]).toMatchObject({
        content: [{ marks: [{ type: "bold" }], text: "要点" }],
      }),
    );
  });

  it("选区上的格式显示为生效中", async () => {
    await selectAll(para("粗", [{ type: "bold" }]));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "粗体" }).getAttribute("aria-pressed")).toBe("true"),
    );
  });

  it("对齐写进段落，对齐按钮跟着显示生效", async () => {
    const editor = await selectAll(para("要点"));

    fireEvent.click(screen.getByRole("button", { name: "居中对齐" }));

    await waitFor(() =>
      expect(editor.getJSON().content?.[0]).toMatchObject({
        attrs: { textAlign: "center" },
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "居中对齐" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "左对齐" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("mousedown 不抢焦点，否则选区会被吃掉", () => {
    render(<Toolbar content={para("要点")} expose={() => {}} />);

    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    screen.getByRole("button", { name: "粗体" }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("Tab 缩进", () => {
  const para = (value: string): NoteContent => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
  });

  const list = (): NoteContent => ({
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "第一项" }] },
            ],
          },
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "第二项" }] },
            ],
          },
        ],
      },
    ],
  });

  it("普通段落里 Tab 插一个制表符，Shift+Tab 退掉", async () => {
    const editor = await mount(para("要点"));

    editor.commands.keyboardShortcut("Tab");
    expect(editor.getText()).toBe("\t要点");

    editor.commands.keyboardShortcut("Shift-Tab");
    expect(editor.getText()).toBe("要点");
  });

  it("粘贴来的空格缩进也退得掉", async () => {
    const editor = await mount(para("  要点"));

    editor.commands.keyboardShortcut("Shift-Tab");
    expect(editor.getText()).toBe("要点");
  });

  it("没有缩进时 Shift+Tab 什么都不改", async () => {
    const editor = await mount(para("要点"));

    editor.commands.keyboardShortcut("Shift-Tab");
    expect(editor.getText()).toBe("要点");
  });

  it("列表里 Tab 把当前项缩进一层，Shift+Tab 退回来", async () => {
    const editor = await mount(list());
    // 光标落在最后一项，也就是用户正在编辑的那一项
    editor.commands.focus("end");

    editor.commands.keyboardShortcut("Tab");
    const nested = (editor.getJSON() as JSONContent).content?.[0];
    expect(nested?.content).toHaveLength(1);
    // 缩进后第二项嵌进第一项里，变成外层列表里的嵌套列表
    expect(nested?.content?.[0].content?.[1]?.type).toBe("bulletList");

    editor.commands.keyboardShortcut("Shift-Tab");
    expect((editor.getJSON() as JSONContent).content?.[0].content).toHaveLength(2);
  });
});

describe("右下角字符数", () => {
  /** 状态栏挂在真实编辑器上，数字跟着编辑器和选区一起变。 */
  function Status({
    content,
    expose,
  }: {
    content: NoteContent;
    expose: (editor: Editor | null) => void;
  }) {
    const editor = useNoteEditor(content, () => {}, "p1");
    expose(editor);
    return <NoteStatus editor={editor} size="small" faded />;
  }

  const doc = (): NoteContent => ({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "标题" }] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "一二三" }] }],
          },
        ],
      },
    ],
  });

  async function renderStatus() {
    const ref: { current: Editor | null } = { current: null };
    render(<Status content={doc()} expose={(value) => (ref.current = value)} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    return ref.current as Editor;
  }

  it("只数正文文字，不数标记和换行", async () => {
    await renderStatus();

    // 「标题」两个 + 「一二三」三个；# 和 * 是标记，不算
    expect(screen.getByLabelText("字符数").textContent).toBe("5");
  });

  it("选中文字时显示选中数 / 总数", async () => {
    const editor = await renderStatus();

    editor.commands.setTextSelection({ from: 1, to: 3 });

    await waitFor(() =>
      expect(screen.getByLabelText("字符数").textContent).toBe("2 / 5"),
    );
  });

  it("光标取消选中后回到只显示总数", async () => {
    const editor = await renderStatus();
    editor.commands.setTextSelection({ from: 1, to: 3 });
    await waitFor(() =>
      expect(screen.getByLabelText("字符数").textContent).toBe("2 / 5"),
    );

    editor.commands.setTextSelection(1);

    await waitFor(() => expect(screen.getByLabelText("字符数").textContent).toBe("5"));
  });
});

describe("块级命令与样式", () => {
  const para = (value: string): NoteContent => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
  });

  it("引用块有样式，否则包上了也看不出来", () => {
    const css = readFileSync("src/App.css", "utf8");
    // 之前这条规则根本不存在：引用只有浏览器默认缩进，在纸上和普通段落一模一样，
    // 用户点完看不出任何变化，只会觉得「引用没反应」。
    expect(css).toMatch(/\.note-body blockquote\s*\{[^}]*border-left/);
    expect(css).toMatch(/\.note-body blockquote\s*\{[^}]*padding/);
  });

  it("编辑器没被点过时，引用仍作用在正文上", async () => {
    const editor = await mountToolbar(para("引文"));
    // 便签刚打开、正文一次都没被点过：编辑器没有焦点，块级命令本会落空
    expect(editor.view.hasFocus()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "引用" }));

    // 文字确实被包进了引用块
    expect(editor.getJSON().content?.[0]?.type).toBe("blockquote");
  });

  it("缩进按钮在列表里嵌一层，退回来", async () => {
    const editor = await mountToolbar({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "一" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "二" }] }],
            },
          ],
        },
      ],
    });
    editor.commands.focus("end");

    fireEvent.click(screen.getByRole("button", { name: "缩进" }));
    expect(editor.getJSON().content?.[0].content).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "减少缩进" }));
    expect(editor.getJSON().content?.[0].content).toHaveLength(2);
  });

  it("便签窄到装不下时两端架箭头，滚到头对应那端变禁用", async () => {
    render(<ToolbarBar content={para("要点")} expose={() => {}} />);
    const track = document.querySelector(".note-toolbar-track") as HTMLElement;
    // jsdom 不做布局，宽度得自己造：内容 400px、窗口只有 200px
    Object.defineProperty(track, "scrollWidth", { value: 400, configurable: true });
    Object.defineProperty(track, "clientWidth", { value: 200, configurable: true });
    const scrollBy = vi.fn();
    Object.defineProperty(track, "scrollBy", { value: scrollBy, configurable: true });

    // 还没滚：两枚都在，左边那枚到头了所以禁用，右侧渐隐也挂上
    fireEvent.scroll(track);
    await waitFor(() => expect(track.getAttribute("data-more")).toBe("true"));
    const left = screen.getByRole("button", { name: "向左看前面的工具项" });
    const right = screen.getByRole("button", { name: "向右看后面的工具项" });
    expect(disabled(left)).toBe(true);
    expect(disabled(right)).toBe(false);
    fireEvent.click(right);
    expect(scrollBy).toHaveBeenCalledWith({ left: 60, behavior: "smooth" });

    // 滚到底：两枚都还在，右边那枚换成禁用，渐隐收掉
    Object.defineProperty(track, "scrollLeft", { value: 200, configurable: true });
    fireEvent.scroll(track);
    await waitFor(() => expect(track.getAttribute("data-more")).toBe("false"));
    expect(disabled(screen.getByRole("button", { name: "向右看后面的工具项" }))).toBe(true);
    expect(disabled(left)).toBe(false);
    fireEvent.click(left);
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -60, behavior: "smooth" });
  });

  it("装得下时两枚箭头都不出现", async () => {
    render(<ToolbarBar content={para("要点")} expose={() => {}} />);
    const track = document.querySelector(".note-toolbar-track") as HTMLElement;
    Object.defineProperty(track, "scrollWidth", { value: 200, configurable: true });
    Object.defineProperty(track, "clientWidth", { value: 200, configurable: true });

    fireEvent.scroll(track);

    await waitFor(() => expect(track.getAttribute("data-more")).toBe("false"));
    expect(document.querySelector(".note-scroll-arrows")).toBeNull();
  });

  it("标记类命令不碰选区", async () => {
    const editor = await mountToolbar(para("要点"));
    const before = editor.state.selection.from;

    fireEvent.click(screen.getByRole("button", { name: "粗体" }));

    // 标记类命令靠「接下来输入的字」生效，选区被换掉就变了语义
    expect(editor.state.selection.from).toBe(before);
  });
});
