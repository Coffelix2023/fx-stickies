# Run 2026-10-16-220100: Stickies.app 实现分析 + Tauri MenuBar 可行性

- schema_version: 1
- run-id: 2026-10-16-220100
- parent_run: 无(首轮)
- 时间: 2026-10-16 22:01 至 22:12 (本地时间, CST UTC+8)
- 状态: **partial**(核心问题已回答; 未做运行时观察、NIB、XPC、arm64e.x1 切片、Tauri 原型; 见 limitations.md)
- 原始请求: 分析 `/System/Applications/Stickies.app` 的实现方法(逻辑/架构/技术栈/组件等); 评估用该方法开发以顶部系统托盘菜单为主要操作的 macOS MenuBar APP 时 Tauri 是否可行(未来扩展 Linux, 现阶段仅 macOS)。
- 允许的动作: 静态分析、只读文件检查、网页文档检索。未启动 Stickies, 未使用 `observe_native_calls`, 未读取便签内容。

## 问题清单

| # | 问题 | 状态 | 位置 |
|---|---|---|---|
| Q1 | Stickies 的架构与技术栈 | answered(限 arm64 切片, 静态) | findings F-01~F-04 |
| Q2 | 便签核心行为(置顶/半透明/折叠/默认值/颜色/排列/Services) | answered(静态, 启动函数后半部分未读) | F-05~F-12 |
| Q3 | 数据与持久化 | partial(存储键来自字符串, 未读状态文件样本) | F-13~F-15 |
| Q4 | Tauri 做 MenuBar 应用是否可行(含 Linux 扩展) | partial(基于官方文档与行为对照, 未做原型实测) | F-16~F-21 |

## 目标身份

| 项 | 值 |
|---|---|
| 路径 | `/System/Applications/Stickies.app` |
| Bundle ID / 版本 | com.apple.Stickies, 10.3 (build 728), LSMinimumSystemVersion 27.0 |
| 主程序 | `Contents/MacOS/Stickies`, 407056 字节, SHA-256 `30c565b2fde136ae35277f27d3e2ff74a711fea8dc07def8b53938f84b3bb3bb` |
| 架构 | universal: arm64e + arm64e.x1; REA/Ghidra 分析的是 `arm64` 切片 |
| 签名 | Apple 平台签名(macOS Software Signing), 沙盒 |
| 宿主 | macOS 27.0.1 (26A434) |

## 方法与版本

- Pi + 技能 `reverse-engineer-anything`(metadata version 37), REA CLI/MCP 6.4.0, Ghidra 12.1.4 (provider), 分析配置 digest `20565088524a2d0359b9b96f46ac48e679d774c7b0092c56abc06de8fdbec11c`。
- 同一 MCP 连接内完成, 会话开始时无外来 Evidence; 导出的 bundle 含 26 条记录, 0 unknowns。
- 文件检查: plutil, shasum, file, lipo, otool, nm, codesign, Xcode SDK 头文件 grep。
- 外部参考: Tauri 官方文档、docs.rs、tray-icon issue、第三方教程(只作参考)。
- 会话关闭: 见文末。

## 工件清单

路径相对本目录。状态: saved = 已写入磁盘。

