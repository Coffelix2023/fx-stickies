import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";

import type { NoteContent } from "./document";
import { NoteImage } from "./image";
import { PlainTextPaste } from "./plain-text-paste";
const extensions = [
  StarterKit,
  TableKit,
  Markdown.configure({ markedOptions: { gfm: true } }),
  NoteImage,
  PlainTextPaste,
];

/**
 * 一个分页一份编辑器实例，换分页时按 `pageKey` 重建。
 * 正文由父级 state 提供，编辑器每次改动把 JSON 交回去。
 */
export function useNoteEditor(
  content: NoteContent,
  onChange: (content: NoteContent) => void,
  pageKey: string,
) {
  return useEditor(
    {
      extensions,
      content,
      onUpdate: ({ editor }) => onChange(editor.getJSON()),
    },
    [pageKey],
  );
}

/** 正文区域。单栏铺满剩余高度，不为工具行预留空间。 */
export function NoteBody({ editor }: { editor: Editor | null }) {
  return (
    <EditorContent
      editor={editor}
      className="note-body min-h-0 flex-1 overflow-auto rounded-b-[10px] px-3.5 pt-2.5 pb-4 outline-none"
    />
  );
}
