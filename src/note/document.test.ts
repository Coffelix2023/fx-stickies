import { describe, expect, it } from "vitest";

import {
  activeContent,
  type Note,
  noteSchema,
  withPageContent,
  scaleFontSize,
  DEFAULT_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
} from "./document";

function note(): Note {
  return {
    id: "n1",
    title: "",
    tabs: ["p1", "p2"],
    activeTab: "p1",
    content: {
      p1: { type: "doc", content: [{ type: "paragraph" }] },
      p2: { type: "doc", content: [{ type: "paragraph" }] },
    },
    paper: "alabasterGrey",
    pattern: "plain",
    fontSize: DEFAULT_FONT_SIZE,
    toolbar: false,
    frozenRows: 0,
    pinned: false,
    translucent: false,
    collapsed: false,
    spineSize: "max",
    chromeSize: "normal",
    statusSize: "small",
    statusFaded: true,
    frame: { x: 0, y: 0, width: 300, height: 200 },
    expandedSize: null,
    maximized: false,
    restoreFrame: null,
    zOrder: 0,
    visible: true,
  };
}

const text = (value: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
});

describe("标题栏高度兼容", () => {
  it("旧文档默认 min，非法值拒绝读取", () => {
    const { spineSize: _size, ...legacy } = note();
    expect(noteSchema.parse(legacy).spineSize).toBe("min");
    expect(noteSchema.safeParse({ ...legacy, spineSize: "huge" }).success).toBe(false);
    // 旧文档里的非默认档位必须还能读进来：界面虽然固定在 20px，字段仍是文档的一部分。
    expect(noteSchema.parse(note()).spineSize).toBe("max");
  });
});

describe("标题栏尺寸档位", () => {
  it("旧文档落回默认档，非法值拒绝读取", () => {
    const { chromeSize: _size, ...legacy } = note();
    expect(noteSchema.parse(legacy).chromeSize).toBe("normal");
    expect(noteSchema.safeParse({ ...legacy, chromeSize: "huge" }).success).toBe(false);
    // 非默认档位必须能原样读回来：重开便签还得是用户选的那一档。
    expect(noteSchema.parse({ ...legacy, chromeSize: "xlarge" }).chromeSize).toBe("xlarge");
  });
});

describe("字符统计档位", () => {
  it("旧文档落回默认档和勾选半透明", () => {
    const { statusSize: _size, statusFaded: _faded, ...legacy } = note();
    const parsed = noteSchema.parse(legacy);
    expect(parsed.statusSize).toBe("normal");
    expect(parsed.statusFaded).toBe(true);
    expect(noteSchema.safeParse({ ...legacy, statusSize: "huge" }).success).toBe(false);
  });

  it("用户取消勾选半透明后必须能原样读回来", () => {
    // 默认是 true，false 只能靠显式写入：读不回来等于这个开关按了没用。
    expect(noteSchema.parse({ ...note(), statusFaded: false }).statusFaded).toBe(false);
    expect(noteSchema.parse({ ...note(), statusSize: "off" }).statusSize).toBe("off");
  });
});
describe("旧文档的字体字段", () => {
  it("磁盘上带 font 的旧文档照常打开，那个键被丢掉", () => {
    // 字体功能删了，但用户的旧便签不能因此打不开：多出来的键读进来就丢掉。
    const parsed = noteSchema.parse({ ...note(), font: "songti" });
    expect(parsed).not.toHaveProperty("font");
  });
});


describe("字号与工具栏字段兼容", () => {

  it("旧文档没有这两个字段时用默认值，读得回来也写得回去", () => {
    const { fontSize: _size, toolbar: _toolbar, maximized: _max, restoreFrame: _frame, ...legacy } =
      note();
    const parsed = noteSchema.parse(legacy);
    expect(parsed.fontSize).toBe(DEFAULT_FONT_SIZE);
    expect(parsed.toolbar).toBe(false);
    expect(parsed.maximized).toBe(false);
    expect(parsed.restoreFrame).toBeNull();
    // 缩过的字号和打开的工具栏必须原样读回来
    expect(noteSchema.parse({ ...legacy, fontSize: 20, toolbar: true })).toMatchObject({
      fontSize: 20,
      toolbar: true,
    });
    // 放大态和放大前的 frame 也必须原样读回来
    const frame = { x: 10, y: 20, width: 420, height: 320 };
    expect(
      noteSchema.parse({ ...legacy, maximized: true, restoreFrame: frame }).restoreFrame,
    ).toEqual(frame);
  });
});

describe("字号缩放", () => {
  it("放大缩小各走一级，⌘0 回默认", () => {
    expect(scaleFontSize(12, 1)).toBe(13);
    expect(scaleFontSize(12, -1)).toBe(11);
    expect(scaleFontSize(20, 0)).toBe(DEFAULT_FONT_SIZE);
  });

  it("到上下限就停住，不越界", () => {
    expect(scaleFontSize(MAX_FONT_SIZE, 1)).toBe(MAX_FONT_SIZE);
    expect(scaleFontSize(MIN_FONT_SIZE, -1)).toBe(MIN_FONT_SIZE);
  });
});

describe("分页字段保留兼容", () => {
  it("只渲染 activeTab 指向的那一页", () => {
    const doc = note();
    expect(activeContent({ ...doc, activeTab: "p2" })).toEqual(doc.content.p2);
  });

  it("缺少当前页正文时给空文档，界面不白屏", () => {
    const doc = note();
    const broken = { ...doc, content: { p1: doc.content.p1 } };

    expect(activeContent({ ...broken, activeTab: "p2" })).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("写一页正文不影响另一页", () => {
    const doc = note();
    const edited = withPageContent(doc, "p1", text("第一页的内容"));

    expect(edited.content.p1).toEqual(text("第一页的内容"));
    expect(edited.content.p2).toEqual(doc.content.p2);
    expect(edited.tabs).toEqual(["p1", "p2"]);
    expect(edited.activeTab).toBe("p1");
  });
});
