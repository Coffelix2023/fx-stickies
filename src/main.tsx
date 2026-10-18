import React from "react";
import ReactDOM from "react-dom/client";

import "./App.css";
// 便签控件样式在基础样式后加载，统一覆盖通用标签的外观。
import "./note/chrome.css";
import { NoteMenuWindow } from "./note/NoteMenuWindow";
import { NoteWindow } from "./note/NoteWindow";

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
      <NoteWindow id={noteId} />
    ) : null}
  </React.StrictMode>,
);
