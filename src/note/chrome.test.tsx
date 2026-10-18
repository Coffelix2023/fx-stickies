import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Note } from "./document";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

const confirmDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: (...args: unknown[]) => confirmDialog(...args),
}));

/**
 * 原生菜单的假身。构造出来的每一项都记下来，测试里既看得到菜单长什么样，
 * 也拿得到它的 action —— 原生菜单没有 DOM，只能这么断言。
 */
type MenuItemLike = { text: string; checked?: boolean; enabled?: boolean; accelerator?: string; items?: MenuItemLike[]; action?: () => void };
let lastMenu: MenuItemLike[] = [];
let poppedAt: { x: number; y: number } | null = null;
vi.mock("@tauri-apps/api/menu", () => {
  const item = (opts: Partial<MenuItemLike>) => opts as MenuItemLike;
  return {
    MenuItem: { new: (opts: Partial<MenuItemLike>) => Promise.resolve(item(opts)) },
    CheckMenuItem: { new: (opts: Partial<MenuItemLike>) => Promise.resolve(item(opts)) },
    Submenu: {
      new: (opts: Partial<MenuItemLike>) =>
        Promise.resolve(item({ ...opts, items: opts.items ?? [] })),
    },
    PredefinedMenuItem: { new: (kind: string) => Promise.resolve({ text: kind }) },
    Menu: {
      new: (opts: { items: MenuItemLike[] }) => {
        lastMenu = opts.items;
        return Promise.resolve({
          popup: (at: { x: number; y: number }) => {
            poppedAt = at;
            return Promise.resolve();
          },
        });
      },
    },
  };
});

/**
 * 只有拖动区要窗口句柄。真实 getCurrentWindow 读注入的窗口元数据，jsdom 里没有，
 * 所以给个最小替身；startDragging 仍然走同一个 invoke，断言还是真实命令名。
 */
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "n1",
    startDragging: () => invoke("plugin:window|start_dragging", { label: "n1" }),
  }),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
}));

/** 滚动箭头到头了会置灰而不是消失。没装 jest-dom，直接读属性。 */
function disabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled;
}

/** 菜单里名字等于 text 的那一项，找不到就报错，省得断言一个空数组还绿着。 */
function menuItem(text: string): MenuItemLike {
  const flat = (items: MenuItemLike[]): MenuItemLike[] =>
    items.flatMap((entry) => [entry, ...(entry.items ? flat(entry.items) : [])]);
  const found = flat(lastMenu).find((entry) => entry.text === text);
  if (!found) throw new Error(`菜单里没有「${text}」，现有：${flat(lastMenu).map((i) => i.text).join(" ")}`);
  return found;
}

const { NoteWindow } = await import("./NoteWindow");

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
    pinned: false,
    translucent: false,
    collapsed: false,
    spineSize: "max",
    chromeSize: "normal",
    statusSize: "small",
    statusFaded: true,
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

/** 等到文档加载完、脊条按钮都在。 */
async function loaded() {
  await screen.findByRole("button", { name: "更多操作" });
}

afterEach(() => {
  cleanup();
  invoke.mockReset();
  confirmDialog.mockReset();
  lastMenu = [];
  poppedAt = null;
});

