import { emitTo } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import { type Note } from "./document";
import {
  NoteMenuPanel,
  type NoteMenuAction,
  type NoteMenuEvent,
} from "./NoteMenuPanel";
import { closeMenuWindow, getNote } from "./storage";

/**
 * 菜单窗口的内容。菜单有自己的原生窗口，所以读同一份文档拿当前纸色；
 * 用户选完把动作发回便签窗口执行 —— 最新草稿在便签窗口手里，不是这里。
 */
export function NoteMenuWindow({ id }: { id: string }) {
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    let cancelled = false;
    getNote(id)
      .then((loaded) => {
        if (!cancelled) setNote(loaded);
      })
      // 读不到文档就没有菜单可显示，直接收起窗口。
      .catch(() => void closeMenuWindow(id));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void closeMenuWindow(id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [id]);

  if (!note) return null;

  /** 选完就收起菜单，动作交给便签窗口落地。消息里带上归属，接收方会复核。 */
  async function send(action: NoteMenuAction) {
    const message: NoteMenuEvent = { id, action };
    await emitTo(id, "note-menu-action", message);
    await closeMenuWindow(id);
  }

  return (
    <NoteMenuPanel
      note={note}
      onAppearanceChange={(patch) => void send({ kind: "appearance", patch })}
      onHide={() => void send({ kind: "hide" })}
      onDelete={() => void send({ kind: "delete" })}
    />
  );
}
