/**
 * 冻结正文前 N 行：算出每一行该钉在哪个高度。
 *
 * 第 k 行的 top 必须等于它前面 k-1 行的实际高度之和，而这个和 CSS 算不出来 ——
 * 行高随内容换行、字号、窗口宽度变化，一个常量近似不出真实高度：原来写死的
 * 1.5em 比真实行高小，后面的固定行就用自己的不透明底色盖掉前面行的下半部分。
 * 所以这里量一次，写成 --frozen-top-<k>，CSS 只负责读变量。
 *
 * 只写 .note-body 上的自定义属性（子元素自己继承），不动 ProseMirror 的 DOM。
 */

/** 各行相对第一行的静态偏移。第一行永远是 0，拿它当钉住位置的基准。 */
export function frozenTops(offsets: number[]): number[] {
  const base = offsets[0] ?? 0;
  return offsets.map((offset) => offset - base);
}

/** 写变量，从 --frozen-top-2 起：第一行的 top 恒为 0，不需要变量。 */
export function applyFrozenTops(target: HTMLElement, tops: number[]): void {
  tops.forEach((top, index) => {
    if (index === 0) return;
    target.style.setProperty(`--frozen-top-${index + 1}`, `${top}px`);
  });
}
