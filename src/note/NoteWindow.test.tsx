import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { JSONContent } from "@tiptap/core";

import type { Note } from "./document";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

/** listen 的回调存下来，测试里手动触发一次菜单回传。 */
const listeners = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: (e: { payload: unknown }) => void) => {
    listeners.set(event, handler);
    return Promise.resolve(() => listeners.delete(event));
  },
  emitTo: vi.fn(),
}));


/**
 * 窗口层测的是正文写回和落盘，编辑器本身由 editor.test.tsx 覆盖，
 * 所以这里换成可注入的桩，测试能直接改正文。
 */
vi.mock("./editor", () => ({
  useNoteEditor: (
    content: JSONContent,
    onChange: (content: JSONContent) => void,
  ) => ({ content, onChange }),
  NoteBody: ({
    editor,
  }: {
    editor: { content: JSONContent; onChange: (next: JSONContent) => void };
  }) => (
    <textarea
      aria-label="正文"
      value={JSON.stringify(editor.content)}
      onChange={(event) => editor.onChange(JSON.parse(event.target.value))}
    />
  ),
}));

const { NoteWindow } = await import("./NoteWindow");

/** 模拟菜单窗口回传一个动作。消息自带归属，默认发给 n1。 */
function sendMenuAction(action: unknown, id = "n1") {
  listeners.get("note-menu-action")?.({ payload: { id, action } });
}

const page = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function note(activeTab = "p1"): Note {
  return {
    id: "n1",
    title: "",
    tabs: ["p1", "p2"],
    activeTab,
    content: { p1: page("第一页的正文"), p2: page("第二页的正文") },
    paper: "alabasterGrey",
    pattern: "plain",
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
  invoke.mockImplementation((command: string, args?: unknown) => {
    if (command === "get_note") return Promise.resolve(loaded);
    // 置顶由窗口层写盘并返回磁盘上的版本，正文是旧的那份。
    if (command === "set_pinned") {
      return Promise.resolve({ ...loaded, pinned: (args as { pinned: boolean }).pinned });
    }
    return Promise.resolve(null);
  });
  return render(<NoteWindow id={loaded.id} />);
}

const editor = () => screen.getByLabelText<HTMLTextAreaElement>("正文");

/** 脊条左侧的置顶按钮，不在菜单里。 */
async function clickPin() {
  fireEvent.click(await screen.findByRole("button", { name: "置顶" }));
}

afterEach(() => {
  cleanup();
  invoke.mockReset();
  listeners.clear();
});

describe("便签只有一个正文区", () => {
  it("没有左侧分页栏，也没有分页标签和新建分页", async () => {
    const { container } = renderWindow(note());
    await waitFor(() => expect(editor().value).toContain("第一页的正文"));

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("button", { name: "新建分页" })).toBeNull();
    expect(container.querySelector(".note-rail")).toBeNull();
  });

  it("打开便签时显示文档里 activeTab 指向的那一页", async () => {
    renderWindow(note("p2"));

    await waitFor(() => expect(editor().value).toContain("第二页的正文"));
    expect(editor().value).not.toContain("第一页的正文");
  });

  it("改动只写回当前分页，其他分页原样留在文档里", async () => {
    renderWindow(note("p2"));
    await waitFor(() => expect(editor().value).toContain("第二页的正文"));

    fireEvent.change(editor(), {
      target: { value: JSON.stringify(page("第二页改过了")) },
    });

    await waitFor(() => {
      const saves = invoke.mock.calls.filter(([command]) => command === "save_note");
      const saved = saves[saves.length - 1];
      expect(JSON.stringify(saved?.[1].note.content.p2)).toContain("第二页改过了");
      expect(JSON.stringify(saved?.[1].note.content.p1)).toContain("第一页的正文");
      expect(saved?.[1].note.activeTab).toBe("p2");
      expect(saved?.[1].note.tabs).toEqual(["p1", "p2"]);
    });
  });

  it("窗口命令落盘时也不动分页：其他页和 activeTab 都保留", async () => {
    renderWindow(note("p2"));
    await waitFor(() => expect(editor().value).toContain("第二页的正文"));

    // 置顶由窗口层写盘，返回的文档正文是旧的；落盘内容仍必须是完整的多页文档。
    await clickPin();

    await waitFor(() => {
      const saves = invoke.mock.calls.filter(([command]) => command === "save_note");
      const saved = saves[saves.length - 1];
      expect(saved?.[1].note.activeTab).toBe("p2");
      expect(saved?.[1].note.tabs).toEqual(["p1", "p2"]);
      expect(JSON.stringify(saved?.[1].note.content.p1)).toContain("第一页的正文");
      expect(JSON.stringify(saved?.[1].note.content.p2)).toContain("第二页的正文");
    });
  });

  it("文字改动会落盘，且两页的正文都在文档里", async () => {
    renderWindow(note());
    await waitFor(() => expect(editor().value).toContain("第一页的正文"));

    fireEvent.change(editor(), {
      target: { value: JSON.stringify(page("新写的")) },
    });

    await waitFor(() => {
      const calls = invoke.mock.calls;
      const saved = calls[calls.length - 1];
      expect(saved?.[0]).toBe("save_note");
      expect(JSON.stringify(saved?.[1].note.content.p1)).toContain("新写的");
      expect(JSON.stringify(saved?.[1].note.content.p2)).toContain("第二页的正文");
    });
  });

  it("菜单回传的底色和底纹会落盘", async () => {
    renderWindow(note());
    await waitFor(() => expect(editor().value).toContain("第一页的正文"));

    sendMenuAction({ kind: "appearance", patch: { paper: "cottonRose" } });
    sendMenuAction({ kind: "appearance", patch: { pattern: "grid" } });
    await waitFor(() => {
      const calls = invoke.mock.calls;
      const saved = calls[calls.length - 1];
      expect(saved?.[1].note.paper).toBe("cottonRose");
      expect(saved?.[1].note.pattern).toBe("grid");
    });
  });
});


