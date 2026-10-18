import { Pin } from "lucide-react";

import { type Note } from "./document";
import { NoteMenu } from "./NoteMenu";

type Props = {
  note: Note;
  onTogglePinned: () => void;
};

/**
 * 便签顶栏。窗口按钮在这一行，空白处才能拖动窗口。
 * 置顶在最左、菜单在最右，两边贴边距离一致。
 * 标题和半透明没有入口；旧字段仍留在文档里。
 */
export function NoteSpine({ note, onTogglePinned }: Props) {
  return (
    <header className="note-spine flex shrink-0 items-center gap-1 px-1.5">
      <button
        type="button"
        aria-label="置顶"
        title="置顶"
        aria-pressed={note.pinned}
        data-pinned={note.pinned}
        className="note-action grid size-[18px] shrink-0 place-items-center rounded"
        onClick={onTogglePinned}
      >
        <Pin className="size-3" aria-hidden />
      </button>
      <div data-tauri-drag-region className="note-drag h-full min-w-6 flex-1" />
      <NoteMenu id={note.id} />
    </header>
  );
}
