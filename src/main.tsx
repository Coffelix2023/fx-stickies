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

// 便签窗口的地址带 ?note=<uuid>。没有就不是应用窗口，不渲染内容。
const noteId = new URLSearchParams(window.location.search).get("note");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {noteId ? (
      <Suspense fallback={null}>
        <NoteWindow id={noteId} />
      </Suspense>
    ) : null}
  </React.StrictMode>,
);
