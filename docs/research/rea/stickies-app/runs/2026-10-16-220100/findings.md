# Findings: Stickies.app 10.3 与 Tauri MenuBar 可行性

run: 2026-10-16-220100 · 标签: 【观察】=工件直接读到; 【推断】=由观察推出; 【未知】=未验证。证据编号见 evidence.md。

## TL;DR

- Stickies 是纯原生 Objective-C / AppKit 应用, 基于 NSDocument, 一张便签 = 一个 NSWindow = 一个 `<UUID>.rtfd` 文件。它不是菜单栏应用。
- 用 Tauri 2 做以托盘菜单为主的 macOS MenuBar 便签应用可行。窗口行为(置顶、半透明、折叠、拖动)都能用 Tauri 窗口 API 复刻。
- 复刻不了的部分: 系统 Services 菜单 "Make Sticky"、RTFD 原生富文本格式、NSDocument 的自动恢复。需要自建存储格式或写原生插件。
- Linux 扩展可行, 但 Tauri 托盘在 Linux 不发 click 事件, 只能靠右键菜单。你的设计是 "托盘菜单为主", 恰好不依赖 click。

## Q1 Stickies 的架构与技术栈

**F-01 【观察】原生 AppKit, 无跨平台运行时。**
主程序是 arm64e + arm64e.x1 的 universal Mach-O, 只链接 Foundation / CoreFoundation / AppKit / Cocoa / CoreServices / QuartzCore / UniformTypeIdentifiers / libobjc / libSystem; 没有 Swift 运行库、WebKit 或 Electron 痕迹。[E1, E2]
推断: UI 由 nib 构建(`MainMenu.nib`, `SNDocument.nib`, `SNMigrationWindowController.nib`), Info.plist 的 `NSMainNibFile=MainMenu`。[E1]

**F-02 【观察】类划分(12 个自有类 + 2 个协议)。** [E4, E6-E16]

| 类 | 职责(来自方法名/伪代码) |
|---|---|
| SNAppDelegate | 启动、注册默认值、Services 提供者、Dock 菜单、屏幕参数变化、迁移 XPC |
| SNDocument (NSDocument) | 读写 rtfd、窗口状态、导出、打印、排序比较 |
| SNDocumentController | 未保存审核、最近文档数、打开空白文档 |
| SNWindow (NSWindow) | 便签窗口: 置顶、半透明、折叠、脊条(spine)、删除线、拼写检查、查找替换 |
| SNSpineView | 折叠后的标题脊条, `mouseDown:` |
| SNMenuController | 颜色菜单、排列(arrange)、撤销排列、导入/导出文本、导出到 Notes |
| SNUtility | 单例: 颜色表、UUID 状态字典、窗口 frame/z-order/多屏 frame 持久化 |
| SNFindController | 自制查找面板, 可在当前或全部便签替换 |
| StickiesService | 系统 Services 入口 |
| SNMigrationWindowController / SNDashboardStickiesImporter | 从旧 Dashboard 便签迁移 |
| SNWindowControlButtonCell | 自绘窗口按钮 |
| 协议 StickiesProtocol / StickiesMigrationProtocol | 主程序与 XPC 迁移服务通信 |

**F-03 【观察】沙盒 + XPC。** entitlement: app-sandbox, files.user-selected.read-write, print, 以及对 `/Library/Preferences/widget-com.apple.widget.stickies.plist` 的只读例外。含 `StickiesMigration.xpc`(`com.apple.StickiesMigration`)。[E1, E4]

**F-04 【观察】不是菜单栏应用。** Info.plist 无 `LSUIElement`; `nm -u` 与 Ghidra 的过程/字符串搜索均无 `NSStatusItem`/`NSStatusBar`; 实现了 `applicationDockMenu:`, 说明入口是 Dock 和主菜单。[E1, E6, E28, E29, E30]
边界: 否定仅对这三种搜索成立, 见 limitations L-03。

## Q2 便签核心行为(可复用的行为契约)

**F-05 【观察】置顶 = 窗口 level 3, 否则 0。** `SNWindow::setFloating:` 调用 `setLevel:`, 值 `3`(与 SDK `kCGFloatingWindowLevel = 3` 一致)。`toggleFloatingMenuAction:` 取反后调用 delegate `updateChangeCount:`, 即切换会让文档变脏、触发保存。[E19, E20]

