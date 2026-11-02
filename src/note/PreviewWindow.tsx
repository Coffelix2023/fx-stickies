import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * 独立的原图预览窗口（`index.html?image-preview=<id>`）。
 *
 * 和便签是两个原生窗口，图按本窗口视口收进可视区；
 * 全窗 zoom-out，点图、点遮罩或按 Esc 都关掉。
 */
export function PreviewWindow({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    invoke<string>("get_image_preview", { id })
      .then((value) => setSrc(value))
      .catch(() => setFailed(true));
  }, [id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void invoke("close_image_preview", { id }).catch(() => {});
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [id]);

  if (failed) return <p className="note-body px-3 py-2 text-xs">预览已关闭</p>;
  if (!src) return null;

  return (
    <div
      className="note-image-preview"
      role="dialog"
      aria-modal="true"
      aria-label="图像预览"
      onClick={() => void invoke("close_image_preview", { id }).catch(() => {})}
    >
      <img src={src} alt="" />
    </div>
  );
}
