import { listen } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";

import { NoteEditor } from "./NoteEditor";
import { NoteSpine } from "./NoteSpine";
import { type NoteMenuEvent } from "./NoteMenuPanel";
import {
  type Note,
  type NoteContent,
  withPageContent,
  withWindowState,
} from "./document";
import {
  alignNote,
getNote,
  hideNote,
  saveNote,
  setPinned,
  deleteNote,
} from "./storage";

/** 编辑后延迟这么久再落盘，避免每敲一个字写一次文件。 */
export const SAVE_DELAY_MS = 400;

/**
 * 一张便签的窗口内容。文档是唯一事实来源：界面只改这份 state，
 * 改动统一延迟写回磁盘，不做第二次套壳。
 */
export function NoteWindow({ id }: { id: string }) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastSaved = useRef<Note | null>(null);

  /** 同时只有一次保存在途，用序号判断谁的返回值才算数。 */
  const saveSeq = useRef(0);

  /** 菜单跑在另一个窗口里，它回传的动作要落到最新这份草稿上，所以走 ref。 */
  const noteRef = useRef<Note | null>(null);

  useEffect(() => {
    let cancelled = false;
    getNote(id)
      .then((loaded) => {
        if (cancelled) return;
        lastSaved.current = loaded;
        setNote(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);


  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  /**
   * 菜单窗口的动作回传。菜单自己不改文档：最新草稿在便签窗口手里，
   * 由它统一落盘，避免两个窗口互相覆盖。
   */
  useEffect(() => {
    const pending = listen<NoteMenuEvent>(
      "note-menu-action",
      (event) => {
        // 兜底：Tauri 里 target 为 Any 的监听者会收到全部 emit，
        // 只声明具体 target 还不够保险，这里再核一次归属。
        if (event.payload.id !== id) return;
        const current = noteRef.current;
        if (!current) return;
        const action = event.payload.action;
        if (action.kind === "appearance") {
          setNote((prev) => (prev ? { ...prev, ...action.patch } : prev));
        } else if (action.kind === "align") {
          // 对齐同样只动窗口，文档里的位置由 Rust 侧写好。
          applyWindowChange(alignNote(id, action.placement));
        } else if (action.kind === "hide") {
          void hideWindow(current);
        } else {
          void deleteWindow();
        }
      },
      // 不声明 target 就是 Any，会把别的便签的菜单动作也收进来。
      { target: { kind: "WebviewWindow", label: id } },
    );
    return () => {
      void pending.then((unlisten) => unlisten());
    };
    // hideWindow / deleteWindow 只依赖 props 和 ref，不必随渲染重订阅。
  }, [id]);

  useEffect(() => {
    if (!note || note === lastSaved.current) return;
    const handle = window.setTimeout(() => void saveNow(note), SAVE_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [note]);

  /** 落盘一份文档。成功才推进 lastSaved：失败时草稿留在界面里等重试。 */
  async function saveNow(target: Note): Promise<boolean> {
    const seq = ++saveSeq.current;
    try {
      await saveNote(target);
      // 已经有更新的保存在途，磁盘状态由它推进，这里不抢。
      if (seq !== saveSeq.current) return false;
      lastSaved.current = target;
      setError(null);
      return true;
    } catch (err: unknown) {
      if (seq === saveSeq.current) setError(`保存失败：${String(err)}`);
      return false;
    }
  }

  /**
   * 置顶要动窗口，交给 Rust 侧命令；它写回文档并返回磁盘上的最新版本，
   * 返回值里的正文可能比草稿旧，所以只取窗口字段。
   */
  function applyWindowChange(command: Promise<Note>) {
    command
      .then((updated) => {
        lastSaved.current = updated;
        setNote((current) => current && withWindowState(current, updated));
      })
      .catch((err: unknown) => setError(String(err)));
  }


  /**
   * 隐藏：先把这一份落盘再关窗。窗口销毁后没有第二次机会，
   * 存不进去就不关，提示条里已经是重试入口。
   */
  async function hideWindow(target: Note) {
    if (await saveNow(target)) await hideNote(id);
  }

  /**
   * 删除：不可恢复，所以先让用户确认。确认框用 Tauri 的原生对话框，
   * webview 的 window.confirm 在 macOS 上根本不会弹出来。
   */
  async function deleteWindow() {
    const confirmed = await confirm("删除后无法恢复。", {
      title: "删除这张便签？",
      kind: "warning",
      okLabel: "删除",
      cancelLabel: "取消",
    });
    if (!confirmed) return;
    try {
      await deleteNote(id);
    } catch (err: unknown) {
      setError(String(err));
    }
  }

  // 没有文档可渲染时，错误才是整页的：正文还没拿到，界面没有东西可保。
  if (!note) {
    return error ? (
      <p className="note-body px-3 py-2 text-xs text-red-800">
        便签无法使用：{error}
      </p>
    ) : null;
  }

  return (
    <div
      className="note flex h-full min-h-0 flex-col rounded-b-[10px]"
      data-paper={note.paper}
      data-pattern={note.pattern}
    >
      {/* 草稿还在，保存失败只提示不替换界面。 */}
      {error && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-b border-[var(--note-line)] bg-[var(--note-spine)] px-2.5 py-1 text-[11px] text-[var(--note-ink)]"
        >
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button
            type="button"
            className="note-action rounded px-1.5"
            onClick={() => void saveNow(note)}
          >
            重试
          </button>
        </div>
      )}

        <NoteSpine
          note={note}
          onTogglePinned={() =>
            applyWindowChange(setPinned(id, !note.pinned))
          }
        />

        <NoteEditor
          note={note}
          onContentChange={(tab, content: NoteContent) =>
            setNote(
              (current) =>
                current && withPageContent(current, tab, content),
            )
          }
        />
    </div>
  );
}
