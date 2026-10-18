import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { emitTo } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

import { type Note, scaleFontSize } from "./document";
import {
  NoteMenuPanel,
  type NoteMenuAction,
  type NoteMenuEvent,
} from "./NoteMenuPanel";
import { closeMenuWindow, getNote } from "./storage";

/** 卡片四周留给 CSS 阴影的透明留白，与 note-menu.css 的 `#root` padding 一致。 */
const SHADOW_PAD = 16;

/**
 * 二级菜单往右开时，卡片右边要额外让出的宽度：2px 间距 + 菜单本体 + 右侧阴影留白。
 * shortcut: 192 必须与 note-menu.css 的 .note-menu-submenu width 一致，改一处要改两处。
 */
const SUBMENU_SPAN = 2 + 192 + SHADOW_PAD;

/** 根元素上的钩子，决定二级菜单翻到左边。样式在 note-menu.css。 */
const SUBMENU_LEFT_CLASS = "submenu-left";

/**
 * 菜单窗口的内容。菜单有自己的原生窗口，所以读同一份文档拿当前纸色；
 * 用户选完把动作发回便签窗口执行 —— 最新草稿在便签窗口手里，不是这里。
 */
export function NoteMenuWindow({ id }: { id: string }) {
  const [note, setNote] = useState<Note | null>(null);
  /** 二级菜单开着没有。开着时窗口要多让一段，见下面的窗口尺寸那段。 */
  const [submenuOpen, setSubmenuOpen] = useState(false);
  /** 二级菜单往左开。卡片右边放不下 194px 时翻过去。 */
  const [submenuLeft, setSubmenuLeft] = useState(false);

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

  // 窗口尺寸：卡片按实测收窄（少留会裁掉最后一行，多留则透明区留在窗口里，
  // 那块区域照样吃掉下面的点击），二级菜单展开时额外让出一段。
  // 卡片左边缘固定在窗口左侧 SHADOW_PAD 处，所以窗口向左长时卡片在屏幕上不挪。
  useEffect(() => {
    if (!note) return;
    const handle = window.requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(".note-menu-panel");
      if (!card) return;
      const submenuRect = card
        .querySelector<HTMLElement>(".note-menu-submenu")
        ?.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const right = Math.max(cardRect.right, submenuRect?.right ?? 0);
      const win = getCurrentWindow();
      void (async () => {
        const [position, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
        // 先改尺寸再挪位置：反过来的话窗口会在按钮那一侧多出一段透明区。
        await win.setSize(new LogicalSize(right + SHADOW_PAD, cardRect.height + SHADOW_PAD * 2));
        await win.setPosition(
          new LogicalPosition(position.x / scale + SHADOW_PAD - cardRect.left, position.y / scale),
        );
      })().catch(() => {
        // 菜单正被关掉时这几个调用会失败。没有要恢复的东西，尺寸对不上顶多裁掉一点。
      });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [note, submenuOpen, submenuLeft]);

  // 翻到左边时根元素挂一个 class，CSS 据此换 padding 与二级菜单的定位方向。
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle(SUBMENU_LEFT_CLASS, submenuOpen && submenuLeft);
    return () => root.classList.remove(SUBMENU_LEFT_CLASS);
  }, [submenuOpen, submenuLeft]);

  if (!note) return null;

  /**
   * 把动作发回便签窗口执行。外观和字号这类改动留在菜单里：用户要一项项点着对比效果，
   * 收起就没法比了。对齐会挪动便签，菜单是贴着按钮的子窗口，跟着挪就废了；
   * 隐藏和删除会离开这张便签，同样必须收起。消息里带上归属，接收方会复核。
   */
  async function send(action: NoteMenuAction) {
    const message: NoteMenuEvent = { id, action };
    await emitTo(id, "note-menu-action", message);
    if (
      action.kind === "appearance" ||
      action.kind === "fontScale" ||
      action.kind === "font"
    ) {
      // 菜单自己的选中态跟着走，否则高亮停在上一项。这里乐观更新：这几项的下一状态
      // 都算得出来，重读文档要多一次 IPC 且会闪。字号用同一个 scaleFontSize 算，
      // 便签窗口那边得到的结果不会和这里不一致。
      setNote((current) => {
        if (!current) return current;
        if (action.kind === "appearance") return { ...current, ...action.patch };
        if (action.kind === "font") return { ...current, font: action.value };
        return { ...current, fontSize: scaleFontSize(current.fontSize, action.step) };
      });
      return;
    }
    await closeMenuWindow(id);
  }

  /**
   * 二级菜单往左还是往右开。卡片右边放不下就翻到左边，翻的是窗口不是卡片 ——
   * 卡片必须留在按钮旁边，隔着几十像素空白飘在一边就找不到它是从哪点开的了。
   *
   * shortcut: 翻到左边时子菜单会盖住便签的「更多操作」按钮，那一下点击收不起来，
   * 要收起就点别处或按 Escape。等窗口位置能实时跟随再修。
   */
  async function submenuGoesLeft(): Promise<boolean> {
    const card = document.querySelector<HTMLElement>(".note-menu-panel");
    try {
      const [position, monitor] = await Promise.all([
        getCurrentWindow().outerPosition(),
        currentMonitor(),
      ]);
      // 拿不到显示器就按往右开，跟菜单其余部分的方向保持一致。
      if (!card || !monitor) return false;
      const scale = monitor.scaleFactor;
      // 卡片右边缘 = 窗口左边缘 + 阴影留白 + 卡片宽，和下面量窗口尺寸用的是同一套几何。
      const cardRight = position.x / scale + SHADOW_PAD + card.getBoundingClientRect().width;
      const workRight = (monitor.workArea.position.x + monitor.workArea.size.width) / scale;
      return cardRight + SUBMENU_SPAN > workRight;
    } catch {
      // 菜单窗口正被关掉时这几个调用会失败，方向定不了就当往右开。
      return false;
    }
  }

  return (
    <NoteMenuPanel
      note={note}
      onAppearanceChange={(patch) => void send({ kind: "appearance", patch })}
      onFontScale={(step) => void send({ kind: "fontScale", step })}
      onFontChange={(value) => void send({ kind: "font", value })}
      onAlign={(placement) => void send({ kind: "align", placement })}
      onHide={() => void send({ kind: "hide" })}
      onDelete={() => void send({ kind: "delete" })}
      onSubmenuToggle={(open) => {
        // 两个 setState 在同一次 await 之后，React 合并成一次渲染：
        // 方向要先定下来，窗口尺寸那次测量才量得到翻过去的 padding。
        void submenuGoesLeft().then((left) => {
          setSubmenuLeft(open && left);
          setSubmenuOpen(open);
        });
      }}
    />
  );
}
