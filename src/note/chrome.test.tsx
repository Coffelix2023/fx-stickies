import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Note } from "./document";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

const confirmDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: (...args: unknown[]) => confirmDialog(...args),
}));

/** listen 的回调和它的 options 都存下来，测试里手动触发一次菜单回传。 */
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const listenOptions = new Map<string, unknown>();
const emitTo = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (
    event: string,
    handler: (e: { payload: unknown }) => void,
    options?: unknown,
  ) => {
    listeners.set(event, handler);
    listenOptions.set(event, options);
    return Promise.resolve(() => listeners.delete(event));
  },
  emitTo: (...args: unknown[]) => emitTo(...args),
}));

const { NoteWindow } = await import("./NoteWindow");
const { NoteMenuPanel } = await import("./NoteMenuPanel");
const { NoteMenuWindow } = await import("./NoteMenuWindow");
const { NoteMenu } = await import("./NoteMenu");

function note(): Note {
  return {
    id: "n1",
    title: "本周重点",
    tabs: ["p1"],
    activeTab: "p1",
    content: {
      p1: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "正文" }] },
        ],
      },
    },
    paper: "paleSky",
    pattern: "dots",
    pinned: false,
    translucent: false,
    collapsed: false,
    spineSize: "max",
    frame: { x: 0, y: 0, width: 300, height: 200 },
    expandedSize: null,
    zOrder: 0,
    visible: true,
  };
}

function renderWindow(loaded: Note) {
  invoke.mockImplementation((command: string, args: unknown) => {
    if (command === "get_note") return Promise.resolve(loaded);
    // 置顶由窗口层写盘并返回磁盘上的最新文档
    if (command === "set_pinned") {
      return Promise.resolve({ ...loaded, pinned: (args as { pinned: boolean }).pinned });
    }
    // 对齐由窗口层算好坐标并写盘，返回磁盘上的最新文档
    if (command === "align_note") return Promise.resolve(loaded);
    return Promise.resolve(null);
  });
  return render(<NoteWindow id={loaded.id} />);
}

/** 等到文档加载完、菜单监听已经挂上。 */
async function loaded() {
  await screen.findByRole("button", { name: "更多操作" });
}

/** 模拟菜单窗口回传一个动作。消息自带归属，默认发给 n1。 */
function sendMenuAction(action: unknown, id = "n1") {
  listeners.get("note-menu-action")?.({ payload: { id, action } });
}

const panelProps = {
  onAppearanceChange: () => {},
  onAlign: () => {},
  onHide: () => {},
  onDelete: () => {},
};

afterEach(() => {
  cleanup();
  invoke.mockReset();
  emitTo.mockReset();
  confirmDialog.mockReset();
  listeners.clear();
  listenOptions.clear();
});

describe("便签外观", () => {
  it("拖动属性只在脊条上，正文区域没有", async () => {
    const { container } = renderWindow(note());
    await waitFor(() =>
      expect(container.querySelector(".note-body")).not.toBeNull(),
    );

    const draggable = container.querySelectorAll("[data-tauri-drag-region]");
    expect(draggable).toHaveLength(1);
    expect(draggable[0].classList.contains("note-drag")).toBe(true);
    expect(container.querySelector(".note-spine")).not.toBeNull();
    expect(container.querySelector(".note-rail")).toBeNull();
    // 正文里的按下和移动不得拖动窗口
    expect(
      container.querySelector(".note-body")?.hasAttribute("data-tauri-drag-region"),
    ).toBe(false);
    expect(
      container.querySelector(".ProseMirror")?.hasAttribute("data-tauri-drag-region"),
    ).toBe(false);
  });

  it("底色和底纹来自文档", async () => {
    const { container } = renderWindow(note());
    await waitFor(() =>
      expect(container.querySelector(".note-body")).not.toBeNull(),
    );

    const shell = container.querySelector(".note");
    expect(shell?.getAttribute("data-paper")).toBe("paleSky");
    expect(shell?.getAttribute("data-pattern")).toBe("dots");
  });

  it("脊条没有标题输入和半透明开关", async () => {
    renderWindow(note());
    await loaded();

    expect(screen.queryByLabelText("便签标题")).toBeNull();
    expect(screen.queryByRole("button", { name: "半透明" })).toBeNull();
  });
});

