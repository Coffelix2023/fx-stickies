import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";

import "./App.css";
// 便签控件样式在基础样式后加载，统一覆盖通用标签的外观。
import "./note/chrome.css";

// 便签窗口动态导入：静态引入会把编辑器那套依赖一起拖进首屏。
// 只有真的要渲染便签时才加载。
const NoteWindow = lazy(() =>
  import("./note/NoteWindow").then((module) => ({ default: module.NoteWindow })),
);
const PreviewWindow = lazy(() =>
  import("./note/PreviewWindow").then((module) => ({ default: module.PreviewWindow })),
);

// 便签窗口的地址带 ?note=<uuid>，独立预览窗口带 ?image-preview=<id>。都没有就不渲染。
const params = new URLSearchParams(window.location.search);
const noteId = params.get("note");
const previewId = params.get("image-preview");
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {previewId ? (
      <Suspense fallback={null}>
        <PreviewWindow id={previewId} />
      </Suspense>
    ) : noteId ? (
      <Suspense fallback={null}>
        <NoteWindow id={noteId} />
      </Suspense>
    ) : null}
  </React.StrictMode>,
);
