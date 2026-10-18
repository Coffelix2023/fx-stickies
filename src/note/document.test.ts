import { describe, expect, it } from "vitest";

import {
  activeContent,
  type Note,
  noteSchema,
  withPageContent,
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
    pinned: false,
    translucent: false,
    collapsed: false,
    spineSize: "max",
    frame: { x: 0, y: 0, width: 300, height: 200 },
    expandedSize: null,
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
