import { invoke } from "@tauri-apps/api/core";

import { asNote, type Note, type Placement, noteSchema } from "./document";

/** 读取并校验一份文档。校验失败时抛出，界面因此不渲染内容。 */
export async function getNote(id: string): Promise<Note> {
  return asNote(noteSchema.parse(await invoke("get_note", { id })));
}

/** 保存整份文档。Rust 侧会再校验一次并做原子写入。 */
export async function saveNote(note: Note): Promise<void> {
  await invoke("save_note", { note });
}

/** 开关置顶。窗口层级只有窗口层能改，所以走命令而不是本地改字段。 */
export async function setPinned(id: string, pinned: boolean): Promise<Note> {
  return asNote(noteSchema.parse(await invoke("set_pinned", { id, pinned })));
}

/** 把便签贴到屏幕的某个位置。屏幕坐标只有窗口层知道，所以走命令，它顺带写回文档。 */
export async function alignNote(id: string, placement: Placement): Promise<Note> {
  return asNote(noteSchema.parse(await invoke("align_note", { id, placement })));
}

/** 双击脊条在铺满屏幕和原尺寸之间切换。屏幕坐标只有窗口层知道，所以走命令。 */
export async function toggleMaximize(id: string): Promise<Note> {
  return asNote(noteSchema.parse(await invoke("toggle_maximize", { id })));
}
/**
 * 关闭一张便签的窗口。Rust 侧先把窗口位置写回文档再关窗，并刷新托盘列表。
 * 窗口随之销毁，invoke 的返回值到不了前端，所以这里不解析。
 */
export function hideNote(id: string): Promise<void> {
  return invoke("set_visible", { id, visible: false });
}


/**
 * 删除一张便签：Rust 侧移除文档、关掉窗口并刷新托盘列表。不可恢复，
 * 调用方必须先向用户确认。
 */
export function deleteNote(id: string): Promise<void> {
  return invoke("delete_note", { id });
}

/** 从窗口事件里取一份文档，同样过一遍校验。 */
export function noteFromEvent(payload: unknown): Note {
  return asNote(noteSchema.parse(payload));
}