describe("便签外观", () => {
  it("拖动区只在脊条上，正文区域没有", async () => {
    const { container } = renderWindow(note());
    await waitFor(() =>
      expect(container.querySelector(".note-body")).not.toBeNull(),
    );

    // 拖动走显式 startDragging。挂 data-tauri-drag-region 会让 Tauri 自带脚本
    // 在 macOS 上私自放大窗口，和脊条的双击抢同一个手势。
    expect(container.querySelectorAll("[data-tauri-drag-region]")).toHaveLength(0);
    const draggable = container.querySelectorAll(".note-drag");
    expect(draggable).toHaveLength(1);
    expect(container.querySelector(".note-spine")?.contains(draggable[0])).toBe(true);
    expect(container.querySelector(".note-rail")).toBeNull();
    // 正文里的按下和移动不得拖动窗口
    expect(container.querySelector(".note-body")?.querySelector(".note-drag")).toBeNull();
    expect(container.querySelector(".ProseMirror")?.querySelector(".note-drag")).toBeNull();
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

  it("脊条上的底色按钮开合抽屉，点色块换底色并落盘", async () => {
    const { container } = renderWindow(note());
    await loaded();

    const drawer = () => container.querySelector(".note-paper-drawer");
    const toggle = screen.getByRole("button", { name: "底色" });
    expect(drawer()).toBeNull();

    fireEvent.click(toggle);
    expect(drawer()).not.toBeNull();
    // 两组色板共二十枚排一行，中间那道竖线分开；当前底色选中
    const swatches = drawer()?.querySelectorAll('[data-action^="paper-"]');
    expect(swatches).toHaveLength(20);
    expect(drawer()?.querySelectorAll(".paper-color-sep")).toHaveLength(1);
    expect(drawer()?.querySelector('[data-action="paper-burntPeach"]')).not.toBeNull();
    expect(
      drawer()?.querySelector('[data-action="paper-paleSky"]')?.getAttribute("data-state"),
    ).toBe("checked");
    // 用真实纸色变量填色，色块自己才是那个颜色
    expect(
      drawer()?.querySelector('[data-action="paper-porcelain"]')?.getAttribute("style"),
    ).toContain("var(--paper-porcelain)");

    fireEvent.click(drawer()?.querySelector('[data-action="paper-porcelain"]') as HTMLElement);

    await waitFor(() =>
      expect(container.querySelector(".note")?.getAttribute("data-paper")).toBe("porcelain"),
    );
    // 挑完不收起，用户还要一块一块点着比
    expect(drawer()).not.toBeNull();
    await waitFor(() => {
      const saves = invoke.mock.calls.filter(([command]) => command === "save_note");
      expect(saves[saves.length - 1]?.[1].note.paper).toBe("porcelain");
    });

    fireEvent.click(toggle);
    expect(drawer()).toBeNull();

    // 工具栏和抽屉抢脊条下面那一行，开一个收一个
    fireEvent.click(await screen.findByRole("button", { name: "显示工具栏" }));
    expect(container.querySelector(".note-toolbar")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "底色" }));
    expect(container.querySelector(".note-toolbar")).toBeNull();
    expect(drawer()).not.toBeNull();
  });

  it("一行放不下时两端架箭头，滚到头对应那端变禁用", async () => {
    renderWindow(note());
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "底色" }));

    const track = document.querySelector(".paper-color-track") as HTMLElement;
    // jsdom 不做布局：把宽度写死成「放得下 / 放不下」两种
    const size = (client: number, scroll: number) => {
      Object.defineProperty(track, "clientWidth", { value: client, configurable: true });
      Object.defineProperty(track, "scrollWidth", { value: scroll, configurable: true });
    };
    const scrollBy = vi.fn();
    Object.defineProperty(track, "scrollBy", { value: scrollBy, configurable: true });

    size(400, 400);
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("button", { name: /看.*底色/ })).toBeNull();

    size(160, 360);
    fireEvent(window, new Event("resize"));
    // 还没滚：两枚都在，左边那枚到头了所以禁用
    const left = screen.getByRole("button", { name: "向左看前面的底色" });
    expect(disabled(left)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "向右看后面的底色" }));
    expect(scrollBy).toHaveBeenCalledWith({ left: 60, behavior: "smooth" });

    // 滚到右尽头：两枚都还在，右边那枚换成禁用
    Object.defineProperty(track, "scrollLeft", { value: 200, configurable: true });
    fireEvent(track, new Event("scroll"));
    expect(disabled(screen.getByRole("button", { name: "向右看后面的底色" }))).toBe(true);
    expect(disabled(left)).toBe(false);
    fireEvent.click(left);
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -60, behavior: "smooth" });
  });
  it("脊条没有标题输入和半透明开关", async () => {
    renderWindow(note());
    await loaded();

    expect(screen.queryByLabelText("便签标题")).toBeNull();
    expect(screen.queryByRole("button", { name: "半透明" })).toBeNull();
  });
});

