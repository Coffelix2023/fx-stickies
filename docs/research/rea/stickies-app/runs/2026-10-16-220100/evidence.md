# Evidence: run 2026-10-16-220100

命名空间: 本 run 的 E-编号。REA 记录的 Evidence ID 原样列出; 非 REA 来源写路径 + SHA-256 + 定位, 不伪造 ev_ ID。
REA 导出文件 `raw/evidence-bundle.json` 含全部 26 条 REA 记录(见 README 与 logs/export-receipt.txt)。
全部 REA 记录: subject sha256 = 30c565b2fde136ae35277f27d3e2ff74a711fea8dc07def8b53938f84b3bb3bb, authority = shipped-artifact, 除标注外 confidence = observed, provider = Ghidra 12.1.4 (analysis_profile_digest 20565088...ec11c)。

## 本机文件检查(非 REA 图证据)

| E | 来源 | 内容 | SHA-256(前 16) / 大小 | 反向引用 |
|---|---|---|---|---|
| E1 | `logs/bundle-inventory.txt` | plutil Info.plist/version.plist, shasum, file, lipo, otool -L, codesign+entitlements, XPC 与 Resources 目录列表 | 25545f94b8a5c49b / 6418 | F-01 F-03 F-04 F-12 |
| E4 | `logs/objc-classnames-cstrings.txt` | otool -v 的 `__objc_classname`、`__cstring`、`__oslogstring` 段 | 6f0ed43ffad61402 / 6121 | F-02 F-03 F-09 F-10 F-11 F-13 F-14 F-15 |
| E5 | `raw/otool-ov-arm64e.txt` | `otool -arch arm64e -ov`, 退出码 0 (`logs/otool-ov.exit`) | 1a23607d0a5d8fd9 / 230671 | F-02(补充) |
| E28 | `raw/nm-undefined-arm64e.txt` | `nm -arch arm64e -u`, 140 行, 退出码 0; grep NSStatusItem/NSStatusBar 为 0 | 49ed55b6f90b30f4 / 3191 | F-04 |
| E31 | `derived/methname-keyword-hits.txt` | `__objc_methname` 关键字筛选 72 行 | 51b8cf21e444c8f6 / 2850 | F-08 F-11 |
| E32 | `derived/key-function-pseudocode.txt` | 10 个函数伪代码摘录(每个最多 3500 字符) | f7082bd78e11a427 / 11473 | F-05~F-09 F-12 F-13 |
| E33 | `logs/sdk-stylemask-check.txt` + 对话内 grep 输出 | Xcode SDK `NSWindow.h`: StyleMask 位值(Resizable=1<<3, 第 59 行); CollectionBehavior(Managed=1<<2, 第 133 行)和 `kCGFloatingWindowLevel=3`(CGWindowLevel.h 第 68 行)只出现在对话 grep 输出, 未单独存文件 | 5e7d569061103368 / 见文件 | F-05 F-07 F-08 |

## REA 记录

