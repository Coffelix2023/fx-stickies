# fx-stickies

> 菜单栏便签 · 每张便签一个无边框窗口 · 所见即所得编辑
> A menu-bar sticky-note app: one borderless window per note, WYSIWYG editing.

macOS 自带便签不能做所见即所得编辑、粘贴会带来源样式、顶部控件太小。fx-stickies 把它换成菜单栏应用：Dock 无图标，左键托盘图标直接出菜单，新建即得一张可拖动、可置顶、可折叠的便签窗口。

The macOS Stacks app cannot do WYSIWYG editing, pastes carry source styling, and its top controls are too small. fx-stickies replaces it with a menu-bar app: no Dock icon, left-click the tray icon for the menu, and a new note opens as a borderless window you can drag, pin, or collapse.

## 功能 Features

- **一便签一窗口** — 默认 420×320，手动缩放下限 200×120，位置与尺寸重启后恢复
- **所见即所得** — Tiptap 编辑器，正文以 JSON 保存；外部粘贴只保留纯文本
- **Tab 缩进** — Tab 只做缩进，不在便签的按钮之间跳：焦点不在正文时第一下 Tab 把光标带回正文；列表里缩进一层、Shift+Tab 退一层，普通段落插制表符，工具栏也有缩进/减少缩进两枚按钮
- **字符数** — 右下角常驻显示总字符数，选中文字时变成「选中数 / 总数」
- **菜单栏入口** — 新建、便签列表、全部显示、全部隐藏、退出（Dock 无图标）
- **开机启动** — 「更多操作」里勾选「开机启动」，通过 macOS LaunchAgent 实现
- **外观设置** — 20 种底色分两组色卡（Soft Pastel Dreams + Enchanted Forest Hues），脊条上的调色板图标开合抽屉，单行高度跟着标题栏档位走，放不下时两端出箭头横向滚动，两枚成对出现、到头那枚置灰，挑完不收起；深色纸上正文自动切浅色。底纹（纯色/点阵/方格）在「更多操作」菜单里
- **界面缩放** — 「更多操作 > 外观 > 界面」里放大/缩小/重置字号（⌘ + / ⌘ − / ⌘0，默认 14px，范围 8–100px）
- **正文布局** — 「更多操作 > 外观」里切正文行距档位（紧凑 / 默认 / 宽松），随便签存盘
- **Markdown 工具栏** — 标题、加粗、斜体、删除线、行内代码、列表、引用、代码块、分割线、对齐、撤销重做，高度与标题栏一致（默认 20px）；脊条上的 `T` 图标直接开关。便签装不下时横向滚动，两端出成对的箭头（和底色抽屉同一套）
- **窗口控制** — 拖脊条移动、置顶、双击脊条铺满屏幕/恢复原尺寸、对齐到屏幕
- **冻结首行** — 「更多操作」菜单里勾选「冻结首行」，编辑时第一行固定在顶部，带投影与左右满格背景，滚动时其余内容从其下经过
- **原生菜单** — 「更多操作」是 macOS 原生 NSMenu：底纹、对齐、外观各收在子菜单里（底纹和标题栏档位带对勾），字号三项带 ⌘+ / ⌘− / ⌘0；点开即出，没有第二个窗口要建
- **标题栏尺寸** — 「外观 > 标题栏」四档（小/默认/大/超大），同时缩放脊条、工具栏、色块行的高度与图标，默认档是原来的 20px；档位随便签存盘
- **原子写入** — 先写同目录临时文件再改名，中断不会写坏原文件

- **首次启动** — 没有便签时自动新建一张，底色默认浅杏，位置贴到光标所在屏左上
- **导出便签** — 「更多操作 → 导出便签」支持 Markdown / 纯文本 / Word (.docx)
## 安装 Install

下载 `fx-stickies_<版本>_aarch64.dmg`，双击打开，然后**双击 `run-fix.command`**。脚本会自己把 app 装进 `/Applications`、解除 Gatekeeper（macOS 的启动安全网关）的隔离标记并启动它。

首次双击 `run-fix.command` 如果被系统拦下（脚本本身没有开发者签名），打开 **系统设置 → 隐私与安全**，在底部点「仍要打开」，再回来双击一次。免费方案绕不过这道放行。

不要直接把 `fx-stickies.app` 拖进 `/Applications`，拖拽会把隔离标记一起带过去，app 可能显示「已损坏」。已经拖了也没关系，再双击一次 `run-fix.command`，它会覆盖装好。

这个包没有 Apple Developer ID 签名和公证（需要 99 美元/年的开发者账号），所以需要上面那一次手动放行。想要完整的「双击即开、无任何提示」，只能走签名 + 公证。

从 0.2.1 起安装包带 bundle 级 ad-hoc 签名，`codesign --verify --deep --strict` 通过；更早的包签名是残缺的（`code has no resources but signature indicates they must be present`），这是「已损坏」提示的技术根因之一。

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
src/            前端：note/ 便签窗口与原生菜单，components/ui/ shadcn 组件
src-tauri/src/  Rust：note.rs 文档模型、frame.rs 可见性、tray.rs 托盘、lib.rs 窗口生命周期
openspec/       规格与已归档变更 specs and archived changes
```

## 范围 Scope

仅 macOS。不包含 Linux 打包、窗口真透明、同步、自动更新与数据库。
macOS only. No Linux packaging, true window transparency, sync, auto-update, or database.

