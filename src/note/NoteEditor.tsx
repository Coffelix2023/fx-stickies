import { NoteBody, useNoteEditor } from "./editor";
import { type Note, type NoteContent, activeContent } from "./document";

type Props = {
  note: Note;
  onContentChange: (tab: string, content: NoteContent) => void;
};

/**
 * 当前分页的编辑器。分页已经没有界面入口，只渲染文档里 `activeTab` 指向的那一页，
 * 其他页的正文仍留在文档里；改动写回同一个分页 id。
 * 编辑器按分页 id 重建，所以换页时不会把上一页的编辑状态带过来。
 */
export function NoteEditor({ note, onContentChange }: Props) {
  const active = note.activeTab;
  const editor = useNoteEditor(
    activeContent(note),
    (next) => onContentChange(active, next),
    active,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <NoteBody editor={editor} />
    </div>
  );
}
