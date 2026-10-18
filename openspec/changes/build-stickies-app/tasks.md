# Tasks

## 1. 脚手架

- [x] 1.1 在仓库根目录生成 Tauri 2 + Vite + React + TypeScript 项目，包管理器用 pnpm。确认 `src-tauri/src/main.rs` 只调用库入口，`pnpm tauri dev` 能打开默认窗口。
- [x] 1.2 选定并写入 bundle identifier，安装 Tailwind CSS v4、Zod、Vitest。确认 `pnpm test` 在尚无业务测试时通过。

## 2. 文档与几何

- [x] 2.1 在 `src-tauri/src/note.rs` 定义设计文档列出的字段，并用同目录临时文件、flush、rename 实现保存。用 `cargo test` 验证中断替换前原文件不变，完成后目标是完整 JSON。
- [x] 2.2 为读取加完整文档校验，拒绝缺字段或类型错误的文件。用 `cargo test` 验证失败时不创建窗口且不回写原文件。
- [x] 2.3 在 `src-tauri/src/frame.rs` 写纯函数，判断保存 frame 与 `available_monitors` 是否相交。用 `cargo test` 覆盖相交、不相交和空显示器列表。

## 3. 窗口生命周期

- [x] 3.1 在 `lib.rs` 按 uuid 创建无边框、默认 300×200 的 `WebviewWindow`，隐藏时关闭窗口并保留文件。验证同一 uuid 不会出现两个窗口。
- [x] 3.2 接通置顶、内容 opacity 0.75、折叠与展开。验证折叠写入 `expandedSize`、禁止缩放，展开恢复尺寸和位置。
- [x] 3.3 打开窗口前调用 `frame.rs`。用一组假显示器数据验证屏幕外 frame 会落到可见工作区。

## 4. 便签界面

- [x] 4.1 用 shadcn `Tabs` 做整行分页，Tiptap 保存每个分页的 JSON。用 Vitest 验证切换分页不丢失内容，重启状态能恢复 `activeTab`。
- [x] 4.2 实现单栏和左右对照分栏、纯文本粘贴、图像按栏宽缩放。用组件测试验证富文本粘贴只剩文字，宽图使用 `width: 100%`。
- [x] 4.3 做脊条、底色、底纹和拖动区域。验证拖动属性只在脊条上，正文区域没有。

## 5. 托盘集成

- [ ] 5.1 设置 `ActivationPolicy::Accessory` 和 `menuOnLeftClick`，菜单含新建、列表、显隐、外观、全部显示、全部隐藏、退出。在 macOS 上确认 Dock 无图标且左键直接出菜单。
- [ ] 5.2 把托盘操作接到文档和窗口。手动验证新建默认值、隐藏后仍可恢复、外观重启后保持。

## 6. 端到端验收

- [ ] 6.1 按四份 spec 的场景做一次 macOS 手工验收，记录通过和未通过项。验收不包含 50 张便签内存、真窗口透明和 Services「Make Sticky」。

## Workflow follow-up

- 验收通过后，由用户另行启动 archive。
- archive 时把四份 delta spec 同步到主 specs。
