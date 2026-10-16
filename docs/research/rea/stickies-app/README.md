# stickies-app (REA 研究档案)

## 目标身份

- `/System/Applications/Stickies.app`, com.apple.Stickies, 版本 10.3 (build 728)
- 主程序 SHA-256 `30c565b2fde136ae35277f27d3e2ff74a711fea8dc07def8b53938f84b3bb3bb` (universal arm64e + arm64e.x1; 已分析 arm64 切片)
- 宿主 macOS 27.0.1

## Runs

| run | 日期 | 状态 | 内容 |
|---|---|---|---|
| [2026-10-16-220100](runs/2026-10-16-220100/README.md) | 2026-10-16 | partial | 架构/行为/持久化静态分析; Tauri MenuBar 可行性评估 |

## 最新结论与交接

- 原生 AppKit/NSDocument 应用, 不是菜单栏应用; Tauri 2 做 macOS 托盘便签应用可行, 注意透明窗口私有 API、富文本格式、Services 桥。
- 交接: [handoff.md](runs/2026-10-16-220100/handoff.md)(未决问题、复现蓝图、验收建议)。
- 原始 Evidence 与日志在各 run 的 `raw/`、`logs/`(本地受限, 已被 `.gitignore` 排除)。
