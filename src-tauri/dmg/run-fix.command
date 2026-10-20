#!/bin/bash
# 双击运行：把 fx-stickies 装进 /Applications，并解除 Gatekeeper 的隔离标记。
# 关键在 ditto --noqtn：源文件带着 com.apple.quarantine 时，普通拷贝会一起带过去，
# 目标 app 就仍被判成「已损坏」。--noqtn 让副本干净。
set -euo pipefail
cd "$(dirname "$0")"

APP="fx-stickies.app"
DEST="/Applications/$APP"
STAGE="/Applications/.fx-stickies-staging.app"

trap 'rm -rf "$STAGE"' EXIT

clear
echo "================================================"
echo "  fx-stickies 安装"
echo "================================================"
echo ""

if [ ! -d "$APP" ]; then
  echo "找不到 $APP。"
  echo "请确认本文件与 $APP 在同一个磁盘映像窗口里，不要单独拷走。"
  read -n 1 -s -r -p "按任意键退出 ..."
  exit 1
fi

if [ ! -w /Applications ]; then
  echo "/Applications 不可写，请用管理员账号登录后重试。"
  read -n 1 -s -r -p "按任意键退出 ..."
  exit 1
fi

echo "[1/4] 关闭正在运行的旧版本"
osascript -e 'quit app "fx-stickies"' >/dev/null 2>&1 || true
for _ in 1 2 3 4 5; do
  pgrep -x fx-stickies >/dev/null 2>&1 || break
  sleep 1
done

echo "[2/4] 复制到暂存位置"
rm -rf "$STAGE"
ditto --noqtn "$APP" "$STAGE"

echo "[3/4] 解除隔离标记"
xattr -dr com.apple.quarantine "$STAGE" 2>/dev/null || true

# 拷贝成功后才替换旧版本：中途失败不会让用户既没新版也没旧版
rm -rf "$DEST"
mv "$STAGE" "$DEST"

echo "[4/4] 校验"
if codesign --verify --deep --strict "$DEST" >/dev/null 2>&1; then
  echo "      签名校验通过"
else
  echo "      签名校验未通过（隔离标记已解除，通常不影响使用）"
fi

echo ""
echo "安装完成，正在启动 ..."
open "$DEST"
sleep 2
