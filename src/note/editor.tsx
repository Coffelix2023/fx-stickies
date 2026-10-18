import {
  Editor,
  EditorContent,
  Extension,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  IndentDecrease,
  IndentIncrease,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Undo2,
  type LucideIcon,
} from "lucide-react";

import type { NoteContent, StatusSize } from "./document";
import { NoteImage } from "./image";
import { ScrollArrows, useScrollEdges } from "./ScrollStrip";
import { PlainTextPaste } from "./plain-text-paste";
/**
 * 块级命令执行前先确保编辑器有焦点。
 *
 * 便签刚打开、正文一次都没被点过时，webview 里的编辑器是没有焦点的，
 * 块级命令会落空，用户看到的就是「点了引用没反应」。这里只补焦点，
 * 不挪光标：光标在哪儿，命令就该作用在哪儿，替他挪走等于替他改内容。
 *
 * 标记类命令（加粗、斜体）不走这里：它们靠「接下来输入的字」生效，
 * 动选区反而改掉了语义。
 */
function focusBlock(editor: Editor): void {
  if (!editor.view.hasFocus()) editor.view.focus();
}

/** 缩进一级：列表里把当前项嵌进上一项，其它地方插一个制表符。 */
function indentBlock(editor: Editor): boolean {
  // 列表里「缩进」是嵌进上一项，那才是列表该有的行为
  if (editor.isActive("listItem")) return editor.commands.sinkListItem("listItem");
  const { state, view } = editor;
  const { from, to } = state.selection;
  view.dispatch(state.tr.insertText("\t", from, to).scrollIntoView());
  return true;
}

/**
 * 缩进退一级。制表符算一格，两个空格也算一格：
 * 粘贴进来的 Markdown 缩进通常是空格，用户不该为来源不同而退不掉。
 * 没有可退的就什么都不改。
 */
function outdentBlock(editor: Editor): boolean {
  if (editor.isActive("listItem")) return editor.commands.liftListItem("listItem");
  const { state, view } = editor;
  const $from = state.selection.$from;
  const first = $from.parent.child(0);
  const text = first?.isText ? (first.text ?? "") : "";
  const width = text.startsWith("\t") ? 1 : text.startsWith("  ") ? 2 : 0;
  if (width > 0) {
    const start = $from.start();
    view.dispatch(state.tr.delete(start, start + width).scrollIntoView());
  }
  // 无论退没退都吃掉按键：便签窗口里没有别的地方可跳焦点，
  // 让 Tab 逃出去只会把光标丢到看不见的地方。
  return true;
}

/**
 * Tab 缩进、Shift+Tab 缩进回退。
 *
 * 列表里走 Tiptap 自带的 sink/lift：Tab 把当前项缩进一层，Shift+Tab 退一层，
 * 这才是列表该有的行为。普通段落没有层级可sink，就在光标处插制表符当缩进。
 */
export const TabIndent = Extension.create({
  name: "tabIndent",
  addKeyboardShortcuts() {
    return {
      Tab: () => indentBlock(this.editor),
      "Shift-Tab": () => outdentBlock(this.editor),
    };
  },
});

