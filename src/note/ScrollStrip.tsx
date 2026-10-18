import { ChevronLeft, ChevronRight } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";

/** 箭头一次拨多少像素：太窄看不出在滚，太宽会滚过头。 */
const SCROLL_STEP = 60;

/** 两端还有没有内容可看。 */
export type ScrollEdges = { left: boolean; right: boolean };

/**
 * 一条横向滚动区（色块行、工具栏）共用的两端状态。
 *
 * 滚动条在便签里是藏起来的，中键滚动又指望不上，所以溢出时两端要架箭头。
 * 两枚成对出现：滚到头的那一枚置灰，而不是收掉——收掉会让这一行随着滚动
 * 忽长忽短，看着像界面在跳。
 */
export function useScrollEdges(): {
  track: RefObject<HTMLDivElement | null>;
  edges: ScrollEdges;
  /** 内容装不下时为真。两枚箭头成对出现的开关就是它。 */
  overflowing: boolean;
  nudge: (direction: 1 | -1) => void;
} {
  const track = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ edges: ScrollEdges; overflowing: boolean }>({
    edges: { left: false, right: false },
    overflowing: false,
  });

  // 便签宽度会拖，箭头得跟着变；量的是滚动区，不是外面那层。
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => {
      const hidden = el.scrollWidth - el.clientWidth;
      setState({
        overflowing: hidden > 1,
        edges: { left: el.scrollLeft > 0, right: el.scrollLeft < hidden - 1 },
      });
    };
    measure();
    el.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  return {
    track,
    edges: state.edges,
    overflowing: state.overflowing,
    nudge: (direction) =>
      track.current?.scrollBy({ left: direction * SCROLL_STEP, behavior: "smooth" }),
  };
}

type Props = {
  edges: ScrollEdges;
  /** 内容装不下时为真。假的时候两枚箭头都不渲染。 */
  overflowing: boolean;
  onNudge: (direction: 1 | -1) => void;
  /** 读屏念出来的东西：「色块」还是「工具项」。 */
  noun: string;
};

/**
 * 横向滚动两端的箭头。两枚成对出现，滚到哪头就把那枚置灰：
 * 收掉会让这一行忽长忽短，滚动时看着像界面在跳。
 */
export function ScrollArrows({ edges, overflowing, onNudge, noun }: Props) {
  if (!overflowing) return null;
  return (
    <div className="note-scroll-arrows">
      <button
        type="button"
        className="note-scroll-arrow"
        disabled={!edges.left}
        aria-label={`向左看前面的${noun}`}
        onClick={() => onNudge(-1)}
      >
        <ChevronLeft className="size-[var(--chrome-arrow)]" aria-hidden />
      </button>
      <button
        type="button"
        className="note-scroll-arrow"
        disabled={!edges.right}
        aria-label={`向右看后面的${noun}`}
        onClick={() => onNudge(1)}
      >
        <ChevronRight className="size-[var(--chrome-arrow)]" aria-hidden />
      </button>
    </div>
  );
}
