import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

/**
 * 整段就是一对单行围栏：```正文 ```。
 *
 * 围栏内全部算正文，不认语言：单行这一层没有可靠的分隔符，把 ```hello``` 的
 * hello 读成语言会直接把正文吞掉。要带语言就走「``` 加回车」那条路，或写成多行。
 */
const SINGLE_LINE_FENCE = /^```([\s\S]+?)```$/;

/** 取出单行围栏里的正文；不是单行围栏（含多行、夹在文字中间）时给 null。 */
export function fenceBody(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.includes("\n")) return null;
  return SINGLE_LINE_FENCE.exec(trimmed)?.[1] ?? null;
}

/**
 * 段落变成围栏对之后换成代码块。
 *
 * 补的是「内容先写好、围栏后补上」这条路：Tiptap 自带的输入规则只在输入那一刻看
 * 光标左边的文本，围栏补在已有的字外面时它匹配不到。用 appendTransaction 而不是
 * 输入规则，因为围栏可能补在开头，也可能补在结尾，输入规则只认光标左边那一种。
 */
export const FencedParagraph = Extension.create({
  name: "fencedParagraph",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _before, after) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          // 先收集全部要换的段落，再从后往前换：前面的替换不会挪动后面的位置。
          const hits: { pos: number; body: string }[] = [];
          after.doc.descendants((node, pos) => {
            if (node.type.name !== "paragraph") return true;
            const body = fenceBody(node.textContent);
            if (body === null) return false;
            const type = after.schema.nodes.codeBlock;
            const anchor = after.doc.resolve(pos);
            // 父容器不一定收得下代码块（列表项的首个子节点必须是段落），这一段就放过。
            if (!type || !anchor.parent.canReplaceWith(anchor.index(), anchor.index() + 1, type)) {
              return false;
            }
            hits.push({ pos, body });
            return false;
          });

          const type = after.schema.nodes.codeBlock;
          if (!type || hits.length === 0) return null;

          let tr = after.tr;
          for (let i = hits.length - 1; i >= 0; i--) {
            const hit = hits[i];
            if (!hit) continue;
            const node = tr.doc.nodeAt(hit.pos);
            if (!node) continue;
            tr = tr.replaceWith(
              hit.pos,
              hit.pos + node.nodeSize,
              type.create(null, after.schema.text(hit.body)),
            );
          }
          return tr;
        },
      }),
    ];
  },
});
