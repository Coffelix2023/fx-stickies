import { getCurrentWindow } from "@tauri-apps/api/window";
import { Palette, Pin, Type } from "lucide-react";

import { type Note } from "./document";
import { NoteMenu, type NoteMenuAction } from "./NoteMenu";

type Props = {
  note: Note;
  onTogglePinned: () => void;
  onToggleToolbar: () => void;
  /** 底色抽屉开没开。只活在便签窗口里，不进文档。 */
  paperOpen: boolean;
  onTogglePaperDrawer: () => void;
  onToggleMaximize: () => void;
  /** 菜单点完报回来的动作，由便签窗口执行。 */
  onMenuAction: (action: NoteMenuAction) => void;
};
/** 光标挪过这个距离才算拖动，像素。小于它是点击，留给双击识别。 */
const DRAG_THRESHOLD_PX = 4;

/**
 * 按下先不动，拖动过阈值才交给人家的原生拖拽循环。
 *
 * 关键在这里：一旦 mousedown 就 startDragging，macOS 的原生拖拽循环会吃掉这次手势的
 * 第二次按下，dblclick 不再送达，双击只剩一次普通按下。等移动过阈值再启动拖拽，
 * 纯双击全程不进原生循环，放大就只有 onDoubleClick 一个所有者。
 */
function startDragOnMove(event: React.PointerEvent<HTMLElement>) {
  if (event.button !== 0) return;
  const { clientX: startX, clientY: startY } = event;
  const onMove = (move: PointerEvent) => {
    if (Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD_PX) {
      return;
    }
    stop();
    // 交给窗口层后光标已经归原生拖拽管，这里的后续事件不会再回来。
    void getCurrentWindow().startDragging();
  };
  const stop = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}


/**
 * 便签顶栏。窗口按钮在这一行，空白处才能拖动窗口。
 * 置顶在最左，工具栏开关和菜单在最右，贴边距离一致。
 * 标题和半透明没有入口；旧字段仍留在文档里。
 *
 * 双击这一行（除按钮外）等同于系统的标题栏双击：铺满屏幕，再双击回原尺寸。
 */
export function NoteSpine({
  note,
  onTogglePinned,
  onToggleToolbar,
  paperOpen,
  onTogglePaperDrawer,
  onToggleMaximize,
  onMenuAction,
}: Props) {
  return (
    <header
      className="note-spine flex shrink-0 items-center gap-1 px-1.5"
      onDoubleClick={(event) => {
        // 按钮自己双击是「点两下按钮」，不该顺手把窗口放大。
        if ((event.target as HTMLElement).closest("button")) return;
        onToggleMaximize();
      }}
    >
      <button
        type="button"
        aria-label="置顶"
        title={note.pinned ? "取消置顶" : "置顶"}
        aria-pressed={note.pinned}
        data-pinned={note.pinned}
        className="note-action grid size-[var(--chrome-btn)] shrink-0 place-items-center rounded"
        onClick={onTogglePinned}
      >
        {/* 未置顶是线框，置顶后图标填实：形状本身就说明开没开，不只靠底色。 */}
        <Pin className="size-[var(--chrome-icon)]" aria-hidden />
      </button>
      {/* 拖动走显式命令。挂 data-tauri-drag-region 会让 Tauri 自带脚本在 macOS 上
          用 mouseup 自己调 internal_toggle_maximize（原生 zoom），和这一行的双击抢
          同一个手势，于是放大前的 frame 记到的是放大后的矩形。这里只留一个所有者。 */}
      <div
        className="note-drag h-full min-w-6 flex-1"
        onPointerDown={startDragOnMove}
      />
      <button
        type="button"
        aria-label={note.toolbar ? "隐藏工具栏" : "显示工具栏"}
        title={note.toolbar ? "隐藏工具栏" : "显示工具栏"}
        aria-pressed={note.toolbar}
        data-on={note.toolbar}
        className="note-action grid size-[var(--chrome-btn)] shrink-0 place-items-center rounded"
        onClick={onToggleToolbar}
      >
        <Type className="size-[var(--chrome-icon)]" aria-hidden />
      </button>
      <button
        type="button"
        aria-label="底色"
        title={paperOpen ? "收起底色" : "底色"}
        aria-pressed={paperOpen}
        data-on={paperOpen}
        className="note-action grid size-[var(--chrome-btn)] shrink-0 place-items-center rounded"
        onClick={onTogglePaperDrawer}
      >
        <Palette className="size-[var(--chrome-icon)]" aria-hidden />
      </button>
      <NoteMenu
        pattern={note.pattern}
        chromeSize={note.chromeSize}
        statusSize={note.statusSize}
        statusFaded={note.statusFaded}
        onAction={onMenuAction}
      />
    </header>
  );
}
