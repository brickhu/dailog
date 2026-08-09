#!/bin/bash
# 本地开发查验证码（dev 环境不发邮件，验证码存在数据库 verification 表）
# 用法：
#   ./scripts/otp.sh               # 最新一条验证码（自动复制剪贴板）
#   ./scripts/otp.sh <邮箱前缀>      # 按邮箱过滤
#   ./scripts/otp.sh --watch        # 持续监听（每 2 秒刷新最新验证码）
#
# 依赖：本地 docker postgres 容器 dailog-pg（pnpm dev 前先启动）

set -euo pipefail

FILTER="${1:-}"
WATCH=0
if [ "$FILTER" = "--watch" ]; then
  WATCH=1
  FILTER=""
fi

QUERY_WHERE=""
if [ -n "$FILTER" ]; then
  QUERY_WHERE="WHERE identifier LIKE '%${FILTER}%'"
fi

fetch_code() {
  docker exec dailog-pg psql -U dailogues -d dailogues -t -A -F '|' -c \
    "SELECT value, identifier, expires_at FROM verification ${QUERY_WHERE} ORDER BY created_at DESC LIMIT 1" 2>/dev/null || true
}

if [ "$WATCH" = "1" ]; then
  echo "监听中（Ctrl+C 退出）——提交注册后验证码出现即自动复制…"
  LAST=""
  while true; do
    ROW=$(fetch_code)
    if [ -n "$ROW" ] && [ "$ROW" != "$LAST" ]; then
      LAST="$ROW"
      CODE=$(echo "$ROW" | cut -d'|' -f1)
      EMAIL=$(echo "$ROW" | cut -d'|' -f2 | sed 's/^otp://')
      EXPIRES=$(echo "$ROW" | cut -d'|' -f3)
      echo ""
      echo "📧 $EMAIL"
      echo "🔑 $CODE"
      echo "⏰ 过期时间: $EXPIRES"
      echo -n "$CODE" | pbcopy && echo "✅ 已复制到剪贴板"
    fi
    sleep 2
  done
fi

ROW=$(fetch_code)
if [ -z "$ROW" ]; then
  echo "❌ 没有找到验证码——先去登录页提交注册（新邮箱）"
  exit 1
fi
CODE=$(echo "$ROW" | cut -d'|' -f1)
EMAIL=$(echo "$ROW" | cut -d'|' -f2 | sed 's/^otp://')
EXPIRES=$(echo "$ROW" | cut -d'|' -f3)

echo "📧 $EMAIL"
echo "🔑 $CODE"
echo "⏰ 过期时间: $EXPIRES"
echo -n "$CODE" | pbcopy && echo "✅ 已复制到剪贴板，直接粘贴到页面验证码输入框"
