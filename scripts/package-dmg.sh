#!/bin/bash
# 把 run-fix.command 塞进 Tauri 生成的 DMG。
# Tauri 2 的 bundle.macOS.dmg 只支持布局参数，没有「附加文件」配置，所以后处理。
# 用法: scripts/package-dmg.sh [dmg 路径]
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
# Tauri 用 aarch64 / x64 命名，uname -m 给的是 arm64 / x86_64
case "$(uname -m)" in
  arm64) ARCH=aarch64 ;;
  x86_64) ARCH=x64 ;;
  *) ARCH=$(uname -m) ;;
esac
DMG="${1:-src-tauri/target/release/bundle/dmg/fx-stickies_${VERSION}_${ARCH}.dmg}"

[ -f "$DMG" ] || { echo "找不到 DMG: $DMG"; exit 1; }

MNT=/tmp/fx-dmg-mnt
RW=/tmp/fx-dmg-rw
OUT=/tmp/fx-dmg-out
rm -rf "$MNT" "$RW.dmg" "$OUT.dmg"
mkdir -p "$MNT"

echo "==> 解包 $DMG"
hdiutil convert "$DMG" -format UDRW -o "$RW" >/dev/null
hdiutil attach -readwrite -noverify -noautoopen "$RW.dmg" -mountpoint "$MNT" >/dev/null

echo "==> 写入安装脚本"
cp src-tauri/dmg/run-fix.command "$MNT/"
chmod +x "$MNT/run-fix.command"
sync

echo "==> 重新压缩"
# detach 偶尔报 resource busy，退一步再强退
hdiutil detach "$MNT" >/dev/null 2>&1 || { sleep 2; hdiutil detach "$MNT" -force >/dev/null; }
hdiutil convert "$RW.dmg" -format UDZO -o "$OUT" >/dev/null

# 转换成功后才替换原文件，失败时构建产物还在
mv "$OUT.dmg" "$DMG"

rm -rf "$MNT" "$RW.dmg"
echo "完成: $DMG"
