import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { applyFrozenTops, frozenTops } from "./frozen-rows";

/** 真实便签前几块的静态偏移：标题 29px + 分隔线 + 段落，间距并不均匀。 */
const REAL_OFFSETS = [11, 48, 57, 84, 111];

describe("冻结行的钉住偏移", () => {
  it("偏移相对第一行，第一行永远是 0", () => {
    expect(frozenTops(REAL_OFFSETS)).toEqual([0, 37, 46, 73, 100]);
  });

  it("只有一个块时只有一段偏移", () => {
    expect(frozenTops([11])).toEqual([0]);
  });

  it("没有正文块时返回空数组，不炸", () => {
    expect(frozenTops([])).toEqual([]);
  });

  it("写变量时跳过第一行，从 --frozen-top-2 起", () => {
    const target = document.createElement("div");
    applyFrozenTops(
      target,
      frozenTops(REAL_OFFSETS.slice(0, 3)),
    );

    // 第一行固定 top: 0，写变量只会让它和别的行对不上。
    expect(target.style.getPropertyValue("--frozen-top-1")).toBe("");
    expect(target.style.getPropertyValue("--frozen-top-2")).toBe("37px");
    expect(target.style.getPropertyValue("--frozen-top-3")).toBe("46px");
  });

  it("CSS 读变量，并保留 1.5em 兜底值", () => {
    const css = readFileSync("src/note/chrome.css", "utf8");
    expect(css).toMatch(/var\(--frozen-top-2, calc\(1 \* 1\.5em\)\)/);
    expect(css).toMatch(/var\(--frozen-top-5, calc\(4 \* 1\.5em\)\)/);
    // 旧写法写死了每行 1.5em，真实行高不均匀时后面的行会盖住前面的行。
    expect(css).not.toMatch(/top: calc\(1 \* 1\.5em\);/);
  });
});