| 路径 | 大小(字节) | SHA-256 | 状态 |
|---|---|---|---|
| findings.md | 10070 | 4d076da24e8eb4f9c3cffb33032ac523a687e0e97daa92fbb59542bacb90da1c | saved(哈希在 F-08 修订之后计算) |
| evidence.md | 7476 | 700abff714ee97827fe75b4274bf8ed4c86859fdf845336ae953842c011e3361 | saved |
| limitations.md | 4941 | 363d910ab3026f4ecf4b38551901a46faeccf32019f4ce20e5d1520e4e202c79 | saved |
| handoff.md | 4295 | 90074094e6d08a937b6d68d6d6a7bff5784c3de2e9b273fefd72af3363825fc5 | saved |
| .gitignore | 35 | 788945f0cd7951728cd071f5aa2039bb69e5a759292cbc46d92deb94631edcd9 | saved |
| raw/evidence-bundle.json | 5423682 | 71ac1fe5f50bf4b8cb3099bdee116c9b35adb9153716a1997992a9623c1ca924 | saved, 权限 600, `inspect-evidence-bundle` 校验通过; 未做导入测试 |
| raw/otool-ov-arm64e.txt | 230671 | 1a23607d0a5d8fd987d5df5236c001864de5097309f8a9a1446ff14f29a9c6c4 | saved |
| raw/nm-undefined-arm64e.txt | 3191 | 49ed55b6f90b30f43ed670f7a26ac41974a366509daef9e47f336c32ce85f1b1 | saved |
| derived/key-function-pseudocode.txt | 11473 | f7082bd78e11a427d422d91441d4382b19e1ac321099a6105f85b4f4fea12304 | saved(每函数截断 3500 字符) |
| derived/methname-keyword-hits.txt | 2850 | 51b8cf21e444c8f637273dc132010ce19428c868bfb64441d6706bdcf79e13da | saved |
| logs/bundle-inventory.txt | 6418 | 25545f94b8a5c49b751058024797c0ef7334262c346fe0ea4aed9760277ddd83 | saved |
| logs/objc-classnames-cstrings.txt | 6121 | 6f0ed43ffad61402f45903ab637a430d96480ba11d5292121ddec7a59d64a4f7 | saved |
| logs/sdk-stylemask-check.txt | 346 | 5e7d569061103368972dca0dafa412559ada7c16a60114ed3f43215c994139a6 | saved |
| logs/inspect-bundle.out | 21384 | 644d352f390f4356f7b81cbecb1de43c4e20db494b859ea9ffa155c69d530be7 | saved |
| logs/inspect-bundle.err | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | saved(空) |
| logs/inspect-bundle.exit | 2 | 9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa | saved, 内容 0 |
| logs/inspect-bundle.request.json | 152 | 93f12ef5f6c88e054c66fc9fbcb76b489c4998391d155323c108d3edc93a96cd | saved |
| logs/export-receipt.txt | 245 | 20ae989488edb63938a3c617d3d50899fd608a213956f80eb2ae873914cc51f7 | saved(手工整理的回执, 数值取自 export_evidence_bundle 返回) |
| logs/export-validate.exit | 2 | 9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa | saved, 手工写入 0, 对应 inspect-evidence-bundle 的退出码, 非独立命令产生 |
| logs/otool-ov.exit | 7 | 19eaf43821a7660ec323a87c8457bf74823beb296c39f5e01aa8a683aa50f061 | saved, 内容 exit=0 |
| logs/nm-u.exit | 7 | 19eaf43821a7660ec323a87c8457bf74823beb296c39f5e01aa8a683aa50f061 | saved, 内容 exit=0 |
| logs/derivation-failures.txt | 83 | 421aa2527b2f07f12fcbb7689aaa6923f79d98201de86ff5345be2575bf9f558 | saved |

以上哈希均由 shasum -a 256 在写入后重新计算。

## 关键结论(详见 findings.md)

1. Stickies 是原生 ObjC/AppKit 应用(NSDocument + 一便签一 NSWindow + 一 `<UUID>.rtfd`), 沙盒 + 一个迁移 XPC 服务; 不是菜单栏应用。
2. Tauri 2 做 macOS 菜单栏便签应用可行: 托盘、Accessory 激活策略、多窗口、置顶、透明均有 API。
3. 复刻成本集中在: 富文本格式(RTFD 无对应物)、Services "Make Sticky"(需原生桥)、macOS 透明窗口需私有 API(影响 App Store 上架)、多 WebView 的内存成本(未测)。
4. Linux 托盘不发 click 事件, 以右键/菜单为主的设计不受影响; Wayland 行为未验证。

## 会话状态

已关闭: 2026-10-16 22:12 CST 在 evidence bundle 导出并通过 `inspect-evidence-bundle` 校验、所有工件写盘之后调用 `close_binary`, 返回 `{"result":null}`。关闭时未保存 snapshot。关闭会清除会话内保留的 Evidence 引用; 恢复需从 `raw/evidence-bundle.json` 导入(导入本轮未测试, 见 limitations L-10)。
