import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FONT, type Note } from "./document";

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

/**
 * 菜单窗口的假身：记下尺寸和位置，测试好断言窗口有没有变宽、有没有挪。
 * origin 是屏幕上的物理像素原点，scale 是缩放倍数。
 */
const fakeWindow = {
  size: null as { width: number; height: number } | null,
  position: null as { x: number; y: number } | null,
  origin: { x: 200, y: 200 },
  scale: 2,
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setSize: (size: { width: number; height: number }) => {
      fakeWindow.size = size;
      return Promise.resolve();
    },
    setPosition: (position: { x: number; y: number }) => {
      fakeWindow.position = position;
      return Promise.resolve();
    },
    outerPosition: () => Promise.resolve(fakeWindow.origin),
    scaleFactor: () => Promise.resolve(fakeWindow.scale),
  }),
  // 工作区右边在 1500 逻辑像素处（物理 3000），够宽时二级菜单往右开。
  currentMonitor: () =>
    Promise.resolve({
      scaleFactor: 2,
      workArea: { position: { x: 0, y: 0 }, size: { width: 3000, height: 2000 } },
    }),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
  LogicalPosition: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
}));

/**
 * jsdom 里 getBoundingClientRect 全返回 0，而窗口尺寸那段全靠矩形算数。
 * 按 note-menu.css 的实际布局给真数：卡片在窗口内缩 16px，二级菜单贴着它向右 2px。
 * 翻了方向时按 CSS 的 padding 摆到左边。
 */