**F-06 【观察】半透明 = alpha 0.75, 否则 1.0。** `setTranslucent:` 调用 `setAlphaValue:`, 常量 `0x3fe8000000000000`=0.75(本地换算)。[E21]

**F-07 【观察】窗口可按背景拖动; collectionBehavior 返回 4。** `isMovableByWindowBackground` 恒真; `collectionBehavior` 返回 `4`。SDK 头文件中 `NSWindowCollectionBehaviorManaged = 1<<2`, 所以是 Managed(参与 Spaces/Exposé)。[E22, E27, SDK 头文件检查]
即: 置顶便签并不在所有桌面显示, 它只是 level 提升。

**F-08 【观察 + 推断】折叠 = 缩成脊条。** `collapse:` 保存展开尺寸(`expandedFrameSize`)与 `expandFrameY`, 隐藏 zoom 按钮, 显示标题栏文本, 修改 styleMask 的 `8` 位, 再 `setFrame:display:animate:` 动画。展开时按相反流程恢复。[E25]
【观察】styleMask 位 `8` = `NSWindowStyleMaskResizable (1 << 3)`(SDK 头文件 NSWindow.h 第 59 行, [E33])。所以折叠时清除 Resizable 位(`& ~8`), 展开时恢复(`| 8`), 即折叠态不可缩放。

**F-09 【观察】默认值。** 启动时 `registerDefaults`: 窗口尺寸 `300x200`(本地换算 0x4072c0.. / 0x4069..), 字体 `userFontOfSize:12`, Floating=false, Translucent=false, 颜色=`StickiesYellowColor`。另有 `CollapseWhenArranging` 旧布尔值迁移到整数键 `WhenArrangeOption`, 并关闭 `NSFullScreenMenuItemEverywhere`。[E18, E4]
限制: 启动函数 value-flow 被截断(L-02), 派生文件只存了前 3500 字符, 完整函数在 evidence bundle。

**F-10 【观察】颜色体系。** Yellow / Blue / Green / Pink / Purple / Gray 各有 4 个具名颜色: 本体、Highlight、Spine、Control; 另有 "Customized Color" 与 `StickyColor` 字符串。导出到 Notes 时按颜色建子文件夹。[E4]
注意: 字符串表里还出现 `Red`, 它是否为第 7 种便签色未确认。

**F-11 【观察】排列(arrange)。** 菜单项 "Arrange by %@", 比较器 `compareColor:/compareContent:/comparePosition:/compareModificationDate:`, 带撤销/重做(`arrangeUndoManager`)和 "折叠后排列" 选项。[E4, E7, E17]

**F-12 【观察】Services "Make Sticky"。** Info.plist 声明 NSServices(快捷键 Y, 接收 plain-text / rtf / flat-rtfd), 入口 `StickiesService::makeStickyFromTextService:userData:error:` 只转调 `SNDocument::makeStickiesFromPasteboard:`。[E1, E26]

## Q3 数据与持久化

**F-13 【观察】一便签一份 rtfd + 一份共享状态字典。**
`SNDocument::writeToURL:ofType:error:` 仅在类型为 `rtfd` 时写入: 调用 `SNWindow saveToFile:` 写内容, 再把 `saveWindowState:` 的结果存入 `SNUtility setSavedState:forUUID:`, 最后 `writeSavedStickiesStateToPersistentStorage` 以 `writeToFile:atomically:YES` 写入 `savedStickiesStatePath`。其他类型返回 Cocoa 错误 `0x200`。[E24, E23]
字符串: `~/Library/Stickies/`、`.SavedStickiesState`、`<UUID>.rtfd`。状态键: `Frame`, `ExpandedSize`, `ExpandFrameY`, `SpellCheckingTypes`, `ZOrder`, `MultiScreenFrame`。[E4]
旁证(未存档): 本机容器目录下看到多个 `<UUID>.rtfd` 条目名, 没有读取内容(见 L-07)。

