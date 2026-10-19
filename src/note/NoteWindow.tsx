import { confirm } from "@tauri-apps/plugin-dialog";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import { NoteEditor } from "./NoteEditor";
import { PaperDrawer } from "./PaperDrawer";
import { NoteSpine, startDragOnMiddleButton } from "./NoteSpine";
import { type NoteMenuAction } from "./NoteMenu";
import {
  type Note,
  type NoteContent,
  withPageContent,
  withWindowState,
  scaleFontSize,
} from "./document";
import {
  alignNote,
  getNote,
  hideNote,
  saveNote,
  setPinned,
  deleteNote,
  toggleMaximize,
} from "./storage";

/** 编辑后延迟这么久再落盘，避免每敲一个字写一次文件。 */
export const SAVE_DELAY_MS = 400;

/**
 * 一张便签的窗口内容。文档是唯一事实来源：界面只改这份 state，
 * 改动统一延迟写回磁盘，不做第二次套壳。
 */
async function exportNote(note: any, format: "markdown" | "text" | "docx") {
  const page = note.content?.[note.activeTab];
  const ext = format === "markdown" ? "md" : format === "text" ? "txt" : "docx";
  const path = await save({ defaultPath: `note.${ext}` });
  if (!path) return;
  if (format === "text") {
    await invoke("export_write_text", { path, content: toText(page) });
  } else if (format === "markdown") {
    await invoke("export_write_text", { path, content: toMarkdown(page) });
  } else {
    const doc = new Document({ sections: [{ children: toDocxParagraphs(page) }] });
    const blob = await Packer.toBlob(doc);
    const buf = await blob.arrayBuffer();
    await invoke("export_write_bytes", { path, bytes: Array.from(new Uint8Array(buf)) });
  }
}

function nodeText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(nodeText).join("");
}

function toText(doc: any): string {
  const out: string[] = [];
  for (const n of doc?.content ?? []) {
    if (n.type === "paragraph" || n.type?.startsWith("heading")) out.push(nodeText(n));
    else if (n.type === "bulletList" || n.type === "orderedList") {
      for (const li of n.content ?? []) out.push("- " + nodeText(li));
    } else out.push(nodeText(n));
  }
  return out.join("\n");
}

function toMarkdown(doc: any): string {
  const out: string[] = [];
  for (const n of doc?.content ?? []) {
    if (n.type === "heading") {
      const lvl = n.attrs?.level ?? 1;
      out.push("#".repeat(lvl) + " " + nodeText(n));
    } else if (n.type === "paragraph") {
      out.push(nodeText(n));
    } else if (n.type === "bulletList") {
      for (const li of n.content ?? []) out.push("- " + nodeText(li));
    } else if (n.type === "orderedList") {
      (n.content ?? []).forEach((li: any, i: number) => out.push(`${i + 1}. ` + nodeText(li)));
    } else if (n.type === "codeBlock") {
      out.push("```\n" + nodeText(n) + "\n```");
    } else if (n.type === "horizontalRule") {
      out.push("---");
    } else {
      out.push(nodeText(n));
    }
  }
  return out.join("\n\n");
}

