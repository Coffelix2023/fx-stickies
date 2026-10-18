import type { JSONContent } from "@tiptap/core";
import { z } from "zod";

/** 底色，取值与 Rust 端 `note::Paper` 一致，色值见 App.css 的 --paper-*。 */
export const PAPER = [
  "cottonCandy",
  "powderBlush",
  "peachFuzz",
  "lightApricot",
  "frostedMint",
  "pearlAqua",
  "paleSky",
  "periwinkle",
  "porcelain",
  "alabasterGrey",
  // 第二组：Enchanted Forest Hues（= stickies-color.md 的 style-3），排在旧组右侧。
  "charcoalBlue",
  "pineBlue",
  "verdigris",
  "mutedOlive",
  "drySage",
  "tuscanSun",
  "sunlitClay",
  "sandyBrown",
  "coralGlow",
  "burntPeach",
] as const;
export type Paper = (typeof PAPER)[number];

export const PAPER_LABELS: Record<Paper, string> = {
  cottonCandy: "棉花糖",
  powderBlush: "粉雾",
  peachFuzz: "蜜桃",
  lightApricot: "浅杏",
  frostedMint: "薄荷",
  pearlAqua: "珍珠青",
  paleSky: "天蓝",
  periwinkle: "长春",
  porcelain: "瓷白",
  alabasterGrey: "雪花灰",
  charcoalBlue: "炭蓝",
  pineBlue: "松蓝",
  verdigris: "铜绿",
  mutedOlive: "灰橄榄",
  drySage: "沙绿",
  tuscanSun: "暖阳",
  sunlitClay: "晒陶",
  sandyBrown: "沙棕",
  coralGlow: "珊瑚",
  burntPeach: "焦桃",
};
/** 底纹，取值与 Rust 端 `note::Pattern` 一致。 */
export const PATTERN = ["plain", "dots", "grid"] as const;
export type Pattern = (typeof PATTERN)[number];

export const PATTERN_LABELS: Record<Pattern, string> = {
  plain: "无",
  dots: "点阵",
  grid: "方格",
};

/** 屏幕对齐位置，取值与 Rust 端 `frame::Placement` 一致；顺序就是九宫格的行序。 */
export const PLACEMENTS = [
  "topLeft",
  "topCenter",
  "topRight",
  "middleLeft",
  "center",
  "middleRight",
  "bottomLeft",
  "bottomCenter",
  "bottomRight",
] as const;
export type Placement = (typeof PLACEMENTS)[number];

export const PLACEMENT_LABELS: Record<Placement, string> = {
  topLeft: "左上角",
  topCenter: "靠顶边",
  topRight: "右上角",
  middleLeft: "靠左边",
  center: "居中",
  middleRight: "靠右边",
  bottomLeft: "左下角",
  bottomCenter: "靠底边",
  bottomRight: "右下角",
};

/** 正文字号的默认值与缩放上下限，与 Rust 端 `note::DEFAULT_FONT_SIZE` 等常量一致。 */
export const DEFAULT_FONT_SIZE = 14;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 100;

/**
 * 缩放后的字号。`step` 为 0 时回默认字号，正负各是缩放一级。
 *
 * 菜单和 ⌘ +/- 走同一条规则，所以两边的结果永远一致；菜单窗口里的乐观更新
 * 也用它算，不用重读文档。
 */
export function scaleFontSize(size: number, step: number): number {
  if (step === 0) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size + step));
}

/** 标题栏高度档位。界面已经固定成 20px，这里只为旧文档保留字段。 */
const SPINE_SIZES = ["min", "normal", "max"] as const;

/**
 * 脊条、工具栏、色块行这一组控件的尺寸档位。比例写在 chrome.css，
 * 这里只管档位本身：具体像素是样式的活，文档只记用户选了哪一档。
 */
export const CHROME_SIZES = ["small", "normal", "large", "xlarge"] as const;
export type ChromeSize = (typeof CHROME_SIZES)[number];

export const CHROME_SIZE_LABELS: Record<ChromeSize, string> = {
  small: "小",
  normal: "默认",
  large: "大",
  xlarge: "超大",
};

/**
 * 右下角字符统计的字号档位。`off` 直接把整行拿掉，正文因此多出这一行的高度。
 * 具体像素在 chrome.css，这里同样只存用户选了哪一档。
 */
export const STATUS_SIZES = ["off", "small", "normal", "large"] as const;
export type StatusSize = (typeof STATUS_SIZES)[number];

export const STATUS_SIZE_LABELS: Record<StatusSize, string> = {
  off: "off",
  small: "小",
  normal: "默认",
  large: "大",
};

/** 默认档是 12px；更早的便签没有这个字段，读进来也落到这一档。 */
export const DEFAULT_STATUS_SIZE: StatusSize = "normal";

/**
 * 字符统计是否用更淡的一档颜色。默认勾选：它是常驻的辅助信息，
 * 不该和正文抢注意力。关掉就用正文同浓度的 --note-muted。
 */
export const DEFAULT_STATUS_FADED = true;
export const DEFAULT_CHROME_SIZE: ChromeSize = "normal";

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
  /** 正文字号，单位 px。旧文档没有这个字段，落回默认字号。 */
  fontSize: z.number().default(DEFAULT_FONT_SIZE),
  /** 是否显示 Markdown 工具栏。旧文档没有这个字段，按不显示处理。 */
  toolbar: z.boolean().default(false),
  pinned: z.boolean(),
  translucent: z.boolean(),
  collapsed: z.boolean(),
  spineSize: z.enum(SPINE_SIZES).default("min"),
  /** 标题栏一组控件的尺寸档位。旧文档没有这个字段，落回默认档。 */
  chromeSize: z.enum(CHROME_SIZES).default(DEFAULT_CHROME_SIZE),
  /** 右下角字符统计的字号档位。旧文档没有这个字段，落回默认档。 */
  statusSize: z.enum(STATUS_SIZES).default(DEFAULT_STATUS_SIZE),
  /** 字符统计是否用更淡的一档颜色。旧文档没有这个字段，按勾选处理。 */
  statusFaded: z.boolean().default(DEFAULT_STATUS_FADED),
  frame: rectSchema,
  expandedSize: sizeSchema.nullable(),
  /** 是否处于放大态。窗口层负责改，前端只渲染状态不渲染它。 */
  maximized: z.boolean().default(false),
  /** 放大之前的 frame，窗口层用它恢复。 */
  restoreFrame: rectSchema.nullable().default(null),
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