describe("脊条", () => {
  it("左边是置顶，右边是更多操作", async () => {
    const { container } = renderWindow(note());
    await loaded();

    const buttons = container.querySelectorAll(".note-spine button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute("aria-label")).toBe("置顶");
    expect(buttons[1].getAttribute("aria-label")).toBe("更多操作");
  });

  it("置顶按钮走窗口命令，状态反映在按钮上", async () => {
    renderWindow(note());
    const pin = await screen.findByRole("button", { name: "置顶" });
    expect(pin.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(pin);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_pinned", { id: "n1", pinned: true }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "置顶" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
  });

  it("更多操作把按钮位置交给窗口层去开菜单窗口", async () => {
    renderWindow(note());
    fireEvent.click(await screen.findByRole("button", { name: "更多操作" }));

    // jsdom 不做布局，按钮矩形全是 0；这里只钉住调用形状。
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_menu_window", {
        id: "n1",
        anchor: { right: 0, bottom: 0 },
      }),
    );
  });
});

describe("菜单面板", () => {
  it("给出十枚底色、三项底纹和隐藏删除", () => {
    render(<NoteMenuPanel note={note()} {...panelProps} />);

    expect(document.querySelectorAll('[data-action^="paper-"]')).toHaveLength(10);
    expect(document.querySelectorAll('[data-action^="pattern-"]')).toHaveLength(3);
    expect(document.querySelector('[data-action="hide"]')?.textContent).toBe("隐藏");
    expect(document.querySelector('[data-action="delete"]')?.textContent).toBe("删除");
    // 九个对齐位置：四角 + 四边 + 居中。格子里只有图标，名字交给 aria-label/title。
    expect(document.querySelectorAll('[data-action^="align-"]')).toHaveLength(9);
    const topLeft = document.querySelector('[data-action="align-topLeft"]');
    expect(topLeft?.getAttribute("aria-label")).toBe("左上角");
    expect(topLeft?.textContent).toBe("");
    expect(topLeft?.querySelector("svg")).not.toBeNull();
  });

  it("勾选当前底色底纹，且没有置顶、折叠和标题栏高度", () => {
    render(<NoteMenuPanel note={note()} {...panelProps} />);

    expect(
      document.querySelector('[data-action="paper-paleSky"]')?.getAttribute("data-state"),
    ).toBe("checked");
    expect(
      document.querySelector('[data-action="pattern-dots"]')?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(document.querySelector('[data-action="pin"]')).toBeNull();
    expect(document.querySelector('[data-action="collapse"]')).toBeNull();
    expect(document.querySelector('[data-action^="spine-"]')).toBeNull();
  });

  it("色块用真实纸色变量，点它把改动交出去", () => {
    const onAppearanceChange = vi.fn();
    render(
      <NoteMenuPanel note={note()} {...panelProps} onAppearanceChange={onAppearanceChange} />,
    );

    const swatch = document.querySelector('[data-action="paper-powderBlush"]') as HTMLElement;
    expect(
      document.querySelector('[data-action="paper-alabasterGrey"]')?.getAttribute("style"),
    ).toContain("var(--paper-alabasterGrey)");

    fireEvent.click(swatch);
    fireEvent.click(document.querySelector('[data-action="pattern-grid"]') as HTMLElement);

    expect(onAppearanceChange).toHaveBeenNthCalledWith(1, { paper: "powderBlush" });
    expect(onAppearanceChange).toHaveBeenNthCalledWith(2, { pattern: "grid" });
  });

  it("点对齐位置把它交出去", () => {
    const onAlign = vi.fn();
    render(<NoteMenuPanel note={note()} {...panelProps} onAlign={onAlign} />);

    fireEvent.click(document.querySelector('[data-action="align-bottomRight"]') as HTMLElement);

    expect(onAlign).toHaveBeenCalledWith("bottomRight");
  });
});

describe("菜单回传", () => {
  it("监听时声明自己的窗口，不接全局广播", async () => {
    renderWindow(note());
    await loaded();

    // 不声明 target 就是 Any，而 Any 的监听者会收到所有 emit。
    expect(listenOptions.get("note-menu-action")).toEqual({
      target: { kind: "WebviewWindow", label: "n1" },
    });
  });

  it("发给别的便签的动作不落到这张便签上", async () => {
    const { container } = renderWindow(note());
    await loaded();

    sendMenuAction({ kind: "appearance", patch: { paper: "cottonCandy" } }, "另一张便签");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(container.querySelector(".note")?.getAttribute("data-paper")).toBe("paleSky");
  });

  it("换底色和底纹会落盘", async () => {
    renderWindow(note());
    await loaded();

    sendMenuAction({ kind: "appearance", patch: { paper: "cottonCandy" } });
    sendMenuAction({ kind: "appearance", patch: { pattern: "grid" } });

    await waitFor(() => {
      const saves = invoke.mock.calls.filter(([command]) => command === "save_note");
      const saved = saves[saves.length - 1];
      expect(saved?.[1].note.paper).toBe("cottonCandy");
      expect(saved?.[1].note.pattern).toBe("grid");
    });
  });

  it("隐藏只关窗口，不删文档", async () => {
    renderWindow(note());
    await loaded();

    sendMenuAction({ kind: "hide" });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_visible", { id: "n1", visible: false }),
    );
    expect(invoke.mock.calls.some(([command]) => command === "delete_note")).toBe(false);
  });

  it("对齐走窗口命令，屏幕坐标由窗口层算", async () => {
    renderWindow(note());
    await loaded();

    sendMenuAction({ kind: "align", placement: "bottomRight" });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("align_note", {
        id: "n1",
        placement: "bottomRight",
      }),
    );
    // 只挪位置，不碰可见性，也不重设尺寸
    expect(invoke.mock.calls.some(([command]) => command === "set_visible")).toBe(false);
    expect(invoke.mock.calls.some(([command]) => command === "delete_note")).toBe(false);
  });
  it("删除先问过用户，确认后才真删", async () => {
    confirmDialog.mockResolvedValue(false);
    renderWindow(note());
    await loaded();

    sendMenuAction({ kind: "delete" });

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    expect(invoke.mock.calls.some(([command]) => command === "delete_note")).toBe(false);

    confirmDialog.mockResolvedValue(true);
    sendMenuAction({ kind: "delete" });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("delete_note", { id: "n1" }),
    );
  });
});


