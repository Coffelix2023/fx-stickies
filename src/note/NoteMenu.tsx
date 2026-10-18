import { Ellipsis } from "lucide-react";

import { openMenuWindow } from "./storage";

/**
 * 脊条上的「更多操作」。菜单本体跑在自己的原生窗口里，
 * 所以便签窗口再小也裁不到它。
 */
export function NoteMenu({ id }: { id: string }) {
  return (
    <button
      type="button"
      aria-label="更多操作"
      title="更多操作"
      className="note-action grid size-[18px] shrink-0 place-items-center rounded"
      onClick={(event) => {
        // 按钮在视口里的位置交给窗口层换算成屏幕坐标。
        const rect = event.currentTarget.getBoundingClientRect();
        void openMenuWindow(id, { right: rect.right, bottom: rect.bottom }).catch(
          () => {},
        );
      }}
    >
      <Ellipsis className="size-3" aria-hidden />
    </button>
  );
}
