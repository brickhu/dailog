#!/bin/bash
# 本地开发服务状态查看 + 重启
# 用法：
#   ./scripts/dev-status.sh          查看三端 + 数据库状态
#   ./scripts/dev-status.sh restart  全部杀掉 → 提示重新 pnpm dev

check() {
  local name="$1" port="$2" health="$3"
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    local alive="✅ 运行中"
    if [ -n "$health" ]; then
      if curl -s -m 3 "$health" >/dev/null 2>&1; then alive="✅ 运行中 (health OK)"; else alive="⚠️ 端口占用但 health 异常"; fi
    fi
    echo "$name (:${port}) $alive"
  else
    echo "$name (:${port}) ❌ 未运行"
  fi
}

if [ "${1:-}" = "restart" ]; then
  echo "停止所有本地开发服务…"
  lsof -ti:8787 2>/dev/null | xargs kill -9 2>/dev/null
  lsof -ti:8798 2>/dev/null | xargs kill -9 2>/dev/null
  lsof -ti:5173 2>/dev/null | xargs kill -9 2>/dev/null
  sleep 1
  echo "已停止。重新启动：pnpm dev"
  exit 0
fi

echo "=== 本地开发服务状态 ==="
check "API"        8787 "http://localhost:8787/health"
check "Importer"   8798 "http://localhost:8798/health"
check "Studio"     5173 ""
echo "=== 数据库 ==="
if docker exec dailog-pg pg_isready -U dailogues >/dev/null 2>&1; then
  echo "Postgres (dailog-pg) ✅ 运行中"
else
  echo "Postgres (dailog-pg) ❌ 未运行（pnpm dev 会自动拉起）"
fi
echo ""
echo "提示：正常开发请用 pnpm dev（前台 + watch）；上面脚本只用于排查/应急"
