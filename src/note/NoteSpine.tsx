import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
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

/** 脊条空白处的左键：按住拖过阈值才拖窗口，阈值逻辑在下面的 trackDrag。 */
function startDragOnMove(event: React.PointerEvent<HTMLElement>) {
  if (event.button !== 0) return;
  trackDrag(event);
}

/**
 * 中键按住拖整张便签：入口挂在窗口根节点上，正文里也能拖。
 *
 * 不走 startDragging：它落到 NSWindow.performWindowDragWithEvent，而 AppKit 只认左键的
 * mouseDown，中键传进去没有反应 —— 窗口层报成功，窗口却不动。这里自己算位移设窗口位置，
 * 位置照旧由 Rust 侧的 Moved 事件写回文档。
 */
export function startDragOnMiddleButton(event: React.PointerEvent<HTMLElement>) {
  if (event.button !== 1) return;
  // WebKit 拿中键的 mousedown 启动自动滚动，掐掉它就不会跟拖窗口抢这次手势。
  event.preventDefault();

  const target = getCurrentWindow();
  const { screenX: startX, screenY: startY } = event;

  // 起点位置是异步读的。读到之前先不动：位移不会丢，第一次移动带的是总位移。
  let origin: { x: number; y: number } | null = null;
  let monitorOrigin: { x: number; y: number } | null = null;
  let monitorSize: { width: number; height: number } | null = null;
  let windowSize: { width: number; height: number } | null = null;
  // 松键可能早于起点读回来，这个标记用来挡住迟到的起点复活一次已经结束的拖动。
  let done = false;

  // 一次拖动里 pointermove 比屏幕刷新还密，按帧合并，别让窗口层被 IPC 淹掉。
  let pending: { x: number; y: number } | null = null;
  let frame = 0;
  const flush = () => {
    frame = 0;
    const at = pending;
    pending = null;
        if (at) {
      let x = at.x;
      let y = at.y;
      const threshold = 20;
      if (monitorOrigin && monitorSize && windowSize) {
        if (Math.abs(x - monitorOrigin.x) < threshold) x = monitorOrigin.x;
        else if (Math.abs(monitorOrigin.x + monitorSize.width - (x + windowSize.width)) < threshold) x = monitorOrigin.x + monitorSize.width - windowSize.width;
        if (Math.abs(y - monitorOrigin.y) < threshold) y = monitorOrigin.y;
        else if (Math.abs(monitorOrigin.y + monitorSize.height - (y + windowSize.height)) < threshold) y = monitorOrigin.y + monitorSize.height - windowSize.height;
      }
      void target.setPosition(new LogicalPosition(x, y));
    }
  };

  const onMove = (move: PointerEvent) => {
    if (move.buttons === 0) return stop();
    const from = origin;
    if (!from) return;
    pending = {
      x: from.x + move.screenX - startX,
      y: from.y + move.screenY - startY,
    };
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const stop = () => {
    done = true;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    window.removeEventListener("blur", stop);
    if (frame) cancelAnimationFrame(frame);
    // 最后一段位移还没落帧就松了手，这里直接补上，否则窗口停在半路。
    flush();
  };
  // 先挂监听再读起点：异步那一步回来之前松键、失焦都能收得住。
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  window.addEventListener("blur", stop);

  void Promise.all([target.outerPosition(), target.scaleFactor(), target.outerSize(), currentMonitor()])
    .then(([position, scale, size, mon]) => {
      if (done) return;
      origin = position.toLogical(scale);
    if (mon) {
      monitorOrigin = mon.position.toLogical(mon.scaleFactor);
      monitorSize = mon.size.toLogical(mon.scaleFactor);
    } else {
      monitorOrigin = { x: 0, y: 0 };
      monitorSize = { width: window.screen.availWidth, height: window.screen.availHeight };
    }
    windowSize = size.toLogical(scale);
    })
    .catch(() => stop());
}

/**
 * 按下先不动，拖动过阈值才交给人家的原生拖拽循环。
 *
 * 关键在这里：一旦 mousedown 就 startDragging，macOS 的原生拖拽循环会吃掉这次手势的
 * 第二次按下，dblclick 不再送达，双击只剩一次普通按下。等移动过阈值再启动拖拽，
 * 纯双击全程不进原生循环，放大就只有 onDoubleClick 一个所有者。
 */
function trackDrag(event: React.PointerEvent<HTMLElement>) {
  const { clientX: startX, clientY: startY } = event;
  const onMove = (move: PointerEvent) => {
    // 松键可能发生在窗口外，pointerup 收不到；下一次移动时按钮位就是空的，就地收尾。
    if (move.buttons === 0) {
      stop();
      return;
    }
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
    // 窗口失焦后原生指针事件不会再回来，就地收尾，免得监听残留到下一次手势。
    window.removeEventListener("blur", stop);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  window.addEventListener("blur", stop);
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
        frozenRows={note.frozenRows}
        onAction={onMenuAction}
      />
    </header>
  );
}
