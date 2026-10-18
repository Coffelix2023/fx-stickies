import "./note-menu.css";

import {
  PAPER,
  PAPER_LABELS,
  PATTERN,
  PATTERN_LABELS,
  type Note,
} from "./document";

/** 菜单窗口回传的动作。菜单跑在另一个原生窗口里，动作由便签窗口执行。 */
export type NoteMenuAction =
  | { kind: "appearance"; patch: Partial<Pick<Note, "paper" | "pattern">> }
  | { kind: "hide" }
  | { kind: "delete" };

/**
 * 跨窗口消息：动作 + 它属于哪张便签。
 *
 * Tauri 里 target 为 `Any` 的监听者会收到**任何** emit，连 `emitTo(别的窗口)`
 * 也照收，所以每条消息都必须自带归属，接收方自己再核一遍。
 */
export type NoteMenuEvent = { id: string; action: NoteMenuAction };

type Props = {
  note: Note;
  onAppearanceChange: (patch: Partial<Pick<Note, "paper" | "pattern">>) => void;
  onHide: () => void;
  onDelete: () => void;
};

/** 菜单卡片本体。纯展示，不关心自己跑在哪个窗口里。 */
export function NoteMenuPanel({
  note,
  onAppearanceChange,
  onHide,
  onDelete,
}: Props) {
  return (
    <div className="note-menu-panel" role="menu">
      <div role="separator" />
      <p className="note-menu-label">底色</p>
      {/* 色块网格 - 选中显示白色对勾 */}
      <div className="paper-color-grid">
        {PAPER.map((paper) => (
          <button
            key={paper}
            type="button"
            data-state={note.paper === paper ? "checked" : "unchecked"}
            data-action={`paper-${paper}`}
            className="paper-color-item"
            aria-label={PAPER_LABELS[paper]}
            title={PAPER_LABELS[paper]}
            style={{ background: `var(--paper-${paper})` }}
            onClick={() => onAppearanceChange({ paper })}
          />
        ))}
      </div>
      <div role="separator" />
      <p className="note-menu-label">底纹</p>
      {PATTERN.map((pattern) => (
        <button
          key={pattern}
          type="button"
          role="menuitemradio"
          aria-checked={note.pattern === pattern}
          data-action={`pattern-${pattern}`}
          className="note-menu-row"
          onClick={() => onAppearanceChange({ pattern })}
        >
          {PATTERN_LABELS[pattern]}
        </button>
      ))}
      <div role="separator" />
      <button
        type="button"
        role="menuitem"
        data-action="hide"
        className="note-menu-row"
        onClick={onHide}
      >
        隐藏
      </button>
      <button
        type="button"
        role="menuitem"
        data-action="delete"
        className="note-menu-row"
        onClick={onDelete}
      >
        删除
      </button>
    </div>
  );
}