function toDocxParagraphs(doc: any): any[] {
  const paras: any[] = [];
  for (const n of doc?.content ?? []) {
    if (n.type === "heading") {
      paras.push(new Paragraph({ text: nodeText(n), heading: `Heading${n.attrs?.level ?? 1}` as any }));
    } else if (n.type === "paragraph") {
      paras.push(new Paragraph({ children: [new TextRun(nodeText(n))] }));
    } else {
      paras.push(new Paragraph({ children: [new TextRun(nodeText(n))] }));
    }
  }
  return paras;
}
export function NoteWindow({ id }: { id: string }) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 底色抽屉开没开。纯界面状态，不进文档，也不用落盘。 */
  const [paperOpen, setPaperOpen] = useState(false);
  const lastSaved = useRef<Note | null>(null);

  /** 保存请求可能重叠，用序号判断谁的返回值才算数：晚到的旧结果不推进界面状态。 */
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
   * 菜单动作。原生菜单就开在这个窗口里，点完直接调用，没有跨窗口的回传，
   * 所以最新草稿直接用 state 就行，不用绕 ref。
   */
  function runAction(action: NoteMenuAction) {
    if (action.kind === "appearance") {
      setNote((prev) => (prev ? { ...prev, ...action.patch } : prev));
    } else if (action.kind === "chromeSize") {
      // 标题栏这组控件的档位：具体像素在 chrome.css，这里只落档位。
      setNote((prev) => (prev ? { ...prev, chromeSize: action.size } : prev));
    } else if (action.kind === "statusSize") {
      // 同理：像素在 chrome.css，这里只落档位。off 只是不渲染这一行，不删字段。
      setNote((prev) => (prev ? { ...prev, statusSize: action.size } : prev));
    } else if (action.kind === "statusFaded") {
      setNote((prev) => (prev ? { ...prev, statusFaded: action.faded } : prev));
    } else if (action.kind === "frozenRows") {
      setNote((prev) => (prev ? { ...prev, frozenRows: action.rows } : prev));
    } else if (action.kind === "export") {
      void exportNote(note, action.format);
    } else if (action.kind === "fontScale") {
      setNote((prev) =>
        prev ? { ...prev, fontSize: scaleFontSize(prev.fontSize, action.step) } : prev,
      );
    } else if (action.kind === "align") {
      // 对齐同样只动窗口，文档里的位置由 Rust 侧写好。
      applyWindowChange(alignNote(id, action.placement));
    } else if (action.kind === "hide") {
      if (note) void hideWindow(note);
    } else {
      void deleteWindow();
    }
  }

  /**
   * Tab 只做缩进，不在便签的按钮之间跳。
   *
   * 焦点不在正文时（刚打开便签、或刚点过脊条上的按钮），Tab 会走浏览器默认行为：
   * 高亮一路挪到下一个按钮上，看着像 Tab 失灵。正文里的 Tab 已经是缩进，
   * 编辑器的键位自己会吃掉这个键；这里只补另一半：不在正文就把焦点带进正文，
   * 于是「第一下 Tab 进来、第二下 Tab 缩进」，和别的编辑器一致。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const body = document.querySelector<HTMLElement>(".note-body .ProseMirror");
      if (!body || body.contains(event.target as Node)) return;
      event.preventDefault();
      body.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  /**
   * ⌘ +/- 缩放这张便签的字号，⌘0 回到默认。缩放只动当前便签，
   * 和菜单里的「操作」走同一条规则，所以两处结果一致。
   */
  useEffect(() => {
    const steps: Record<string, number> = { "+": 1, "=": 1, "-": -1, "0": 0 };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey) return;
      const step = steps[event.key];
      if (step === undefined) return;
      // 不吃掉的话 webview 会连整个窗口一起缩放，脊条也跟着变粗。
      event.preventDefault();
      setNote((prev) =>
        prev ? { ...prev, fontSize: scaleFontSize(prev.fontSize, step) } : prev,
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
      // 中键按住拖整张便签。挂在根节点上，所以正文、抽屉都算拖动区；走捕获阶段，
      // 免得正文里的编辑器先把这次按下吃掉。
      onPointerDownCapture={startDragOnMiddleButton}
      className="note flex h-full min-h-0 flex-col rounded-b-[10px]"
      data-paper={note.paper}
      data-pattern={note.pattern}
      // 标题栏档位写在这里，chrome.css 据此缩放脊条、工具栏和色块行。
      data-chrome-size={note.chromeSize}
      data-frozen-rows={note.frozenRows}
      // 字号挂在根上，正文和标题一起缩放；标题栏那组控件走上面的 chromeSize。
      style={{ fontSize: `${note.fontSize}px` }}
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
          // 开关是纯界面状态，改文档就够，不需要动窗口。
          onToggleToolbar={() => {
            // 工具栏和底色抽屉抢脊条下面那一行，开一个就得收另一个。
            setPaperOpen(false);
            setNote((current) =>
              current ? { ...current, toolbar: !current.toolbar } : current,
            );
          }}
          paperOpen={paperOpen}
          onTogglePaperDrawer={() => {
            // 同上：收掉工具栏，抽屉才有那一行。
            setNote((current) =>
              current && !paperOpen ? { ...current, toolbar: false } : current,
            );
            setPaperOpen((open) => !open);
          }}
          // 放大态不渲染任何东西，所以返回值只用来报错：窗口几何由 Rust 侧写回磁盘，
          // 前端这份草稿里的旧 frame 不会被它覆盖（save_note 合并时以磁盘为准）。
          onToggleMaximize={() => {
            void toggleMaximize(id).catch((err: unknown) => setError(String(err)));
          }}
          onMenuAction={runAction}
        />
        {/* 底色抽屉贴在脊条下面，和工具栏同一个位置。 */}
        {paperOpen && (
          <PaperDrawer
            current={note.paper}
            onPick={(paper) =>
              setNote((current) => (current ? { ...current, paper } : current))
            }
          />
        )}

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
