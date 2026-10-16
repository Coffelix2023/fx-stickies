# Proposal

## Why

macOS 自带便签不能做 Markdown 所见即所得、同一便签内分页、粘贴时去掉来源样式，顶部控件也太小，常用操作还放在用不到的侧栏。研究交接已经把可复用的窗口契约和 Tauri 2 边界写明，仓库目前没有应用代码，需要先把第一版成品的行为钉死。

## What Changes

- 新增一个仅面向 macOS 的菜单栏便签应用。启动后 Dock 没有图标，菜单栏有图标，左键直接打开菜单。
- 每张可见便签是一个无边框窗口。默认 300×200、字号 12、象牙底。窗口可以拖脊条、置顶、半透明、折叠成脊条。
- 每张便签存在一个 JSON 文件里。写入先落临时文件再改名。隐藏只关窗口，不删文件。
- 便签正文用所见即所得编辑，文档以 JSON 保存。同一便签内有整行分页。外部文本粘贴只保留纯文本。图像按所在栏宽度缩放。
- 常用外观放在托盘：底色、点阵或方格底纹、显示或隐藏、分栏。

## Capabilities

### New Capabilities

- `tray-menu`: 菜单栏入口、新建、列出、显示或隐藏、外观与退出。
- `note-window`: 一便签一窗口、拖动、置顶、半透明、折叠、位置恢复。
- `note-document`: JSON 文档、原子写入、隐藏与删除的边界。
- `note-editor`: 所见即所得、分页、分栏、纯文本粘贴、图像按栏宽缩放。

### Modified Capabilities

- 无。`openspec/specs/` 当前没有既有能力。

## Impact

- 仓库从空应用变成 Tauri 2 项目：根目录是 Vite、React、TypeScript 前端，`src-tauri/` 是 Rust 壳。
- 新增依赖限定为 Tauri 2、Vite、React、TypeScript、Tailwind CSS v4、Tiptap、shadcn `Tabs`、Zod、Vitest。
- 用户数据写到应用数据目录的 `notes/<uuid>.json`。macOS 上对应 `~/Library/Application Support/<identifier>/notes/`。
- 不包含 Services「Make Sticky」、真窗口透明、数据库、同步、自动更新和 Linux 打包。Linux 只要求托盘行为不依赖 click 事件。
