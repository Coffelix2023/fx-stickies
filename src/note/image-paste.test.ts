import { describe, expect, it } from "vitest";

import {
  MAX_IMAGE_EDGE,
  compressImageSrc,
  fitImageSize,
  nextSmallerSize,
} from "./image-paste";

describe("剪贴板图片缩放", () => {
  it("长边超上限时等比缩小，宽的那一边和高的那一边都认", () => {
    expect(fitImageSize(3200, 1600, MAX_IMAGE_EDGE)).toEqual({
      width: 1600,
      height: 800,
    });
    expect(fitImageSize(800, 4000, MAX_IMAGE_EDGE)).toEqual({
      width: 320,
      height: 1600,
    });
  });

  it("本来就不超上限的原样返回，小图不放大", () => {
    expect(fitImageSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("零尺寸不炸", () => {
    expect(fitImageSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe("存量大图收口", () => {
  it("体积在预算内的图像原样留着，不重编码", async () => {
    // 不动它就不产生新的写入：这是「打开旧便签不该白写一遍」的保证
    expect(await compressImageSrc("data:image/png;base64,AAAA")).toBeNull();
  });

describe("预算内的缩小阶梯", () => {
  it("每轮缩到 3/4，比例不变", () => {
    expect(nextSmallerSize({ width: 1600, height: 1200 })).toEqual({
      width: 1200,
      height: 900,
    });
  });

  it("接近下限时直接落到下限，之后返回 null", () => {
    expect(nextSmallerSize({ width: 400, height: 100 })).toEqual({
      width: 300,
      height: 75,
    });
    // 300 × 0.75 = 225 会掉到下限以下，所以这一步按比例落到 240
    expect(nextSmallerSize({ width: 300, height: 75 })).toEqual({
      width: 240,
      height: 60,
    });
    expect(nextSmallerSize({ width: 240, height: 60 })).toBeNull();
  });
});
});