describe("更多操作按钮", () => {
  const button = () => screen.getByRole("button", { name: "更多操作" });
  const calls = (command: string) =>
    invoke.mock.calls.filter(([name]) => name === command).length;

  it("菜单开着时再点是收起，不会又开一个", async () => {
    invoke.mockResolvedValue(null);
    render(<NoteMenu id="n1" />);
    await screen.findByRole("button", { name: "更多操作" });

    fireEvent.click(button());
    await waitFor(() => expect(calls("open_menu_window")).toBe(1));

    // 菜单被点外面收掉时 Rust 会通知一声，按钮据此复位
    listeners.get("note-menu-closed")?.({ payload: { id: "n1" } });

    fireEvent.click(button());
    await waitFor(() => expect(calls("close_menu_window")).toBe(1));
    expect(calls("open_menu_window")).toBe(1);
  });

  it("菜单还没关就再点，也走收起这条路", async () => {
    invoke.mockResolvedValue(null);
    render(<NoteMenu id="n1" />);
    await screen.findByRole("button", { name: "更多操作" });

    fireEvent.click(button());
    await waitFor(() => expect(calls("open_menu_window")).toBe(1));
    // 没有关闭通知就再点：macOS 上菜单此时已被失焦关掉，再关一次是空操作
    fireEvent.click(button());

    await waitFor(() => expect(calls("close_menu_window")).toBe(1));
    expect(calls("open_menu_window")).toBe(1);
  });
});
describe("菜单窗口", () => {
  /** 渲染菜单窗口并等到面板出现。 */
  async function renderMenu() {
    invoke.mockImplementation((command: string) =>
      command === "get_note" ? Promise.resolve(note()) : Promise.resolve(null),
    );
    render(<NoteMenuWindow id="n1" />);
    await screen.findByRole("menu");
  }

  const closedMenu = () => invoke.mock.calls.some(([c]) => c === "close_menu_window");

  it("改完外观菜单留着，选中高亮跟着走", async () => {
    await renderMenu();

    // 棉花糖 = cottonCandy
    fireEvent.click(screen.getByRole("button", { name: "棉花糖" }));

    // 用户要一项项点着对比效果，菜单不能自己收起
    await waitFor(() =>
      expect(
        document.querySelector('[data-action="paper-cottonCandy"]')?.getAttribute("data-state"),
      ).toBe("checked"),
    );
    expect(closedMenu()).toBe(false);
    expect(emitTo).toHaveBeenCalledWith("n1", "note-menu-action", {
      id: "n1",
      action: { kind: "appearance", patch: { paper: "cottonCandy" } },
    });
  });

  it("对齐发回便签窗口执行，并把菜单收起来", async () => {
    await renderMenu();

    fireEvent.click(document.querySelector('[data-action="align-bottomRight"]') as HTMLElement);

    await waitFor(() =>
      expect(emitTo).toHaveBeenCalledWith("n1", "note-menu-action", {
        id: "n1",
        action: { kind: "align", placement: "bottomRight" },
      }),
    );
    // 菜单是贴着按钮的子窗口，便签一挪它就跟着偏了，所以必须收起
    await waitFor(() => expect(closedMenu()).toBe(true));
  });

  it("删除仍要收起菜单，否则确认框会被浮层挡住", async () => {
    await renderMenu();

    // 隐藏和删除是 menuitem，不是 button，按 data-action 取
    fireEvent.click(document.querySelector('[data-action="delete"]') as HTMLElement);

    await waitFor(() => expect(closedMenu()).toBe(true));
  });
});
