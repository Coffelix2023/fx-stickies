import { listen } from "@tauri-apps/api/event";
import { Ellipsis } from "lucide-react";
import { useEffect, useState } from "react";

import { closeMenuWindow, openMenuWindow } from "./storage";

/**
 * 脊条上的「更多操作」。菜单本体跑在自己的原生窗口里，
 * 所以便签窗口再小也裁不到它。
 *
 * 菜单开着时再点是收起，不是重开。但菜单窗口被关掉有好几条路（点外面、Escape、
 * 收起、点按钮），便签窗口这边看不见，所以由 Rust 在窗口销毁时通知一声。
 */
export function NoteMenu({ id }: { id: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // 不声明 target 就是 Any，会把别的便签的关闭通知也收进来。
    const pending = listen<{ id: string }>(
      "note-menu-closed",
      (event) => {
        if (event.payload.id === id) setOpen(false);
      },
      { target: { kind: "WebviewWindow", label: id } },
    );
    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, [id]);

  return (
    <button
      type="button"
      aria-label="更多操作"
      title="更多操作"
      className="note-action grid size-[18px] shrink-0 place-items-center rounded"
      onClick={(event) => {
        if (open) {
          // 先复位再关：菜单可能已经被失焦那步关掉了，这里再关一次是空操作。
          setOpen(false);
          void closeMenuWindow(id).catch(() => {});
          return;
        }
        // 按钮在视口里的位置交给窗口层换算成屏幕坐标。
        const rect = event.currentTarget.getBoundingClientRect();
        setOpen(true);
        void openMenuWindow(id, { right: rect.right, bottom: rect.bottom }).catch(() =>
          setOpen(false),
        );
      }}
    >
      <Ellipsis className="size-3" aria-hidden />
    </button>
  );
}