function stubMenuRects() {
  return vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const flipped = document.documentElement.classList.contains("submenu-left");
      const box = (left: number, width: number, height: number) =>
        ({
          left,
          top: 0,
          right: left + width,
          bottom: height,
          width,
          height,
          x: left,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
      if (this.classList.contains("note-menu-submenu")) {
        return box(flipped ? 2 : 226, 192, 120);
      }
      return box(flipped ? 196 : 16, 208, 400);
    });
}

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
    fontSize: 14,
    toolbar: false,
    font: DEFAULT_FONT,
    pinned: false,
    translucent: false,
    collapsed: false,
    spineSize: "max",
    frame: { x: 0, y: 0, width: 300, height: 200 },
    expandedSize: null,
    maximized: false,
    restoreFrame: null,
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
    // 双击放大同理，窗口层改几何并写回文档
    if (command === "toggle_maximize") {
      return Promise.resolve({ ...loaded, maximized: !loaded.maximized });
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
  onFontScale: () => {},
  onFontChange: () => {},
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
  it("左边是置顶，右边依次是工具栏开关和更多操作", async () => {
    const { container } = renderWindow(note());
    await loaded();

    const buttons = container.querySelectorAll(".note-spine button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].getAttribute("aria-label")).toBe("置顶");
    expect(buttons[1].getAttribute("aria-label")).toBe("显示工具栏");
    expect(buttons[2].getAttribute("aria-label")).toBe("更多操作");
  });

  it("双击脊条空白处放大/恢复，点按钮不算", async () => {
    const { container } = renderWindow(note());
    await loaded();

    fireEvent.doubleClick(container.querySelector(".note-drag") as HTMLElement);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("toggle_maximize", { id: "n1" }),
    );

    // 双击按钮是「点两下按钮」，不该顺手放大窗口
    const before = invoke.mock.calls.filter(([name]) => name === "toggle_maximize").length;
    fireEvent.doubleClick(screen.getByRole("button", { name: "置顶" }));
    fireEvent.doubleClick(screen.getByRole("button", { name: "更多操作" }));
    expect(invoke.mock.calls.filter(([name]) => name === "toggle_maximize").length).toBe(
      before,
    );
  });

  it("置顶的图标形状随状态变，线框和填实分得清", () => {
    const css = readFileSync("src/note/chrome.css", "utf8");
    // 只换底色在浅色纸上几乎看不出来，所以图标还要从线框变实心
    expect(css).toMatch(/\.note-action\[data-pinned="true"\] svg[^{]*\{[^}]*fill: currentColor/);
  });

  it("Tab 不在按钮之间跳，焦点不在正文就带进正文", async () => {
    renderWindow(note());
    await loaded();
    // 焦点停在脊条上的按钮上：这是最容易触发「Tab 乱跳」的状态
    const pin = screen.getByRole("button", { name: "置顶" });
    pin.focus();
    const body = document.querySelector(".note-body .ProseMirror") as HTMLElement;
    // 换成空实现：真的去聚焦 contenteditable 会走进 ProseMirror 的
    // 选区同步，jsdom 上没有 getClientRects 会炸。这里只验「有没有被叫到」。
    const focus = vi.fn();
    body.focus = focus;

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    // 真实按键落在当前焦点上，再冒泡到 window；这里照着这个路径发
    (document.activeElement ?? document.body).dispatchEvent(event);

    // 默认行为被吃掉，高亮才不会挪到下一个按钮上
    expect(event.defaultPrevented).toBe(true);
    // 焦点被带进正文之后，下一下 Tab 就是缩进
    expect(focus).toHaveBeenCalled();
  });

  it("焦点在正文里时，Tab 就是缩进，焦点不离开正文", async () => {
    const { container } = renderWindow(note());
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull());
    const body = container.querySelector(".ProseMirror") as HTMLElement;

    fireEvent.keyDown(body, { key: "Tab" });

    // 编辑器吃掉了这个键（事件被 preventDefault），正文多了缩进
    await waitFor(() =>
      expect(container.querySelector(".ProseMirror")?.textContent).toBe("\t正文"),
    );
  });

  it("工具栏开关按住不放，名字跟着状态换", async () => {
    const { container } = renderWindow({ ...note(), toolbar: true });
    await loaded();

    const toggle = screen.getByRole("button", { name: "隐藏工具栏" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(
        container.querySelectorAll(".note-spine button")[1].getAttribute("aria-label"),
      ).toBe("显示工具栏"),
    );
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

  it("字体是一级菜单，行上写当前字体名", () => {
    render(<NoteMenuPanel note={{ ...note(), font: "songti" }} {...panelProps} />);

    const entry = document.querySelector('[data-action="menu-font"]') as HTMLElement;
    expect(entry.getAttribute("aria-expanded")).toBe("false");
    expect(entry.textContent).toContain("字体");
    expect(entry.textContent).toContain("宋体");
    // 没展开就只有一级菜单那一行
    expect(document.querySelectorAll('[data-action^="pick-font-"]')).toHaveLength(0);
  });

  it("展开字体是二级菜单，一款一行", () => {
    render(<NoteMenuPanel note={{ ...note(), font: "songti" }} {...panelProps} />);
    fireEvent.click(document.querySelector('[data-action="menu-font"]') as HTMLElement);

    const rows = document.querySelectorAll('[data-action^="pick-font-"]');
    expect(rows).toHaveLength(5);
    // 五款覆盖无衬线、衬线、圆体、等宽；等宽那款写的是 Maple Mono CN
    expect([...rows].map((node) => node.getAttribute("data-action"))).toEqual([
      "pick-font-system",
      "pick-font-geist",
      "pick-font-songti",
      "pick-font-yuanti",
      "pick-font-maple",
    ]);
    // 一款一行，名字不再被挤掉
    expect(document.querySelector('[data-action="pick-font-maple"]')?.textContent).toContain(
      "Maple",
    );
    expect(
      document.querySelector('[data-action="pick-font-songti"]')?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      document.querySelector('[data-action="pick-font-maple"]')?.getAttribute("style"),
    ).toContain("Maple Mono NF CN");
  });

  it("点二级菜单里的字体交出去，收起二级但菜单留着", () => {
    const onFontChange = vi.fn();
    render(<NoteMenuPanel note={note()} {...panelProps} onFontChange={onFontChange} />);
    fireEvent.click(document.querySelector('[data-action="menu-font"]') as HTMLElement);
    fireEvent.click(document.querySelector('[data-action="pick-font-maple"]') as HTMLElement);

    expect(onFontChange).toHaveBeenCalledWith("maple");
    // 收起二级，方便继续调；菜单本身不关，用户还要一项项点着比
    expect(document.querySelector('[data-action="menu-font"]')?.getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("字号那节叫界面缩放，不再叫操作", () => {
    render(<NoteMenuPanel note={note()} {...panelProps} />);

    const labels = [...document.querySelectorAll(".note-menu-label")].map(
      (node) => node.textContent,
    );
    expect(labels).toContain("界面缩放");
    expect(labels).not.toContain("操作");
  });

  it("九宫格居中是圆点，箭头和圆点都是深灰", () => {
    render(<NoteMenuPanel note={note()} {...panelProps} />);
    // 居中格仍是一个图标，靠 CSS 填实成圆点
    expect(
      document.querySelector('[data-action="align-center"]')?.querySelector("svg"),
    ).not.toBeNull();

    const css = readFileSync("src/note/note-menu.css", "utf8");
    // 纯黑的九宫格在白底菜单上像一块污渍，改成深灰
    expect(css).toMatch(/\.align-item\s*\{[^}]*color: rgba\(0, 0, 0, 0\.42\)/);
    expect(css).toMatch(/\[data-action="align-center"\] svg\s*\{[^}]*fill: currentColor/);
  });

  it("字号只占一行，三个图标加当前值", () => {
    render(<NoteMenuPanel note={{ ...note(), fontSize: 15 }} {...panelProps} />);

    expect(document.querySelectorAll(".note-menu-font-item")).toHaveLength(3);
    expect(document.querySelector('[data-action="font-value"]')?.textContent).toBe("15");
    // 行内没有文字标签，图标的名字交给 aria-label 和 title
    expect(document.querySelector('[data-action="font-up"]')?.getAttribute("aria-label")).toBe(
      "放大字号",
    );
    const title = (action: string) =>
      (document.querySelector(`[data-action="${action}"]`) as HTMLElement).title;
    expect(title("font-down")).toBe("缩小字号 ⌘ −");
    expect(title("font-reset")).toBe("恢复默认字号 ⌘0");
    // 工具栏开关搬到了脊条上的图标，菜单里不再有这一项
    expect(document.querySelector('[data-action="toolbar"]')).toBeNull();
  });

  it("点字号把下一步交给便签窗口", () => {
    const onFontScale = vi.fn();
    render(<NoteMenuPanel note={note()} {...panelProps} onFontScale={onFontScale} />);

    fireEvent.click(document.querySelector('[data-action="font-up"]') as HTMLElement);
    fireEvent.click(document.querySelector('[data-action="font-down"]') as HTMLElement);
    fireEvent.click(document.querySelector('[data-action="font-reset"]') as HTMLElement);

    expect(onFontScale.mock.calls).toEqual([[1], [-1], [0]]);
  });

  it("字体子菜单的行不会溢出容器", () => {
    render(<NoteMenuPanel note={note()} {...panelProps} />);
    fireEvent.click(document.querySelector('[data-action="menu-font"]') as HTMLElement);

    expect(document.querySelectorAll('[data-action^="pick-font-"]')).toHaveLength(5);
    const css = readFileSync("src/note/note-menu.css", "utf8");
    expect(css).toMatch(/\.note-menu-row\s*\{[^}]*box-sizing: border-box/);
    expect(css).toMatch(/\.note-menu-submenu\s*\{[^}]*box-sizing: border-box/);
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

  it("字号和工具栏都落盘，工具栏随之出现", async () => {
    const { container } = renderWindow(note());
    await loaded();

    sendMenuAction({ kind: "fontScale", step: 1 });
    fireEvent.click(await screen.findByRole("button", { name: "显示工具栏" }));

    await waitFor(() => expect(container.querySelector(".note-toolbar")).not.toBeNull());
    await waitFor(() => {
      const saves = invoke.mock.calls.filter(([command]) => command === "save_note");
      const saved = saves[saves.length - 1];
      expect(saved?.[1].note.fontSize).toBe(15);
      expect(saved?.[1].note.toolbar).toBe(true);
    });
    // 开关是脊条上的按钮，不走菜单窗口
    expect(emitTo).not.toHaveBeenCalled();
  });

  it("字体改动落盘，根节点带上字体", async () => {
    const { container } = renderWindow(note());
    await loaded();

    sendMenuAction({ kind: "font", value: "songti" });

    await waitFor(() =>
      expect(container.querySelector(".note")?.getAttribute("data-font")).toBe("songti"),
    );
    await waitFor(() => {
      const saves = invoke.mock.calls.filter(([command]) => command === "save_note");
      expect(saves[saves.length - 1]?.[1].note.font).toBe("songti");
    });
  });

  it("⌘ +/- 缩放这张便签的字号，⌘0 回到默认", async () => {
    const { container } = renderWindow(note());
    await loaded();

    const shell = () => container.querySelector(".note") as HTMLElement;
    const press = (key: string) => fireEvent.keyDown(window, { key, metaKey: true });

    press("+");
    await waitFor(() => expect(shell().style.fontSize).toBe("15px"));
    press("-");
    press("-");
    await waitFor(() => expect(shell().style.fontSize).toBe("13px"));
    press("0");
    await waitFor(() => expect(shell().style.fontSize).toBe("14px"));
  });

  it("不带 ⌘ 的加减号留给输入法，不动字号", async () => {
    const { container } = renderWindow(note());
    await loaded();

    fireEvent.keyDown(window, { key: "+" });

    expect((container.querySelector(".note") as HTMLElement).style.fontSize).toBe("14px");
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
  beforeEach(() => {
    fakeWindow.size = null;
    fakeWindow.position = null;
    fakeWindow.origin = { x: 200, y: 200 };
    document.documentElement.classList.remove("submenu-left");
  });

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

  it("选字体发回便签窗口执行，菜单留着", async () => {
    await renderMenu();

    fireEvent.click(document.querySelector('[data-action="menu-font"]') as HTMLElement);
    fireEvent.click(document.querySelector('[data-action="pick-font-maple"]') as HTMLElement);

    await waitFor(() =>
      expect(emitTo).toHaveBeenCalledWith("n1", "note-menu-action", {
        id: "n1",
        action: { kind: "font", value: "maple" },
      }),
    );
    // 字体要连着比着选，菜单不能自己收起
    expect(closedMenu()).toBe(false);
    await waitFor(() =>
      expect(document.querySelector('[data-action="menu-font"]')?.textContent).toContain("Maple"),
    );
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


  it("缩字号时菜单留着，回显跟着加一格", async () => {
    await renderMenu();

    fireEvent.click(document.querySelector('[data-action="font-up"]') as HTMLElement);

    await waitFor(() =>
      expect(emitTo).toHaveBeenCalledWith("n1", "note-menu-action", {
        id: "n1",
        action: { kind: "fontScale", step: 1 },
      }),
    );
    // 用户要连着点着调大小，收起就没法一边调一边看
    expect(closedMenu()).toBe(false);
    await waitFor(() =>
      expect(document.querySelector('[data-action="font-value"]')?.textContent).toBe("15"),
    );
  });

  it("二级菜单展开时窗口向右变宽，卡片不挪", async () => {
    stubMenuRects();
    await renderMenu();
    // 收起的窗口：卡片 208 + 两侧各 16px 阴影留白
    await waitFor(() => expect(fakeWindow.size?.width).toBe(240));

    fireEvent.click(document.querySelector('[data-action="menu-font"]') as HTMLElement);

    // 卡片右边多让出 194px（2 间距 + 192 菜单 + 16 阴影），位置一点不动
    await waitFor(() => expect(fakeWindow.size?.width).toBe(434));
    expect(fakeWindow.position?.x).toBe(100);
    expect(document.documentElement.classList.contains("submenu-left")).toBe(false);

    fireEvent.click(document.querySelector('[data-action="menu-font"]') as HTMLElement);
    await waitFor(() => expect(fakeWindow.size?.width).toBe(240));
  });

  it("卡片右边放不下时窗口向左长，卡片留在原地", async () => {
    stubMenuRects();
    // 卡片右边缘在 1400 逻辑像素（1176 + 16 + 208），再加 194 就越过工作区右边（1500）
    fakeWindow.origin = { x: 2352, y: 200 };
    await renderMenu();
    await waitFor(() => expect(fakeWindow.size?.width).toBe(240));

    fireEvent.click(document.querySelector('[data-action="menu-font"]') as HTMLElement);

    // 翻了方向：窗口左边多出 196px（2 + 192 + 2），窗口本身往左挪 180px 补回来
    await waitFor(() => expect(fakeWindow.size?.width).toBe(420));
    expect(fakeWindow.position?.x).toBe(996);
    expect(document.documentElement.classList.contains("submenu-left")).toBe(true);
  });
});
