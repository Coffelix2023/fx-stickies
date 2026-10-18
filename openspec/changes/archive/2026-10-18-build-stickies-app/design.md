# Design

## Context

仓库没有应用代码。行为见本 change 的四份 delta spec，窗口契约来自 `docs/research/rea/stickies-app/runs/2026-10-16-220100/handoff.md`。Tauri 2 的标准项目是根目录前端加 `src-tauri/` Rust 项目；桌面入口留在 `src/main.rs`，应用代码放 `src/lib.rs`。

## Goals / Non-Goals

**Goals:**

- 用一个单进程菜单栏应用满足四份 spec。
- 把文档读写、窗口几何和前端渲染分成三个可单独测试的边界。
- 第一版只在 macOS 上打包和手测。

**Non-Goals:**

- 不实现 Services「Make Sticky」、真窗口透明、数据库、同步、自动更新。
- 不引入状态库、协作文档或第二套编辑器。
- 不在第一版测量或优化 50 张便签的内存。

## Decisions

### 1. 壳与前端

使用 Tauri 2、Vite、React、TypeScript、Tailwind CSS v4。

备选是纯 HTML 或 Svelte。纯 HTML 缺少现成的 shadcn 组件；Svelte 能做，但原型参照的是 React 组件。React 只负责一个窗口内的界面。

目录：

```text
src/main.tsx                  # 有 note 参数才渲染便签
src/note/NoteWindow.tsx
src/note/NoteEditor.tsx
src/note/editor.tsx
src-tauri/src/main.rs         # 保持脚手架入口
src-tauri/src/lib.rs          # 进程、托盘、窗口生命周期
src-tauri/src/note.rs         # 文档读写
src-tauri/src/frame.rs        # 可见屏幕判断
```

### 2. 进程与托盘

启动策略使用 `ActivationPolicy::Accessory`。托盘菜单使用 Tauri 的 `menuOnLeftClick`，不注册 click 处理。这样 macOS 左键出菜单，设计也不依赖 Linux 不提供的 click 事件。

菜单重建发生在文档集合变化之后。第一版不做驻留的动态菜单状态。

### 3. 一文档一窗口

窗口 label 等于文档 uuid。可见便签才创建 `WebviewWindow`；隐藏时关闭窗口并保留文件。窗口配置为 `decorations: false`、默认 420×320，手动缩放下限 200×120（下限写在窗口的 min size 上，同时兜住旧文档里更小的尺寸）。脊条使用 `data-tauri-drag-region`，正文不放该属性。

置顶调用 `set_always_on_top`。半透明字段保留兼容，界面不再提供开关，也不把内容透明度当作窗口透明。折叠把 `expandedSize` 写入文档，窗口高度改为脊条高度并关闭 resizable；展开时读回并恢复。

标题栏省略号「更多操作」用 shadcn 浮层，提供置顶、折叠、底色、底纹、标题栏高度和关闭。折叠后窗口只剩脊条高，浮层会被原生窗口裁掉，所以折叠态脊条直接显示「展开」和「关闭」两个图标按钮。「标题栏高度」提供 `min | normal | max`（18/30/36px），文档字段 `spineSize` 默认 `min`。`set_spine_size` 命令保存此窗口字段，折叠时同步尺寸；普通正文保存保留磁盘上的档位，前端合并命令结果时保留当前正文草稿。

### 4. 文档与原子替换

路径使用 `app_data_dir()/notes/<uuid>.json`。macOS 解析为 `~/Library/Application Support/<identifier>/notes/<uuid>.json`。

保存顺序固定为：写入同目录临时文件、完成 flush、在同一目录 `rename` 成目标文件。读取先用 Zod 校验完整文档。校验失败时不创建窗口，不回写文件。

文档字段固定为：`id`、`title`、`tabs`、`activeTab`、`content`、`paper`、`pattern`、`split`、`pinned`、`translucent`、`collapsed`、`frame`、`expandedSize`、`zOrder`、`visible`。

### 5. 编辑器
使用 Tiptap，正文按分页 id 存 Tiptap JSON（字段沿用 `tabs` / `activeTab` / `content`）。Plate 和 Lexical 都能做，但 Tiptap 的扩展和 JSON 文档直接对应该字段，第一版不需要自定义编辑器运行时。

界面只渲染 `activeTab` 指向的那一页：`src/note/NoteEditor.tsx` 拿 `activeContent(note)` 建一个编辑器实例，改动按分页 id 写回，其他页的 JSON 原样留在文档里。分页没有界面入口（既没有左侧分页栏，也没有新建分页），这是刻意的简化：`tabs` 和 `activeTab` 保留为兼容字段，旧便签的多页正文不丢。

### 6. 位置恢复

`frame.rs` 提供纯函数：输入保存的 frame 和当前 `available_monitors`，输出应使用的 frame。没有交集时放到第一个可见显示器的工作区内。窗口层只调用该函数，不自己做几何判断。

## Risks / Trade-offs

- [CSS opacity 不是原生窗口 alpha] → 第一版接受视觉近似；`macOSPrivateApi` 会阻止 App Store，留到以后单独立项。
- [每张可见便签一个 webview，数量上来后内存未知] → 第一版不设 50 张指标；隐藏必须关闭窗口，避免隐藏项继续占 webview。
- [rename 的原子性取决于同目录] → 临时文件必须创建在目标目录，不能跨目录移动。
- [托盘每次重建菜单] → 第一版便签数量小；出现明显延迟再改成局部更新。
- [损坏文档被拒绝打开，用户看不到正文] → 文件保持原样，后续可另做导出，不在本次自动修复。

## Migration Plan

这是首次落地，没有旧数据迁移。实现顺序是文档与几何、再窗口、再编辑器、最后托盘。回滚方式是移除应用数据目录前先整份复制 `notes/`；代码回滚只回到本次 change 之前的空应用状态。

## Open Questions

- bundle identifier 使用脚手架生成值还是 `app.fx.stickies`。两者不改变 spec、数据形状或任务，实施第一个脚手架任务时取一个并写入 `tauri.conf.json`。
