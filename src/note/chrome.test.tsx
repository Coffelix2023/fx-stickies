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
  emitTo: vi.fn(),
}));

const { NoteWindow } = await import("./NoteWindow");
const { NoteMenuPanel } = await import("./NoteMenuPanel");

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
    paper: "frozenWater",
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
  onHide: () => {},
  onDelete: () => {},
};

afterEach(() => {
  cleanup();
  invoke.mockReset();
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
    expect(shell?.getAttribute("data-paper")).toBe("frozenWater");
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
  });

  it("勾选当前底色底纹，且没有置顶、折叠和标题栏高度", () => {
    render(<NoteMenuPanel note={note()} {...panelProps} />);

    expect(
      document.querySelector('[data-action="paper-frozenWater"]')?.getAttribute("data-state"),
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

    const swatch = document.querySelector('[data-action="paper-blush"]') as HTMLElement;
    expect(
      document.querySelector('[data-action="paper-alabasterGrey"]')?.getAttribute("style"),
    ).toContain("var(--paper-alabasterGrey)");

    fireEvent.click(swatch);
    fireEvent.click(document.querySelector('[data-action="pattern-grid"]') as HTMLElement);

    expect(onAppearanceChange).toHaveBeenNthCalledWith(1, { paper: "blush" });
    expect(onAppearanceChange).toHaveBeenNthCalledWith(2, { pattern: "grid" });
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

    sendMenuAction({ kind: "appearance", patch: { paper: "cottonRose" } }, "另一张便签");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(container.querySelector(".note")?.getAttribute("data-paper")).toBe("frozenWater");
  });

  it("换底色和底纹会落盘", async () => {
    renderWindow(note());
    await loaded();

    sendMenuAction({ kind: "appearance", patch: { paper: "cottonRose" } });
    sendMenuAction({ kind: "appearance", patch: { pattern: "grid" } });

    await waitFor(() => {
      const saves = invoke.mock.calls.filter(([command]) => command === "save_note");
      const saved = saves[saves.length - 1];
      expect(saved?.[1].note.paper).toBe("cottonRose");
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
