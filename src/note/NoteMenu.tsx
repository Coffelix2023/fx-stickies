import { LogicalPosition } from "@tauri-apps/api/dpi";
import {
  CheckMenuItem,
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";
import { Ellipsis } from "lucide-react";

import {
  PATTERN,
  PATTERN_LABELS,
  CHROME_SIZES,
  CHROME_SIZE_LABELS,
  STATUS_SIZES,
  STATUS_SIZE_LABELS,
  PLACEMENTS,
  PLACEMENT_LABELS,
  type Pattern,
  type Placement,
  type ChromeSize,
  type StatusSize,
} from "./document";

/** 菜单点完要做什么。原生菜单只管把动作报回来，动手的是便签窗口。 */
export type NoteMenuAction =
  | { kind: "appearance"; patch: { pattern: Pattern } }
  | { kind: "chromeSize"; size: ChromeSize }
  | { kind: "statusSize"; size: StatusSize }
  | { kind: "statusFaded"; faded: boolean }
  | { kind: "fontScale"; step: number }
  | { kind: "align"; placement: Placement }
  | { kind: "hide" }
  | { kind: "delete" };

type Props = {
  /** 当前底纹，菜单打勾的位置从这里来。 */
  pattern: Pattern;
  /** 当前标题栏档位，菜单打勾的位置从这里来。 */
  chromeSize: ChromeSize;
  /** 当前字符统计档位，菜单打勾的位置从这里来。 */
  statusSize: StatusSize;
  /** 当前是否用更淡的一档颜色，勾选状态从这里来。 */
  statusFaded: boolean;
  onAction: (action: NoteMenuAction) => void;
};

/**
 * 脊条上的「更多操作」。菜单是 macOS 原生的 NSMenu：点开即出，
 * 没有第二个窗口要建、要量位置，所以不会像自绘菜单那样有可感知的延迟。
 *
 * 原生菜单只能放文字，所以底纹、对齐和外观各自收进子菜单，选中态用对勾表示。
 */
export function NoteMenu({ pattern, chromeSize, statusSize, statusFaded, onAction }: Props) {
  async function popup(at: LogicalPosition) {
    const menu = await Menu.new({
      items: [
        await Submenu.new({
          text: "底纹",
          items: await Promise.all(
            PATTERN.map((value) =>
              CheckMenuItem.new({
                text: PATTERN_LABELS[value],
                checked: value === pattern,
                action: () => onAction({ kind: "appearance", patch: { pattern: value } }),
              }),
            ),
          ),
        }),
        await Submenu.new({
          text: "对齐到屏幕",
          items: await Promise.all(
            PLACEMENTS.map((placement) =>
              MenuItem.new({
                text: PLACEMENT_LABELS[placement],
                action: () => onAction({ kind: "align", placement }),
              }),
            ),
          ),
        }),
        await Submenu.new({
          text: "外观",
          items: [
            // 原生菜单没有分组标题这种东西，用一条禁用项当标签：和选项同级，也点不动。
            await MenuItem.new({ text: "标题栏", enabled: false }),
            ...(await Promise.all(
              CHROME_SIZES.map((size) =>
                CheckMenuItem.new({
                  text: CHROME_SIZE_LABELS[size],
                  checked: size === chromeSize,
                  action: () => onAction({ kind: "chromeSize", size }),
                }),
              ),
            )),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await MenuItem.new({ text: "界面", enabled: false }),
            await MenuItem.new({
              text: "放大",
              // 没有 "Plus" 这个键：muda 只认 Equal/Digit/NumpadAdd，解析失败会被
              // tauri 静默丢成 None —— 菜单照开，就是没有快捷键注释。
              accelerator: "CmdOrCtrl+Shift+=",
              action: () => onAction({ kind: "fontScale", step: 1 }),
            }),
            await MenuItem.new({
              text: "缩小",
              accelerator: "CmdOrCtrl+-",
              action: () => onAction({ kind: "fontScale", step: -1 }),
            }),
            await MenuItem.new({
              text: "重置",
              accelerator: "CmdOrCtrl+0",
              action: () => onAction({ kind: "fontScale", step: 0 }),
            }),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await MenuItem.new({ text: "信息", enabled: false }),
            ...(await Promise.all(
              STATUS_SIZES.map((size) =>
                CheckMenuItem.new({
                  text: STATUS_SIZE_LABELS[size],
                  checked: size === statusSize,
                  action: () => onAction({ kind: "statusSize", size }),
                }),
              ),
            )),
            await CheckMenuItem.new({
              text: "半透明",
              checked: statusFaded,
              action: () => onAction({ kind: "statusFaded", faded: !statusFaded }),
            }),
          ],
        }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await MenuItem.new({
          text: "隐藏便签",
          action: () => onAction({ kind: "hide" }),
        }),
        await MenuItem.new({
          text: "删除便签…",
          action: () => onAction({ kind: "delete" }),
        }),
      ],
    });
    // 菜单句柄在 Rust 侧，点完就随局部变量一起没了，所以每次点都重新建一个。
    // 贴边翻转交给系统：原生菜单自己会避开屏幕边缘。
    await menu.popup(at);
  }

  return (
    <button
      type="button"
      aria-label="更多操作"
      title="更多操作"
      className="note-action grid size-[var(--chrome-btn)] shrink-0 place-items-center rounded"
      onClick={(event) => {
        // popup 的坐标是相对窗口左上角的，按钮自己的视口坐标正好能用。
        const rect = event.currentTarget.getBoundingClientRect();
        void popup(new LogicalPosition(rect.right, rect.bottom)).catch(() => {});
      }}
    >
      <Ellipsis className="size-[var(--chrome-icon)]" aria-hidden />
    </button>
  );
}
