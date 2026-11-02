/**
 * 剪贴板图像的落档编码。
 *
 * 便签文档是 base64 内嵌（图跟文档一起走，不依赖外部文件），所以插进去之前必须
 * 先缩到能接受的体积。缩放和重编码都交给 webview 自带的画布，不引图像库。
 */

/** 内嵌图片的长边上限。再大只是把文档和每次保存一起拖慢，便签窗口里也看不全。 */
export const MAX_IMAGE_EDGE = 1600;

/** 缩到底的短边下限。再小就看不清内容了，宁可让这一张超预算。 */
const MIN_IMAGE_EDGE = 240;

/** 每轮缩到原来的 3/4。 */
const SHRINK_STEP = 0.75;

/**
 * 单张内嵌图片 base64 串的长度上限（约 500 KB 二进制）。
 *
 * 文档是整份读写的：打字后 400ms 落盘一次，拖动/缩放窗口时 500ms 一次
 * （Rust 侧 `save_frame`），每次都把整份文档重读、重新序列化、fsync 写回。
 * 图有多大，这些重复搬运就有多慢 —— 1600px 的 PNG 截图能到 5 MB，
 * 所以光限像素不够，字节也得限。
 */
export const MAX_IMAGE_DATA_URL = 700_000;
/** Rust 侧 `read_clipboard` 的图片分支。位图那一路的 mime 固定是 `image/rgba`。 */
export type ClipboardImage = {
  data: string;
  mime: string;
  width: number | null;
  height: number | null;
};

/** 等比缩到长边不超过 `maxEdge`。本身就不超的原样返回：小图不放大，放大只会糊。 */
export function fitImageSize(
  width: number,
  height: number,
  maxEdge: number = MAX_IMAGE_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= 0 || longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function bytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** 解码成画布能画的东西。位图那一路没有文件头，宽高只能由 Rust 侧一起带过来。 */
async function decode(image: ClipboardImage): Promise<ImageBitmap> {
  if (image.mime !== "image/rgba") {
    return createImageBitmap(new Blob([bytes(image.data)], { type: image.mime }));
  }
  if (image.width == null || image.height == null) {
    throw new Error("位图缺宽高");
  }
  const pixels = new Uint8ClampedArray(bytes(image.data));
  return createImageBitmap(new ImageData(pixels, image.width, image.height));
}

/**
 * 把剪贴板里的图像重编码成可内嵌的 data URL。
 *
 * PNG/GIF 保留透明；其余（JPEG、HEIC 转出的 JPEG、位图）走 JPEG，体积小一个量级。
 */
/** 画布编码一档。`alpha` 为真走 PNG（保透明），否则走白底 JPEG。 */
function encodeAt(
  bitmap: ImageBitmap,
  size: { width: number; height: number },
  alpha: boolean,
): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  if (!alpha) {
    // JPEG 没有透明通道，不铺底的话透明区域会变成黑块。
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size.width, size.height);
  }
  context.drawImage(bitmap, 0, 0, size.width, size.height);

  return alpha
    ? canvas.toDataURL("image/png")
    : canvas.toDataURL("image/jpeg", 0.85);
}

/**
 * 编码阶梯的下一档尺寸：每轮缩 `SHRINK_STEP`，到下限返回 null。
 *
 * 抽成纯函数是为了能单独测：画布那两步在 jsdom 里跑不了。
 */
export function nextSmallerSize(
  size: { width: number; height: number },
  minEdge: number = MIN_IMAGE_EDGE,
): { width: number; height: number } | null {
  const longest = Math.max(size.width, size.height);
  if (longest <= minEdge) return null;
  // 最后一轮直接落到下限，不在下限边上再来一次。
  const scale = Math.max(SHRINK_STEP, minEdge / longest);
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/**
 * 在字节预算内编码。
 *
 * 保透明的 PNG 先在长边上限试一次，够小就原样保留透明；否则换白底 JPEG，
 * 从长边上限起一轮缩 3/4，缩到下限还超就取最后一档 —— 宁可超预算，也不能没有图。
 */
function encodeWithinBudget(
  bitmap: ImageBitmap,
  keepsAlpha: boolean,
  budget: number,
): string | null {
  const full = fitImageSize(bitmap.width, bitmap.height);

  // 保透明只值一次尝试：靠缩到看不清来省字节，不如换成满尺寸的白底 JPEG 留住内容。
  if (keepsAlpha) {
    const png = encodeAt(bitmap, full, true);
    if (png !== null && png.length <= budget) return png;
  }

  let last: string | null = null;
  let size = full;
  for (;;) {
    const url = encodeAt(bitmap, size, false);
    if (url === null) return last;
    last = url;
    if (url.length <= budget) return url;

    const smaller = nextSmallerSize(size);
    if (smaller === null) return last;
    size = smaller;
  }
}

/**
 * 把剪贴板里的图像重编码成可内嵌的 data URL。
 *
 * PNG/GIF 在预算内保留透明；其余（JPEG、HEIC 转出的 JPEG、位图）走 JPEG，
 * 体积小一个量级。超预算的 PNG 也归到后一类。
 */
export async function encodeClipboardImage(
  image: ClipboardImage,
): Promise<string | null> {
  const bitmap = await decode(image);
  const keepsAlpha = image.mime === "image/png" || image.mime === "image/gif";
  const url = encodeWithinBudget(bitmap, keepsAlpha, MAX_IMAGE_DATA_URL);
  bitmap.close();
  return url;
}

/**
 * 缩略扫一遍 alpha，判断这张图是不是真的靠透明出效果。
 *
 * 只看缩略图上有没有半透明像素，不追求逐像素精确：目的是「别把有意义的透明
 * 压成白底」，不是做严格的通道分析。
 */
function hasTransparency(bitmap: ImageBitmap): boolean {
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= 0) return false;
  const scale = Math.min(1, 256 / longest);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;

  context.drawImage(bitmap, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 255) < 250) return true;
  }
  return false;
}

/**
 * 把已经内嵌的图压到预算内。本来就够小、或没有画布通路的，返回 null 表示不动它。
 *
 * 存量文档里的大图靠它收口：便签打开时跑一遍，之后每次落盘就直接少几 MB。
 */
export async function compressImageSrc(
  src: string,
  budget: number = MAX_IMAGE_DATA_URL,
): Promise<string | null> {
  if (src.length <= budget) return null;
  if (typeof createImageBitmap !== "function") return null;

  const response = await fetch(src);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const keepsAlpha = blob.type === "image/png" || blob.type === "image/gif";
  // 真靠透明出效果的图不动：重编码只能白底糊掉透明，那是有损且不可逆的内容改变。
  if (keepsAlpha && hasTransparency(bitmap)) {
    bitmap.close();
    return null;
  }
  const url = encodeWithinBudget(bitmap, keepsAlpha, budget);
  bitmap.close();

  // 压不小就留着原图：换上一份更大的没有意义。
  if (url === null || url.length >= src.length) return null;
  return url;
}