describe("脊条", () => {
  it("左边是置顶，右边依次是工具栏、底色和更多操作", async () => {
    const { container } = renderWindow(note());
    await loaded();

    const buttons = container.querySelectorAll(".note-spine button");
    expect(buttons).toHaveLength(4);
    expect(buttons[0].getAttribute("aria-label")).toBe("置顶");
    expect(buttons[1].getAttribute("aria-label")).toBe("显示工具栏");
    expect(buttons[2].getAttribute("aria-label")).toBe("底色");
    expect(buttons[3].getAttribute("aria-label")).toBe("更多操作");
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

  it("按下滑动过阈值才拖窗口，纯双击不碰原生拖拽", async () => {
    const { container } = renderWindow(note());
    await loaded();

    const drag = container.querySelector(".note-drag") as HTMLElement;
    const dragCalls = () =>
      invoke.mock.calls.filter(([name]) => name === "plugin:window|start_dragging").length;

    // 按下不动：这是点击，必须留给双击识别，不能立刻进原生拖拽循环
    fireEvent.pointerDown(drag, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { button: 0, clientX: 10, clientY: 10 });
    // 抖动两像素也还是点击
    fireEvent.pointerDown(drag, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 12, clientY: 11 });
    fireEvent.pointerUp(window, { button: 0, clientX: 12, clientY: 11 });
    expect(dragCalls()).toBe(0);

    // 拖动：过阈值才交给窗口层
    fireEvent.pointerDown(drag, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 10 });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("plugin:window|start_dragging", {
        label: "n1",
      }),
    );
    fireEvent.pointerUp(window, { button: 0, clientX: 40, clientY: 10 });
    expect(dragCalls()).toBe(1);

    // 一次完整的双击（两次按下、两次释放）全程不启动拖拽，放大只走 toggle_maximize
    fireEvent.pointerDown(drag, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerDown(drag, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.doubleClick(drag);
    expect(dragCalls()).toBe(1);
    expect(invoke.mock.calls.filter(([name]) => name === "toggle_maximize")).toHaveLength(1);
  });

  it("置顶的图标形状随状态变，线框和填实分得清", () => {
    const css = readFileSync("src/note/chrome.css", "utf8");
    // 只换底色在浅色纸上几乎看不出来，所以图标还要从线框变实心
    expect(css).toMatch(/\.note-action\[data-pinned="true"\] svg[^{]*\{[^}]*fill: currentColor/);

  });
  it("深色纸上正文切成浅色，选区再反回来", () => {
    const app = readFileSync("src/App.css", "utf8");
    const chrome = readFileSync("src/note/chrome.css", "utf8");
    // 第二组头两枚是深色：正文还是 #1c1915 就读不出来了
    for (const paper of ["charcoalBlue", "pineBlue"]) {
      expect(app).toMatch(
        new RegExp(`\\[data-paper="${paper}"\\][^{]*\\{[^}]*--note-ink: #f2f0ec`),
      );
    }
    // 选区用 ink 底 + paper 字，深色纸上照样反得过来
    expect(chrome).toMatch(/\.note ::selection\s*\{[^}]*background: var\(--note-ink\)/);
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
});
/**
 * 打开原生菜单并点其中一项。原生菜单没有 DOM，动作只能这样触发。
 * 这一步就是真实的路径：点脊条按钮 → 菜单建起来 → 点某项。
 */
async function pickMenuItem(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  await waitFor(() => expect(lastMenu.length).toBeGreaterThan(0));
  menuItem(text).action?.();
}

describe("原生菜单", () => {
  beforeEach(() => {
    lastMenu = [];
    poppedAt = null;
  });

  it("点「更多操作」在按钮右下角弹出，没有第二个窗口", async () => {
    renderWindow(note());
    await loaded();
    const button = screen.getByRole("button", { name: "更多操作" });
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      right: 300,
      bottom: 20,
    } as DOMRect);

    fireEvent.click(button);

    await waitFor(() => expect(poppedAt).not.toBeNull());
    expect(poppedAt).toEqual({ x: 300, y: 20 });
    // 菜单不再是独立窗口，所以没有任何菜单窗口命令
    expect(invoke.mock.calls.some(([command]) => String(command).includes("menu_window"))).toBe(
      false,
    );
  });

  it("底纹收进子菜单，当前底纹打勾", async () => {
    renderWindow({ ...note(), pattern: "grid" });
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    await waitFor(() => expect(lastMenu.length).toBeGreaterThan(0));

    const patterns = menuItem("底纹").items ?? [];
    expect(patterns.map((entry) => entry.text)).toEqual(["无", "点阵", "方格"]);
    expect(patterns.find((entry) => entry.text === "方格")?.checked).toBe(true);
    expect(patterns.find((entry) => entry.text === "点阵")?.checked).toBe(false);
  });

  it("对齐收进子菜单，九个位置都在", async () => {
    renderWindow(note());
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    await waitFor(() => expect(lastMenu.length).toBeGreaterThan(0));

    expect((menuItem("对齐到屏幕").items ?? []).length).toBe(9);
  });

  it("外观里标题栏是标签不是子菜单，字号三项带着快捷键", async () => {
    renderWindow({ ...note(), chromeSize: "large" });
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    await waitFor(() => expect(lastMenu.length).toBeGreaterThan(0));

    // 分割线那条假身没有文字，滤掉再比顺序。
    const look = (menuItem("外观").items ?? []).map((entry) => entry.text);
    expect(look.filter((text) => typeof text === "string")).toEqual([
      "标题栏",
      "小",
      "默认",
      "大",
      "超大",
      "界面",
      "放大",
      "缩小",
      "重置",
      "信息",
      // 两组选项同名（小/默认/大），顺序断言足以定位，选中态在下面的信息组测试里查。
      "off",
      "小",
      "默认",
      "大",
      "半透明",
    ]);
    // 标签是禁用项，点了没反应，也不该再有下级。
    expect(menuItem("标题栏").enabled).toBe(false);
    expect(menuItem("标题栏").items).toBeUndefined();
    // 标题栏组在信息组之前，同名选项靠位置区分：「大」是外观列表里的第 4 项。
    const lookItems = (menuItem("外观").items ?? []).filter(
      (entry) => typeof entry.text === "string",
    );
    expect(lookItems[3]?.text).toBe("大");
    expect(lookItems[3]?.checked).toBe(true);
    expect(lookItems[2]?.checked).toBe(false);

    // "=" 而不是 "+"：muda 里没有 Plus 这个键，写成 Plus 会被静默丢掉。
    expect(menuItem("放大").accelerator).toBe("CmdOrCtrl+Shift+=");
    expect(menuItem("缩小").accelerator).toBe("CmdOrCtrl+-");
    expect(menuItem("重置").accelerator).toBe("CmdOrCtrl+0");
    expect(menuItem("隐藏便签")).toBeTruthy();
    expect(menuItem("删除便签…")).toBeTruthy();
  });

  it("信息组是标签加四档，当前档位打勾", async () => {
    renderWindow({ ...note(), statusSize: "large" });
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    await waitFor(() => expect(lastMenu.length).toBeGreaterThan(0));

    const entries = (menuItem("外观").items ?? []).filter(
      (entry) => typeof entry.text === "string",
    );
    const label = entries.find((entry) => entry.text === "信息");
    expect(label?.enabled).toBe(false);
    expect(label?.items).toBeUndefined();

    // 「信息」之后是那四档，再加一个独立的「半透明」勾选项。
    const after = entries.slice(entries.indexOf(label as MenuItemLike) + 1);
    expect(after.map((entry) => entry.text)).toEqual(["off", "小", "默认", "大", "半透明"]);
    expect(after.find((entry) => entry.text === "大")?.checked).toBe(true);
    expect(after.find((entry) => entry.text === "off")?.checked).toBe(false);
    // 半透明默认勾选：它是辅助信息，不该和正文抢注意力。
    const faded = after.find((entry) => entry.text === "半透明");
    expect(faded?.checked).toBe(true);
    expect(faded?.items).toBeUndefined();
  });
});

describe("菜单动作", () => {
  it("换底纹会落盘", async () => {
    renderWindow(note());
    await loaded();

    await pickMenuItem("方格");

    await waitFor(() => {
      const saves = invoke.mock.calls.filter(([command]) => command === "save_note");
      const saved = saves[saves.length - 1];
      expect(saved?.[1].note.pattern).toBe("grid");
    });
  });

  it("界面里放大一次加一格", async () => {
    const { container } = renderWindow(note());
    await loaded();

    await pickMenuItem("放大");

    await waitFor(() =>
      expect((container.querySelector(".note") as HTMLElement).style.fontSize).toBe("15px"),
    );
  });

  it("换字符统计档位：档位跟着落盘", async () => {
    const { container } = renderWindow(note());
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    await waitFor(() => expect(lastMenu.length).toBeGreaterThan(0));
    // 「大」在标题栏和信息组各有一个，这里点信息组那个：它在「信息」标签之后。
    const look = (menuItem("外观").items ?? []).filter(
      (entry) => typeof entry.text === "string",
    );
    const infoAt = look.findIndex((entry) => entry.text === "信息");
    look.slice(infoAt + 1).find((entry) => entry.text === "大")?.action?.();

    await waitFor(() =>
      expect((container.querySelector(".note-status") as HTMLElement).dataset.statusSize).toBe(
        "large",
      ),
    );
    await waitFor(() => {
      const saves = invoke.mock.calls.filter(([command]) => command === "save_note");
      expect(saves[saves.length - 1]?.[1].note.statusSize).toBe("large");
    });
  });

  it("取消勾选半透明：data-faded 翻转并落盘", async () => {
    const { container } = renderWindow(note());
    await loaded();

    // 默认是勾选态，点一下变 false。
    await pickMenuItem("半透明");

    const status = () => container.querySelector(".note-status") as HTMLElement;
    await waitFor(() => expect(status().dataset.faded).toBe("false"));
    await waitFor(() => {
      const saves = invoke.mock.calls.filter(([command]) => command === "save_note");
      expect(saves[saves.length - 1]?.[1].note.statusFaded).toBe(false);
    });
  });
  it("换标题栏档位：根节点换 data-chrome-size，档位跟着落盘", async () => {
    const { container } = renderWindow(note());
    await loaded();

    await pickMenuItem("超大");

    await waitFor(() =>
      expect((container.querySelector(".note") as HTMLElement).dataset.chromeSize).toBe("xlarge"),
    );
    await waitFor(() => {
      const saves = invoke.mock.calls.filter(([command]) => command === "save_note");
      expect(saves[saves.length - 1]?.[1].note.chromeSize).toBe("xlarge");
    });
  });

  it("对齐走窗口命令，屏幕坐标由窗口层算", async () => {
    renderWindow(note());
    await loaded();

    await pickMenuItem("右下角");

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("align_note", { id: "n1", placement: "bottomRight" }),
    );
  });

  it("隐藏只关窗口，不删文档", async () => {
    renderWindow(note());
    await loaded();

    await pickMenuItem("隐藏便签");

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_visible", { id: "n1", visible: false }),
    );
    expect(invoke.mock.calls.some(([command]) => command === "delete_note")).toBe(false);
  });

  it("删除先问过用户，确认后才真删", async () => {
    confirmDialog.mockResolvedValue(false);
    renderWindow(note());
    await loaded();

    await pickMenuItem("删除便签…");

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    expect(invoke.mock.calls.some(([command]) => command === "delete_note")).toBe(false);

    confirmDialog.mockResolvedValue(true);
    await pickMenuItem("删除便签…");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("delete_note", { id: "n1" }),
    );
  });
});
