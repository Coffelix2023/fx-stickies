import type { JSONContent } from "@tiptap/core";

import { compressImageSrc } from "./image-paste";

/** 图像节点里内嵌的 data URL。别的节点返回 null。 */
function imageSrc(node: JSONContent): string | null {
  if (node.type !== "image") return null;
  const src = node.attrs?.src;
  return typeof src === "string" ? src : null;
}

/** 一棵文档里所有图像的 src，深度优先。 */
function collectImageSrcs(node: JSONContent, out: string[] = []): string[] {
  const src = imageSrc(node);
  if (src !== null) out.push(src);
  for (const child of node.content ?? []) collectImageSrcs(child, out);
  return out;
}

/** 换掉文档里所有图像的 src，其余字段原样带过。 */
function mapImages(node: JSONContent, replace: (src: string) => string): JSONContent {
  const src = imageSrc(node);
  return {
    ...node,
    attrs: src === null ? node.attrs : { ...node.attrs, src: replace(src) },
    content: node.content?.map((child) => mapImages(child, replace)),
  };
}

/**
 * 把存量文档里超预算的图像重编码一遍，返回新的 content；没有可压的返回 null。
 *
 * 便签每次落盘都要整份重写，图有多大就搬多慢。入库已经限了字节，但更早的文档里
 * 可能还嵌着几 MB 的图，打开时收口一次，之后每次保存都省下这几 MB。
 * 压缩只为省体积，任何一步失败都保持原样 —— 不能因为它挡下载入。
 */
export async function shrinkOversizedImages(
  content: Record<string, JSONContent>,
): Promise<Record<string, JSONContent> | null> {
  const shrunk = new Map<string, string>();
  try {
    for (const doc of Object.values(content)) {
      for (const src of collectImageSrcs(doc)) {
        if (shrunk.has(src)) continue;
        const next = await compressImageSrc(src);
        if (next !== null) shrunk.set(src, next);
      }
    }
  } catch {
    return null;
  }
  if (shrunk.size === 0) return null;

  const replace = (src: string) => shrunk.get(src) ?? src;
  return Object.fromEntries(
    Object.entries(content).map(([tab, doc]) => [tab, mapImages(doc, replace)]),
  );
}
