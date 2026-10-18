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

  /**
   * 把动作发回便签窗口执行。外观类改动留在菜单里：用户要一项项点着对比效果，
   * 收起就没法比了。对齐会挪动便签，菜单是贴着按钮的子窗口，跟着挪就废了；
   * 隐藏和删除会离开这张便签，同样必须收起。消息里带上归属，接收方会复核。
   */
  async function send(action: NoteMenuAction) {
    const message: NoteMenuEvent = { id, action };
    await emitTo(id, "note-menu-action", message);
    if (action.kind === "appearance") {
      // 菜单自己的选中态跟着走，否则高亮停在上一项。这里乐观更新：纸色和底纹
      // 刚发给便签窗口，落盘结果不会和这里不一致；重读文档要多一次 IPC 且会闪。
      setNote((current) => (current ? { ...current, ...action.patch } : current));
      return;
    }
    await closeMenuWindow(id);
  }

  return (
    <NoteMenuPanel
      note={note}
      onAppearanceChange={(patch) => void send({ kind: "appearance", patch })}
      onAlign={(placement) => void send({ kind: "align", placement })}
      onHide={() => void send({ kind: "hide" })}
      onDelete={() => void send({ kind: "delete" })}
    />
  );
}