| E | Evidence ID | 操作 / 参数 | 位置 | 反向引用 |
|---|---|---|---|---|
| E2 | ev_25dfe8b19b291dcfb427f7e66e19aa5c9ab0c6ccc97c7660fcf26b9a31b95489 | `binary_overview` (confidence=derived, provider=rea-workflow) | 36 个段, 1389 个过程, 1567 个字符串 | F-01 |
| E3 | ev_92f062fa015bf822639c8552562c6a2bb58fb48ec940a9a9f78c1c684cf9e97b | `get_objc_classes` pattern="" (derived) | 248 个类标签, 绝大部分为外部 framework; 客户端显示被截断, 完整记录在 bundle | F-01 |
| E6 | ev_f0de1386f4ff537c2504f9f9b3cf2348d45cbf8205dd1623024e3c9e5ea58ff6 | `search_procedures` "SNAppDelegate::" | 19 个过程, 0x100000fb0..; 含 `applicationDockMenu:` 0x100002930 | F-02 F-04 |
| E7 | ev_4d91f0fe6c616b996deae72094246c6f97073144ab1ae4e22f3fd22089930c52 | 同上 "SNMenuController::" | 37 个 | F-02 F-11 F-15 |
| E8 | ev_c988004ba704f8f98cb050749b77c9b170922ad1c9454a41ee4dc83d4ef28674 | 同上 "SNUtility::" | 44 个 | F-02 F-14 |
| E9 | ev_593c1229a4907e813448aacc503d629710d3166d69cf97d217b7bb0aa16892d0 | 同上 "SNFindController::" | 33 个 | F-02 |
| E10 | ev_d01e2080f6326f0f60200921913ca550b5242f063b19ff4a37672d283b8da8ce | 同上 "SNMigrationWindowController::" | 8 个 | F-02 |
| E11 | ev_3ab6ccab60ae12821cf406a29b794aacb615cc1080d151271c0b5186ce47bff7 | 同上 "SNDashboardStickiesImporter::" | 2 个 | F-02 |
| E12 | ev_bab11d91f37b0d0e55f42bb17c041e869923d28514eae19b8b340c3e1b381ba2 | 同上 "SNWindowControlButtonCell::" | 1 个 | F-02 |
| E13 | ev_713897cabd2adffb38ab205e627367bf8a63069798f1fc07dbbc6cb8ab4b9d4b | 同上 "StickiesService::" | 1 个 | F-02 |
| E14 | ev_14206113c44b601ca0a2b48d7fba0a8628513865a0266662aa8e7bb7aa48a0d2 | 同上 "SNDocumentController::" | 3 个 | F-02 |
| E15 | ev_cd1368677c32f0a50fb56aa2a07bb9d28c8b9cdc5d29332e4af3d037868dffdc | 同上 "SNSpineView::" | 1 个 | F-02 |
| E16 | ev_5e9c2602d0cd351e2cfaf67f60d8ddf0f18e212c00a49dfc10a5535044008c83 | 同上 "SNWindow::" | 82 个 | F-02 F-05 F-08 |
| E17 | ev_ab3728b4440e85a3b367622877b6b5aa41ddc9ff8c8afd69d19a4d4fc11fd713 | 同上 "SNDocument" (含 SNDocumentController 前 3 项) | 51 个 | F-02 F-11 F-14 |
| E18 | ev_c3a18f68de9e23c32bc9892ade1491a5fe01296a25184e22d529e5138162f227 | `analyze_function` 0x100000fb0 `applicationDidFinishLaunching:` | value_flow truncated=true, omitted_operations_lower_bound=1 | F-09 |
| E19 | ev_d267c967afe43b7685c961e97831057ca85f789a7c2f49927957dc751e9efdb3 | `analyze_function` 0x10000ffdc `setFloating:` | `setLevel:` 参数 3 或 0 | F-05 |
| E20 | ev_e73d63209df5b6d12d459dfdf3991307b0d385c5f397ced36cc33cb0c42fec9e | `analyze_function` 0x10000fefc `toggleFloatingMenuAction:` | 取反 + `updateChangeCount:` | F-05 |
| E21 | ev_915d01741d5756f206388cbc4fc9fdfd6743e6a7ef8f862356c05121adad826b | `analyze_function` 0x100010010 `setTranslucent:` | `setAlphaValue:` 0.75 / 1.0 | F-06 |
| E22 | ev_e4a6676fc22754b51324184c4818a36c09d868109111007bb4c48c6ef9e87e97 | `analyze_function` 0x10000fca4 `collectionBehavior` | 返回 4 | F-07 |
| E23 | ev_80e1806fd7af31a3328ccf54bc53c8afb8c0611ce904a4e5b4669de86c024faf | `analyze_function` 0x10000662c `writeSavedStickiesStateToPersistentStorage` | `writeToFile:atomically:1` | F-13 |
| E24 | ev_d38affd744d0d5aa77354c2c4ecd3626a95ed378a5451ce04baafd2fa4ac7247 | `analyze_function` 0x10000b02c `SNDocument writeToURL:ofType:error:` | 仅 rtfd 分支写入, 否则 NSCocoaErrorDomain 0x200 | F-13 |
| E25 | ev_077328b47023c39b4905ba130e363acc7916d997af2d4877ecebea772b324fb3 | `analyze_function` 0x10000eb5c `SNWindow collapse:` | 保存/恢复 expandedFrameSize, 切换 styleMask 位 8 | F-08 |
| E26 | ev_d23857b90dfd3d2a4de0cb6be2adae70c5a5b1aee57385370b59863a9e9f03ef | `analyze_function` 0x10000a3cc `makeStickyFromTextService:userData:error:` | 转调 `makeStickiesFromPasteboard:` | F-12 |
| E27 | ev_ead06d5033959d243806120e5e1c0c69b3f1711c429d99c5cb544e88bd24e77f | `analyze_function` 0x10000ffb4 `isMovableByWindowBackground` | 返回 1 | F-07 |
| E29 | ev_9132c304b8582b5971501a088cbc094705f8f8ddd8730ebc7ef3a63fc55f71c1 | `search_procedures` "NSStatus" (literal, 不区分大小写) | 结果为空(负证据) | F-04 |
| E30 | ev_720ad2f870e7d626fda3ca04f240bc4cf3640c7a8bfcc0c65ba2e927827426e8 | `search_strings` "NSStatus" (literal) | 结果为空(负证据; 仅覆盖 Ghidra 已定义字符串) | F-04 |

## 外部参考(只作参考, 不是 REA 证据; 访问日期 2026-10-16)

| E | URL | 用于 |
|---|---|---|
| E34 | https://v2.tauri.app/learn/system-tray/ | tray-icon 特性, TrayIconBuilder, 菜单与托盘事件 API |
| E35 | https://v2.tauri.app/reference/javascript/api/namespacetray ; https://github.com/tauri-apps/tray-icon/issues/104 ; https://docs.rs/tray-icon | Linux 托盘事件不支持、需要 libappindicator/libayatana |
| E36 | https://v2.tauri.app/reference/config | `transparent` 在 macOS 需 `macOSPrivateApi`, 不可上架 App Store |
| E37 | https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html ; https://docs.rs/tauri/latest/x86_64-apple-darwin/tauri/enum.ActivationPolicy.html ; https://docs.rs/tauri/latest/x86_64-apple-darwin/tauri/struct.App.html | tauri 2.12.4 方法清单; ActivationPolicy{Regular,Accessory,Prohibited}; App 页面含 set_activation_policy / set_dock_visibility(仅 macOS 目标构建的文档) |
| E38 | https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html ; https://tauritutorials.com/blog/creating-windows-in-tauri | 运行时创建多窗口、置顶、无边框示例 |
