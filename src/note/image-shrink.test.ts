import { describe, expect, it } from "vitest";

import type { JSONContent } from "@tiptap/core";

import { shrinkOversizedImages } from "./image-shrink";

const doc = (src: string): JSONContent => ({
  type: "doc",
  content: [{ type: "image", attrs: { src } }],
});

describe("存量图像收口", () => {
  it("图都在预算内时不动文档，返回 null", async () => {
    // null 意味着「没变化」，上层因此不会多写一次盘
    const content = { p1: doc("data:image/gif;base64,R0lGODlhAQABAAAAACw=") };
    expect(await shrinkOversizedImages(content)).toBeNull();
  });

  it("没有图像的分页同样不动", async () => {
    const content: Record<string, JSONContent> = {
      p1: { type: "doc", content: [{ type: "paragraph" }] },
    };
    expect(await shrinkOversizedImages(content)).toBeNull();
  });
});