const extensions = [
  StarterKit,
  TableKit,
  Markdown.configure({ markedOptions: { gfm: true } }),
  NoteImage,
  PlainTextPaste,
  // 对齐落在段落和标题上：列表和引用本身有自己的排版，不给它们加对齐。
  TextAlign.configure({ types: ["paragraph", "heading"] }),
  TabIndent,
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

/** 工具栏一项。命令在 onClick 里跑，选区的存活靠 onMouseDown 不抢焦点。 */
type Item = {
  label: string;
  icon: LucideIcon;
  /** 当前选区上是否生效，用来显示选中态。 */
  active: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
  /** 这一项后面画一条分组线。分组写在这里，加一项时不可能漏。 */
  after?: true;
  /** 块级命令，执行前先把光标放进正文。见 focusBlock。 */
  block?: true;
};

const ITEMS: Item[] = [
  {
    label: "撤销",
    icon: Undo2,
    active: (editor) => editor.can().undo(),
    run: (editor) => editor.chain().focus().undo().run(),
  },
  {
    label: "重做",
    icon: Redo2,
    active: (editor) => editor.can().redo(),
    run: (editor) => editor.chain().focus().redo().run(),
    after: true,
  },
  {
    label: "一级标题",
    icon: Heading1,
    active: (editor) => editor.isActive("heading", { level: 1 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    block: true,
  },
  {
    label: "二级标题",
    icon: Heading2,
    active: (editor) => editor.isActive("heading", { level: 2 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    block: true,
  },
  {
    label: "三级标题",
    icon: Heading3,
    active: (editor) => editor.isActive("heading", { level: 3 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    block: true,
    after: true,
  },
  {
    label: "粗体",
    icon: Bold,
    active: (editor) => editor.isActive("bold"),
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    label: "斜体",
    icon: Italic,
    active: (editor) => editor.isActive("italic"),
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    label: "删除线",
    icon: Strikethrough,
    active: (editor) => editor.isActive("strike"),
    run: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    label: "行内代码",
    icon: Code,
    active: (editor) => editor.isActive("code"),
    run: (editor) => editor.chain().focus().toggleCode().run(),
    after: true,
  },
  {
    label: "无序列表",
    icon: List,
    active: (editor) => editor.isActive("bulletList"),
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
    block: true,
  },
  {
    label: "有序列表",
    icon: ListOrdered,
    active: (editor) => editor.isActive("orderedList"),
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
    block: true,
  },
  {
    label: "引用",
    icon: Quote,
    active: (editor) => editor.isActive("blockquote"),
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
    block: true,
    after: true,
  },
  {
    label: "代码块",
    icon: SquareCode,
    active: (editor) => editor.isActive("codeBlock"),
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
    block: true,
  },
  {
    label: "分割线",
    icon: Minus,
    active: () => false,
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
    after: true,
  },
  {
    label: "缩进",
    icon: IndentIncrease,
    block: true,
    active: (editor) => editor.isActive("listItem"),
    run: (editor) => indentBlock(editor),
    after: true,
  },
  {
    label: "减少缩进",
    icon: IndentDecrease,
    block: true,
    active: () => false,
    run: (editor) => outdentBlock(editor),
  },
  {
    label: "左对齐",
    icon: AlignLeft,
    active: (editor) => editor.isActive({ textAlign: "left" }),
    run: (editor) => editor.chain().focus().setTextAlign("left").run(),
  },
  {
    label: "居中对齐",
    icon: AlignCenter,
    active: (editor) => editor.isActive({ textAlign: "center" }),
    run: (editor) => editor.chain().focus().setTextAlign("center").run(),
  },
  {
    label: "右对齐",
    icon: AlignRight,
    active: (editor) => editor.isActive({ textAlign: "right" }),
    run: (editor) => editor.chain().focus().setTextAlign("right").run(),
  },
];

/** 按 `after` 标记把 ITEMS 切成组，组与组之间画一条竖线。 */
const GROUPED_ITEMS = ITEMS.reduce<{ item: Item; index: number }[][]>(
  (groups, item, index) => {
    const current = groups[groups.length - 1];
    if (!current || current[current.length - 1].item.after) groups.push([]);
    groups[groups.length - 1].push({ item, index });
    return groups;
  },
  [],
);

/**
 * Markdown 常用操作条，贴在脊条下面，高度与脊条一致。
 *
 * 按钮不抢焦点：mousedown 被吃掉，编辑器因此保住选区，点完按钮还能接着写。
 * 选中态跟着选区走，所以整体订阅一次事务，值变了才重渲染。
 */
export function NoteToolbar({ editor }: { editor: Editor | null }) {
  const activeItems = useEditorState({
    editor,
    selector: ({ editor: instance }) =>
      instance ? ITEMS.map((item) => item.active(instance)) : [],
  });

  const { track, edges, overflowing, nudge } = useScrollEdges();

  if (!editor) return null;

  return (
    <div className="note-toolbar" role="toolbar" aria-label="Markdown 操作">
      <ScrollArrows edges={edges} overflowing={overflowing} onNudge={nudge} noun="工具项" />
      <div className="note-toolbar-track" ref={track} data-more={edges.right}>
        {GROUPED_ITEMS.map((group, position) => (
          <div className="note-toolbar-group" key={position}>
            {group.map(({ item, index }) => (
              <ToolbarButton
                key={item.label}
                item={item}
                editor={editor}
                active={activeItems?.[index] ?? false}
              />
            ))}
            {position < GROUPED_ITEMS.length - 1 && (
              <span className="note-toolbar-sep" role="separator" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolbarButton({
  item,
  editor,
  active,
}: {
  item: Item;
  editor: Editor;
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      className="note-action note-toolbar-item"
      aria-label={item.label}
      title={item.label}
      aria-pressed={active}
      data-active={active}
      // 抢焦点会让编辑器丢掉选区，点一下按钮等于重置一次输入位置。
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (item.block) focusBlock(editor);
        item.run(editor);
      }}
    >
      <Icon className="size-[var(--chrome-tool-icon)]" aria-hidden />
    </button>
  );
}

/** 正文区域。单栏铺满剩余高度，不为工具行预留空间。 */
export function NoteBody({ editor }: { editor: Editor | null }) {
  return (
    <EditorContent
      editor={editor}
      // 没有底部圆角：下面还压着一行字符数，圆角交给便签根节点统一收口。
      className="note-body min-h-0 flex-1 overflow-auto px-3.5 pt-2.5 pb-4 outline-none"
    />
  );
}

/**
 * 右下角常驻的字符数。选中了文字就显示「选中 / 总数」，光标单独停着只显示总数。
 *
 * 数的是当前渲染这一页的正文，不数换行和标记：换行是排版结构，标题和列表的
 * `*`、`#` 也不是用户看见的字。
 */
export function NoteStatus({
  editor,
  size,
  faded,
}: {
  editor: Editor | null;
  size: StatusSize;
  faded: boolean;
}) {
  const counts = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (!instance) return null;
      const { doc, selection } = instance.state;
      return {
        total: doc.textContent.length,
        selected: doc.textBetween(selection.from, selection.to).length,
      };
    },
  });

  // 关掉就是整行不渲染：这一行占的高度一起还给正文。
  if (!editor || size === "off") return null;
  const total = counts?.total ?? 0;
  const selected = counts?.selected ?? 0;

  return (
    // 每次敲字都会变的数字不该被读屏念出来，所以不做 live region。
    // 字号档位和浓淡都挂在 data 属性上，像素与配色在 chrome.css。
    <div
      className="note-status"
      aria-label="字符数"
      data-status-size={size}
      data-faded={faded}
    >
      {selected > 0 ? `${selected} / ${total}` : total}
    </div>
  );
}
