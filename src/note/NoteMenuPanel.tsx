import "./note-menu.css";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  type LucideIcon,
  Square,
} from "lucide-react";

import {
  PAPER,
  PAPER_LABELS,
  PATTERN,
  PATTERN_LABELS,
  PLACEMENTS,
  PLACEMENT_LABELS,
  type Note,
  type Placement,
} from "./document";

/** 每个对齐位置的图标：四角和四边是罗盘箭头，居中是不动的方块。 */
const PLACEMENT_ICONS: Record<Placement, LucideIcon> = {
  topLeft: ArrowUpLeft,
  topCenter: ArrowUp,
  topRight: ArrowUpRight,
  middleLeft: ArrowLeft,
  center: Square,
  middleRight: ArrowRight,
  bottomLeft: ArrowDownLeft,
  bottomCenter: ArrowDown,
  bottomRight: ArrowDownRight,
};

/** 菜单窗口回传的动作。菜单跑在另一个原生窗口里，动作由便签窗口执行。 */
export type NoteMenuAction =
  | { kind: "appearance"; patch: Partial<Pick<Note, "paper" | "pattern">> }
  | { kind: "align"; placement: Placement }
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
  onAlign: (placement: Placement) => void;
  onHide: () => void;
  onDelete: () => void;
};

/** 菜单卡片本体。纯展示，不关心自己跑在哪个窗口里。 */
export function NoteMenuPanel({
  note,
  onAppearanceChange,
  onAlign,
  onHide,
  onDelete,
}: Props) {
  return (
    <div className="note-menu-panel" role="menu">
      <p className="note-menu-label">底色</p>
      {/* 色块网格 - 选中用高亮边框表示 */}
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
      {/* 底纹 - 三个横排单选按钮，圆点图标自身表示选中态 */}
      <div className="pattern-grid" role="group" aria-label="底纹">
        {PATTERN.map((pattern) => (
          <button
            key={pattern}
            type="button"
            role="menuitemradio"
            aria-checked={note.pattern === pattern}
            data-action={`pattern-${pattern}`}
            className="pattern-item"
            onClick={() => onAppearanceChange({ pattern })}
          >
            {PATTERN_LABELS[pattern]}
          </button>
        ))}
      </div>
      <div role="separator" />
      <p className="note-menu-label">对齐到屏幕</p>
      {/* 罗盘九宫格 - 顺序就是 PLACEMENTS 的行序，箭头指哪边就贴哪边 */}
      <div className="align-grid" role="group" aria-label="对齐到屏幕">
        {PLACEMENTS.map((placement) => {
          const Icon = PLACEMENT_ICONS[placement];
          return (
            <button
              key={placement}
              type="button"
              role="menuitem"
              data-action={`align-${placement}`}
              className="align-item"
              aria-label={PLACEMENT_LABELS[placement]}
              title={PLACEMENT_LABELS[placement]}
              onClick={() => onAlign(placement)}
            >
              <Icon aria-hidden className="size-[18px]" strokeWidth={2.25} />
            </button>
          );
        })}
      </div>

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
