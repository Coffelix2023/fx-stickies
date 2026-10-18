import type { JSONContent } from "@tiptap/core";
import { z } from "zod";

/** 底色，取值与 Rust 端 `note::Paper` 一致，色值见 App.css 的 --paper-*。 */
export const PAPER = [
  "alabasterGrey",
  "dustGrey",
  "blush",
  "apricot",
  "pearlBeige",
  "frozenWater",
  "paleSky",
  "thistle",
  "pastelPetal",
  "cottonRose",
] as const;
export type Paper = (typeof PAPER)[number];

export const PAPER_LABELS: Record<Paper, string> = {
  alabasterGrey: "雪花灰",
  dustGrey: "尘灰",
  blush: "藕粉",
  apricot: "杏橘",
  pearlBeige: "珍珠米",
  frozenWater: "霜蓝",
  paleSky: "天蓝",
  thistle: "蓟紫",
  pastelPetal: "樱粉",
  cottonRose: "玫瑰",
};
/** 底纹，取值与 Rust 端 `note::Pattern` 一致。 */
export const PATTERN = ["plain", "dots", "grid"] as const;
export type Pattern = (typeof PATTERN)[number];

export const PATTERN_LABELS: Record<Pattern, string> = {
  plain: "无",
  dots: "点阵",
  grid: "方格",
};
/** 标题栏高度档位。界面已经固定成 20px，这里只为旧文档保留字段。 */
const SPINE_SIZES = ["min", "normal", "max"] as const;

const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const sizeSchema = z.object({ width: z.number(), height: z.number() });

/** 一个 Tiptap 文档。内部结构由编辑器决定，这里只钉住最外层类型。 */
export const contentSchema = z.object({ type: z.literal("doc") }).loose();

/** 正文的类型来自 Tiptap 自己，避免再造一套递归文档结构。 */
export type NoteContent = JSONContent;

/**
 * 一份便签文档。字段与 `src-tauri/src/note.rs` 的 `Note` 逐项对应，
 * 读取时用它校验，结构不对就不渲染。
 */
export const noteSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** 分页顺序，元素是分页 id。 */
  tabs: z.array(z.string()),
  activeTab: z.string(),
  /** 分页 id -> 该分页的 Tiptap JSON。 */
  content: z.record(z.string(), contentSchema),
  paper: z.enum(PAPER),
  pattern: z.enum(PATTERN),
  pinned: z.boolean(),
  translucent: z.boolean(),
  collapsed: z.boolean(),
  spineSize: z.enum(SPINE_SIZES).default("min"),
  frame: rectSchema,
  expandedSize: sizeSchema.nullable(),
  zOrder: z.number(),
  visible: z.boolean(),
});

type ParsedNote = z.infer<typeof noteSchema>;

/** 解析后的文档。正文按 Tiptap 的类型使用，Zod 只校验到最外层形状。 */
export type Note = Omit<ParsedNote, "content"> & {
  content: Record<string, NoteContent>;
};

/** 解析出口的唯一一次断言：内层正文的形状由 Tiptap 负责。 */
export function asNote(parsed: ParsedNote): Note {
  return parsed as Note;
}

/** 空分页的正文。与 Rust 端 `note::empty_doc` 是同一个形状。 */
export function emptyContent(): NoteContent {
  return { type: "doc", content: [{ type: "paragraph" }] };
}



/**
 * 当前分页的正文。文档里缺这一页时给一个空文档，界面不因此白屏。
 * Zod 只校验到最外层类型，内层形状由 Tiptap 负责，所以这里收口一次断言。
 */
export function activeContent(note: Note): NoteContent {
  // Rust 侧保证 activeTab 一定有正文，这里的兜底只防脏数据。
  return note.content[note.activeTab] ?? emptyContent();
}


/** 写入某一页的正文，其他页不动。 */
export function withPageContent(
  note: Note,
  tab: string,
  content: NoteContent,
): Note {
  return { ...note, content: { ...note.content, [tab]: content } };
}

/**
 * 窗口层带来的字段：只有置顶。外部更新只覆盖它，
 * 正文和分页以本地为准，避免磁盘上的旧文档盖掉正在编辑的草稿。
 */
export function withWindowState(note: Note, updated: Note): Note {
  return { ...note, pinned: updated.pinned };
}


