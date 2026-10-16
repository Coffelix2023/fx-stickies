# Limitations: run 2026-10-16-220100

**L-01 架构覆盖不一致。** 二进制是 arm64e + arm64e.x1 universal。Ghidra/REA 会话只分析了 `arm64` 切片(`available_architectures: ["arm64"]`, subject architecture = arm64)。`otool`/`nm` 用 `-arch arm64e`。两者类/方法名一致(未逐项比对), 但 arm64e.x1 切片没有被分析, 也没有比较两个切片的差异。

**L-02 启动函数不完整。** `SNAppDelegate::applicationDidFinishLaunching:` (E18) value_flow `truncated=true`, `omitted_operations_lower_bound=1`。`derived/key-function-pseudocode.txt` 每个函数最多存 3500 字符, 启动函数后半部分(默认值字典组装、XPC 迁移分支、`loadSampleStickies` 调用)在派生文件里没有。完整记录在 `raw/evidence-bundle.json`, 可用 `inspect_analysis_view` 分页取回。F-09 的默认值只基于已读到的前半部分, 未覆盖的键未确认。

**L-03 负证据的边界(F-04)。** "不是菜单栏应用" 依据: (1) Info.plist 无 `LSUIElement` (E1); (2) `nm -u` 无 `NSStatusItem/NSStatusBar` 符号 (E28, 0 命中); (3) Ghidra `search_procedures` 与 `search_strings` 对字面量 "NSStatus" 为空 (E29, E30)。Ghidra 字符串搜索只覆盖已定义字符串, 空结果不证明字节中不存在该文本。ObjC 方法通过 `objc_msgSend` 动态调用, 类引用走 `__objc_classrefs`; 本轮没有直接检查 classrefs 段。结论限于这些查询。

**L-04 静态分析不证明运行时。** 所有 F-05~F-15 来自静态伪代码和字符串。没有启动 Stickies, 没有 `observe_native_calls`, 没有看到真实窗口行为。例如 F-07 的 "置顶便签不在所有桌面显示" 由 `collectionBehavior` 静态返回值 4 推出, 窗口运行期可能被其他代码修改(本轮没有检索 `setCollectionBehavior:` 调用)。F-08 的折叠动画未运行观察。

**L-05 NIB 未解析。** `MainMenu.nib`、`SNDocument.nib` 里的 UI 布局、outlet 连接、菜单项与快捷键没有读取。F-02 的职责来自方法名与伪代码, 不是来自 nib。`trace_native_ui_action` 本轮未使用。

**L-06 XPC 迁移服务未分析。** `StickiesMigration.xpc` 的可执行文件没有 `open_binary`, 它如何读取 Dashboard 旧数据是未知。F-02/F-03 对它只有 Info 与字符串层面的描述。

**L-07 本机用户数据。** 为确认存储形态, 列出了 `~/Library/Containers/com.apple.Stickies/Data/Library/Stickies` 的条目名(UUID 已在对话输出中以 `<UUID>` 替换), 没有读取便签内容, 也没有读取 `.SavedStickiesState` 内容。因此状态字典的实际结构(键名与值类型)只来自字符串, 未经样本验证。该路径在该机器上的存在不代表所有 macOS 版本相同。

**L-08 外部文档只是参考。** Tauri 相关结论来自官方文档、docs.rs 与第三方教程搜索摘要(E34-E38), 没有在本机构建任何 Tauri 原型, 没有测量内存/启动时间, 没有验证 `macOSPrivateApi` 在当前 macOS 版本的实际表现。docs.rs 默认(Linux)目标页面不显示 `set_activation_policy`, 只有 `x86_64-apple-darwin` 目标页面显示; `aarch64-apple-darwin` 页面请求返回了约 7 KB 的非正常页面, 未采用。结论 "App 有 set_activation_policy/set_dock_visibility" 依据 x86_64-apple-darwin 目标文档。

**L-09 Linux 部分未验证。** Wayland 下置顶/全工作区可见、GNOME 是否有托盘、libayatana 在目标发行版的可用性均未检查。F-20 只引用文档与 issue。

**L-10 Evidence 导出与会话。** 会话开始前没有外来记录(`get_evidence_bundle` summary 显示 26 条, 全部来自本轮, 同一 subject SHA-256)。导出 `raw/evidence-bundle.json` 后用 `rea inspect-evidence-bundle` (detail=summary) 校验通过, 退出码 0。**没有**执行 `rea evidence-import` 做导入恢复测试, 所以 "可导入恢复" 未经验证; 只验证了可解析与摘要列表。

**L-11 失败与恢复记录。**
- `inspect_native_dispatch_metadata` 参数 `max_records` 在 MCP 客户端被序列化成字符串, 两次调用均 "must be integer" 失败, 之后没有再重试该工具; 改用 `search_procedures` + `otool -ov`。
- 一次 codemode 脚本因该工具失败后访问 `undefined.length` 报错。
- 自编 Python 提取 `otool -ov` 中自有类的脚本输出 0 字节, 文件已删除, 记录在 `logs/derivation-failures.txt`; 类的方法清单改由 `search_procedures` 结果(E6-E17)取得。
- `get_objc_classes` 被客户端截断, 以 bundle 中完整记录为准。

**L-12 敏感与保存。** 没有密钥/令牌/Cookie。`raw/` 与 `logs/` 为 owner-only(目录 700, 文件部分 600); 本地 `.gitignore` 已排除 raw/logs/screenshots/snapshots。`derived/` 含系统二进制的伪代码摘录, 属于逆向派生内容, 默认不应上传或分享。

**L-13 复现边界。** 行为匹配仅限于所列函数。不能据此宣称 Tauri 版本与 Stickies 全产品等价。