**F-14 【观察】多屏位置容错。** 有 `multiScreenWindowFrameForUUID:`、`fitWindowFrame:inScreenFrame:`、`applicationDidChangeScreenParameters:`、`tryRestoringMultiScreenFrame`; os_log 中有 "Could not find stickies with UUID %@ when saving frame/z order/spell checking types"。[E8, E6, E17, E4]

**F-15 【观察】导出/导入。** 导出格式 txt/rtf/doc/docx/html/webarchive/xml/odt; "导出全部到 Notes" 会写临时目录 + Summary.txt, 再用 `com.apple.Notes` 打开, 找不到则回退 `/System/Applications/Notes.app`; 文件名 `Stickies-Export-%@.stickiesappexport`。[E4, E7]

## Q4 用 Tauri 做 MenuBar 应用是否可行

**F-16 【观察, 外部文档】Tauri 2 提供所需的核心 API。** [E34-E38]
- 托盘: `tauri` crate 开启 `tray-icon` 特性, `TrayIconBuilder` 支持图标、菜单、`on_menu_event`、`on_tray_icon_event`、`show_menu_on_left_click`。
- 无 Dock 图标: `ActivationPolicy { Regular, Accessory, Prohibited }`, `App::set_activation_policy` 与 `set_dock_visibility` 在 macOS 目标文档中存在(docs.rs, tauri 2.12.4)。
- 窗口: `WebviewWindowBuilder` 可运行时创建多窗口(每个唯一 label); `WebviewWindow` 方法含 `set_always_on_top`、`set_visible_on_all_workspaces`、`set_effects`、`set_shadow`、`set_ignore_cursor_events`、`set_size`、`set_position`、`start_dragging`、`set_skip_taskbar`。

**F-17 【推断】Stickies 行为到 Tauri 的映射。**

| Stickies(观察) | Tauri 对应 | 评估 |
|---|---|---|
| NSWindow level 3 | `always_on_top(true)` | 等价 |
| alpha 0.75 | 透明窗口 + CSS opacity, 或窗口 alpha | 可行, 见 F-18 |
| 背景可拖动 | `data-tauri-drag-region` / `start_dragging` | 等价 |
| 折叠成脊条 | `set_size` 缩到标题高度, 保存 expanded size | 可行, 无原生动画 |
| 一便签一窗口 | 每张便签一个 WebviewWindow, label=UUID | 可行, 内存见 F-19 |
| 状态字典 + 位置恢复 | 自写 JSON + `available_monitors` 校验 | 可行 |
| rtfd 富文本 | 编辑器(Tiptap/Lexical)存 JSON/HTML | 需自建格式 |
| Services "Make Sticky" | 无现成 API | 需原生代码(NSServices + objc2) |
| Dock 菜单 | 与 MenuBar 定位冲突 | 不需要 |

**F-18 【观察, 外部文档】透明窗口在 macOS 需要私有 API。** 配置 `app.macOSPrivateApi=true`, 官方警告会导致无法上架 App Store。[E36] 若走 Developer ID 公证分发则可接受; 若要上架 Mac App Store, 半透明窗口要改用其他方案(例如不透明窗口 + 背景色混合)。

**F-19 【推断, 未测量】每张便签一个 WKWebView 的成本高于一个 NSWindow。** 便签数量多(几十张)时内存与启动耗时需要实测; 建议只为可见便签创建窗口, 折叠/隐藏的便签保留数据不保留 webview。

**F-20 【观察, 外部文档】Linux 托盘限制。** Tauri/tray-icon 文档: Linux 上托盘事件(click 等)不发出, 右键菜单可用; `show_menu_on_left_click` 在 Linux 不支持; 需要 libappindicator 或 libayatana-appindicator。[E34, E35] 以托盘菜单为主的设计不受此限制。
【未知】Wayland 下置顶、所有工作区可见、GNOME 默认无托盘(需扩展)均未在本轮验证。

**F-21 【推断】结论。** 可行, 建议选 Tauri 2。把 Stickies 当作行为参考, 而非实现参考: 它的价值是窗口行为契约(F-05~F-11)和数据模型(F-13), 其 NSDocument/RTFD 机制不应照搬。尚未写任何 Tauri 原型, 可行性结论基于 API 文档与 Stickies 行为的对照, 不是实测。
