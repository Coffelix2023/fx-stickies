import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";

import "./App.css";
// 便签控件样式在基础样式后加载，统一覆盖通用标签的外观。
import "./note/chrome.css";
import { NoteMenuWindow } from "./note/NoteMenuWindow";
// 便签窗口动态导入：菜单窗口用的是同一个入口，静态引入会把编辑器那套依赖一起拖进来。
// 只有真的要渲染便签时才加载，菜单点击的等待时间全在这条链上。
const NoteWindow = lazy(() =>
  import("./note/NoteWindow").then((module) => ({ default: module.NoteWindow })),
);

// 便签窗口的地址带 ?note=<uuid>，菜单窗口带 ?menu=<uuid>。
// 两个都没有就不是应用窗口，不渲染内容。
const params = new URLSearchParams(window.location.search);
const noteId = params.get("note");
const menuId = params.get("menu");

// 菜单窗口的根元素只当一层透明底，样式钩子挂在 html 上。
if (menuId) document.documentElement.classList.add("menu-window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {menuId ? (
      <NoteMenuWindow id={menuId} />
    ) : noteId ? (
      <Suspense fallback={null}>
        <NoteWindow id={noteId} />
      </Suspense>
    ) : null}
  </React.StrictMode>,
);
