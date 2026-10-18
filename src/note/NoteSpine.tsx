import { Pin, Type } from "lucide-react";

import { type Note } from "./document";
import { NoteMenu } from "./NoteMenu";

type Props = {
  note: Note;
  onTogglePinned: () => void;
  onToggleToolbar: () => void;
  onToggleMaximize: () => void;
};

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
  onToggleMaximize,
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
        className="note-action grid size-[18px] shrink-0 place-items-center rounded"
        onClick={onTogglePinned}
      >
        {/* 未置顶是线框，置顶后图标填实：形状本身就说明开没开，不只靠底色。 */}
        <Pin className="size-3" aria-hidden />
      </button>
      <div data-tauri-drag-region className="note-drag h-full min-w-6 flex-1" />
      <button
        type="button"
        aria-label={note.toolbar ? "隐藏工具栏" : "显示工具栏"}
        title={note.toolbar ? "隐藏工具栏" : "显示工具栏"}
        aria-pressed={note.toolbar}
        data-on={note.toolbar}
        className="note-action grid size-[18px] shrink-0 place-items-center rounded"
        onClick={onToggleToolbar}
      >
        <Type className="size-3" aria-hidden />
      </button>
      <NoteMenu id={note.id} />
    </header>
  );
}
