# fx-stickies

> 菜单栏便签 · 每张便签一个无边框窗口 · 所见即所得编辑
> A menu-bar sticky-note app: one borderless window per note, WYSIWYG editing.

macOS 自带便签不能做所见即所得编辑、粘贴会带来源样式、顶部控件太小。fx-stickies 把它换成菜单栏应用：Dock 无图标，左键托盘图标直接出菜单，新建即得一张可拖动、可置顶、可折叠的便签窗口。

The macOS Stacks app cannot do WYSIWYG editing, pastes carry source styling, and its top controls are too small. fx-stickies replaces it with a menu-bar app: no Dock icon, left-click the tray icon for the menu, and a new note opens as a borderless window you can drag, pin, or collapse.

## 功能 Features

- **一便签一窗口** — 默认 420×320，手动缩放下限 200×120，位置与尺寸重启后恢复
- **所见即所得** — Tiptap 编辑器，正文以 JSON 保存；外部粘贴只保留纯文本
- **菜单栏入口** — 新建、便签列表、全部显示、全部隐藏、退出（Dock 无图标）
- **外观设置** — 10 种底色、纯色/点阵/方格底纹（Paper / Pattern）
- **窗口控制** — 拖脊条移动、置顶、对齐到屏幕、折叠成脊条
- **原子写入** — 先写同目录临时文件再改名，中断不会写坏原文件

## 技术栈 Stack

| 层 Layer | 技术 |
| --- | --- |
| 桌面壳 Shell | Tauri 2（Rust edition 2024，macOS 优先） |
| 前端 Frontend | React 19 + TypeScript + Vite 8 |
| 样式 Styling | Tailwind CSS v4 + shadcn/ui + Lucide |
| 编辑器 Editor | Tiptap 3 |
| 测试 Tests | Vitest（前端）· cargo test（Rust） |

## 开发 Development

前置：Node v24+、pnpm 12+、Rust 1.99+（edition 2024）。
Requires Node v24+, pnpm 12+, Rust 1.99+ (edition 2024).

```bash
pnpm install
pnpm tauri dev      # 启动桌面应用 run the desktop app
pnpm test           # 前端测试 frontend tests
cd src-tauri && cargo test   # Rust 测试 Rust tests
```

打包 Build：

```bash
pnpm tauri build
```

## 数据存储 Data

每张便签一个 JSON 文件，写到应用数据目录 `notes/<uuid>.json`：

```
~/Library/Application Support/app.fx.stickies/notes/<uuid>.json
```

隐藏只关窗口，不删文件。删除需要显式操作。旧版本的颜色名通过 serde alias 兼容读取，磁盘文件不需要迁移。
Hiding a note only closes its window; deleting it is always explicit. Older color names stay readable via serde aliases, so no on-disk migration is needed.

## 项目结构 Layout

```
src/            前端：note/ 便签窗口与菜单，components/ui/ shadcn 组件
src-tauri/src/  Rust：note.rs 文档模型、frame.rs 可见性、tray.rs 托盘、lib.rs 窗口生命周期
openspec/       规格与已归档变更 specs and archived changes
```

## 范围 Scope

仅 macOS。不包含 Linux 打包、窗口真透明、同步、自动更新与数据库。
macOS only. No Linux packaging, true window transparency, sync, auto-update, or database.

