# Handoff: run 2026-10-16-220100

状态: partial(核心问题已回答; 原型验证与部分静态覆盖未做, 见下)。

## 已确定的行为与可复用入口

- 原生 AppKit/ObjC、NSDocument 模型、一便签一窗口一 `<UUID>.rtfd`, 状态字典集中写入 `.SavedStickiesState`(F-01, F-02, F-13)。
- 窗口行为契约(用作 Tauri 验收基准): 置顶 level 3、半透明 alpha 0.75、背景拖动、折叠保存 expandedFrameSize 并清除 Resizable、默认 300x200 / 字体 12(F-05~F-09)。
- Evidence 入口: `raw/evidence-bundle.json` (SHA-256 71ac1fe5...a924, 26 条)。要读某函数全文, 用 `inspect_analysis_view` 并传 evidence_id; 例: `ev_c3a18f68...f227` 是启动函数。

## 未决问题与最小下一步证据

| 问题 | 最小下一步 |
|---|---|
| 启动函数后半部分与完整默认值键 | `inspect_analysis_view` view `{kind:"native", facet:"pseudocode", offset:3500, limit:8000}` 取 E18 |
| `.SavedStickiesState` 的真实键结构 | 在测试账号或新建一张空便签后, 用 `plutil -p` 读状态文件(只读结构, 不读正文) |
| 是否有 `setCollectionBehavior:`/动态修改 level | `search_strings`/`trace_feature` "setCollectionBehavior"; 或 `observe_native_calls`(会启动目标, 需用户授权) |
| NIB 中的菜单与快捷键 | `plutil`/`ibtool --convert` 导出 `MainMenu.nib`(只读), 或 `trace_native_ui_action` |
| arm64e.x1 切片差异 | 用 `open_binary` 对该切片重新分析(provider 若支持) |
| XPC 迁移服务 | `open_binary` `StickiesMigration.xpc/Contents/MacOS/StickiesMigration` |

## 复现蓝图(Tauri 2, 仅 macOS, 保留 Linux 扩展)

这是设计建议, 不是 Stickies 的实现。

- 进程模型: 单进程, `ActivationPolicy::Accessory` 隐藏 Dock 图标; 托盘 `TrayIconBuilder` + 菜单(新建便签、便签列表、按颜色新建、全部置顶/折叠、偏好、退出)。托盘左键直接弹菜单, 不依赖 click 事件(Linux 兼容)。
- 数据: `~/Library/Application Support/<app>/notes/<uuid>.json`(内容 + 颜色 + 置顶/半透明/折叠 + frame + expandedSize + zOrder), 原子写入(写临时文件再 rename)。可选导出 rtf/txt/html/md。
- 窗口: 每张可见便签一个 `WebviewWindow`, label = uuid, `decorations(false)`, 自绘标题栏/折叠脊条, `data-tauri-drag-region`; 置顶用 `set_always_on_top`; 半透明先用 CSS opacity 0.75, 需要真窗口透明再评估 `macOSPrivateApi`。
- 位置恢复: 启动时用 `available_monitors` 校验 frame, 不在任何屏幕内则回落到可见区域(参考 `fitWindowFrame:inScreenFrame:`)。
- 折叠: 保存 expanded 尺寸, 窗口高度缩到脊条高度, 禁用 resize; 展开恢复。
- 编辑器: Tiptap 或 Lexical, 存 JSON; 删除线、拼写检查、查找替换为后续项。
- 原生桥(如需要): Services "Make Sticky" 要通过 Info.plist `NSServices` + Objective-C/`objc2` 提供者, Tauri 无内置 API。

## 验收建议(行为级, 可自动化部分标 *)

1. 启动后 Dock 无图标、菜单栏有图标、点击托盘出菜单。
2. 新建便签为 300x200, 默认黄色, 字体 12。*(窗口尺寸可断言)
3. 置顶开关让窗口始终在普通窗口之上; 重启后保持。
4. 半透明开关使窗口内容 alpha 约 0.75; 重启后保持。
5. 折叠后高度变为脊条高度且不可缩放; 展开恢复原尺寸与位置。*
6. 拔掉外接屏后重启, 便签落在可见区域。
7. 异常退出后(kill -9)最近一次保存的内容仍在; 写入中断不产生半截文件。*
8. 50 张便签启动耗时与内存(基线需实测, 本轮无数字)。

## 恢复步骤

1. 校验 `raw/evidence-bundle.json` SHA-256 = 71ac1fe5f50bf4b8cb3099bdee116c9b35adb9153716a1997992a9623c1ca924。
2. 新连接用 REA 导入(`rea evidence-import` 或 MCP 等价操作), 读取实际恢复清单, 用真实恢复的 ID 定位 E18 后再继续。本轮未做导入测试(L-10)。
3. 若 `/System/Applications/Stickies.app/Contents/MacOS/Stickies` 的 SHA-256 不再是 30c565b2...3bb3bb(例如系统更新), 先写 changed/unchanged 比较再沿用结论。

## 目标变化条件

macOS 升级后 Stickies 版本号(当前 10.3, build 728)或可执行文件哈希变化时, 本 run 的函数地址不再适用, 需新建 run 并记录 parent_run = 2026-10-16-220100。