describe("保存一致性", () => {

  it("改正文后收窗口命令，草稿不被覆盖", async () => {
    renderWindow(note());
    await waitFor(() => expect(editor().value).toContain("第一页的正文"));

    fireEvent.change(editor(), {
      target: { value: JSON.stringify(page("改过还没落盘")) },
    });
    await waitFor(() => expect(editor().value).toContain("改过还没落盘"));

    // 置顶命令返回的是磁盘上的旧文档
    await clickPin();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "置顶" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    expect(editor().value).toContain("改过还没落盘");

    await clickPin();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "置顶" }).getAttribute("aria-pressed")).toBe(
        "false",
      ),
    );
    expect(editor().value).toContain("改过还没落盘");
  });


  it("保存失败保留草稿，重试后才清掉提示", async () => {
    let shouldFail = true;
    invoke.mockImplementation((command: string) => {
      if (command === "get_note") return Promise.resolve(note());
      if (command === "save_note" && shouldFail) {
        shouldFail = false;
        return Promise.reject(new Error("磁盘只读"));
      }
      return Promise.resolve(null);
    });
    render(<NoteWindow id="n1" />);
    await waitFor(() => expect(editor().value).toContain("第一页的正文"));

    fireEvent.change(editor(), {
      target: { value: JSON.stringify(page("没保存下来的字")) },
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("磁盘只读");
    // 界面没有被错误段落顶掉，草稿还在
    expect(editor().value).toContain("没保存下来的字");

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(editor().value).toContain("没保存下来的字");

    const saves = invoke.mock.calls.filter(
      ([command]) => command === "save_note",
    );
    expect(
      JSON.stringify(saves[saves.length - 1]?.[1].note.content.p1),
    ).toContain("没保存下来的字");
  });
});


describe("隐藏便签", () => {
  it("先落盘再让窗口层关窗", async () => {
    renderWindow(note());
    await waitFor(() => expect(editor().value).toContain("第一页的正文"));

    fireEvent.change(editor(), {
      target: { value: JSON.stringify(page("关掉前写的")) },
    });
    sendMenuAction({ kind: "hide" });

    await waitFor(() => {
      const call = invoke.mock.calls.find(
        ([command]) => command === "set_visible",
      );
      expect(call?.[1]).toEqual({ id: "n1", visible: false });
    });
    const order = invoke.mock.calls.map(([command]) => command);
    expect(order.indexOf("save_note")).toBeLessThan(order.indexOf("set_visible"));

    const saves = invoke.mock.calls.filter(
      ([command]) => command === "save_note",
    );
    expect(JSON.stringify(saves[saves.length - 1]?.[1].note.content.p1)).toContain(
      "关掉前写的",
    );
  });

  it("存不进去就不关，窗口留着给重试", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "get_note") return Promise.resolve(note());
      if (command === "save_note") return Promise.reject(new Error("磁盘只读"));
      return Promise.resolve(null);
    });
    render(<NoteWindow id="n1" />);
    await waitFor(() => expect(editor().value).toContain("第一页的正文"));

    fireEvent.change(editor(), {
      target: { value: JSON.stringify(page("关不掉的字")) },
    });
    sendMenuAction({ kind: "hide" });

    expect((await screen.findByRole("alert")).textContent).toContain("磁盘只读");
    expect(
      invoke.mock.calls.some(([command]) => command === "set_visible"),
    ).toBe(false);
    expect(editor().value).toContain("关不掉的字");
  });
});
