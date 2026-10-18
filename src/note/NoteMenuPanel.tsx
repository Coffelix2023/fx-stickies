import "./note-menu.css";
import { useState } from "react";
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
  Check,
  ChevronRight,
  Minus,
  Plus,
  RotateCcw,
  Circle,
} from "lucide-react";

import {
  FONTS,
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
  center: Circle,
  middleRight: ArrowRight,
  bottomLeft: ArrowDownLeft,
  bottomCenter: ArrowDown,
  bottomRight: ArrowDownRight,
};

/** 菜单窗口回传的动作。菜单跑在另一个原生窗口里，动作由便签窗口执行。 */
export type NoteMenuAction =
  | { kind: "appearance"; patch: Partial<Pick<Note, "paper" | "pattern">> }
  | { kind: "fontScale"; step: number }
  | { kind: "font"; value: string }
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
  onFontScale: (step: number) => void;
  onFontChange: (value: string) => void;
  onHide: () => void;
  onDelete: () => void;
  /** 二级菜单开合。窗口层靠它决定要不要把窗口变宽，缺省就当不需要。 */
  onSubmenuToggle?: (open: boolean) => void;
};

/** 菜单卡片本体。纯展示，不关心自己跑在哪个窗口里。 */
export function NoteMenuPanel({
  note,
  onAppearanceChange,
  onAlign,
  onFontScale,
  onFontChange,
  onHide,
  onDelete,
  onSubmenuToggle,
}: Props) {
  /** 二级菜单展开着哪一层。只活在菜单窗口里，不进文档。 */
  const [fontMenuOpen, setFontMenuOpen] = useState(false);

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
              <Icon aria-hidden className="size-[15px]" strokeWidth={2.25} />
            </button>
          );
        })}
      </div>

      <div role="separator" />
      {/* 字体是二级菜单：五款横排挤在一行里看不全，改成一行一款。
          展开状态只活在菜单窗口里，不进文档，所以留在本组件内。 */}
      <button
        type="button"
        role="menuitem"
        data-action="menu-font"
        className="note-menu-row"
        aria-haspopup="true"
        aria-expanded={fontMenuOpen}
        onClick={() => {
          // 二级菜单现在是浮层，展开会撑宽窗口，窗口层得跟着变。
          const open = !fontMenuOpen;
          setFontMenuOpen(open);
          onSubmenuToggle?.(open);
        }}
      >
        <span className="flex-1">字体</span>
        <span className="note-menu-value">{fontLabel(note.font)}</span>
        <ChevronRight aria-hidden className="size-[13px]" />
      </button>
      {fontMenuOpen && (
        <div className="note-menu-submenu" role="group" aria-label="字体">
          {FONTS.map((font) => (
            <button
              key={font.id}
              type="button"
              role="menuitemradio"
              aria-checked={note.font === font.id}
              data-action={`pick-font-${font.id}`}
              className="note-menu-row"
              // 每一行用自己那份字体渲染样例，选哪款一眼就认得出
              style={{ fontFamily: font.stack }}
              onClick={() => {
                onFontChange(font.id);
                setFontMenuOpen(false);
                onSubmenuToggle?.(false);
              }}
            >
              <span className="flex-1">{font.label}</span>
              <span className="note-menu-font-sample">便签 Aa</span>
              {note.font === font.id && <Check aria-hidden className="size-[13px]" />}
            </button>
          ))}
        </div>
      )}
      <div role="separator" />
      <p className="note-menu-label">界面缩放</p>
      {/* 字号只占一行：缩小、当前值、放大、复位。文字全去掉，图标加 title 说人话；
          菜单和 ⌘ +/- 走同一个 step，所以两条路的结果一致。 */}
      <div className="note-menu-font">
        <FontStep
          label="缩小字号"
          hint="⌘ −"
          icon={Minus}
          action="font-down"
          onClick={() => onFontScale(-1)}
        />
        <span className="note-menu-value" data-action="font-value">
          {note.fontSize}
        </span>
        <FontStep
          label="放大字号"
          hint="⌘ +"
          icon={Plus}
          action="font-up"
          onClick={() => onFontScale(1)}
        />
        <FontStep
          label="恢复默认字号"
          hint="⌘0"
          icon={RotateCcw}
          action="font-reset"
          onClick={() => onFontScale(0)}
        />
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

/** 字号行里的一个图标按钮。图标说话，完整说法留给 title 和读屏。 */
function FontStep({
  label,
  hint,
  icon: Icon,
  action,
  onClick,
}: {
  label: string;
  hint: string;
  icon: LucideIcon;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-action={action}
      className="note-menu-font-item"
      aria-label={label}
      title={`${label} ${hint}`}
      onClick={onClick}
    >
      <Icon aria-hidden className="size-[13px]" strokeWidth={2.25} />
    </button>
  );
}

/** 当前字体的名字。认不出的字体名（更新版本写的）照原样显示，不至于空着一格。 */
function fontLabel(id: string): string {
  return FONTS.find((font) => font.id === id)?.label ?? id;
}
