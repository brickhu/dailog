#!/bin/bash
# orb 调试全家桶：docker compose 起全部服务（postgres/api/site/admin/importer）
# 访问：https://app.orb.local / https://site.orb.local / https://api.orb.local（OrbStack 自动 TLS）
# 首次启动会构建镜像（pnpm install 全量依赖，约几分钟）。
# 迁移由 api 容器启动时自动执行（幂等）；停止：docker compose down（数据保留在 pgdata 卷）

set -euo pipefail
cd "$(dirname "$0")/.."

# 系统 SOCKS 代理会把 orb.local 请求丢给代理（无法路由容器内网）——确保 *.orb.local 在代理例外
if scutil --proxy 2>/dev/null | grep -q "SOCKSEnable : 1"; then
  if ! networksetup -getproxybypassdomains "Wi-Fi" 2>/dev/null | grep -q "orb.local"; then
    echo "[orb] 检测到系统代理，正在把 *.orb.local 加入代理例外…"
    networksetup -setproxybypassdomains "Wi-Fi" "*.sslip.io" "*.orb.local" "localhost" "127.0.0.1"
  fi
fi

docker compose up -d --build

echo ""
echo "✅ orb 全家桶已启动："
echo "   site     https://dailog.orb.local"
echo "   admin    https://admin.dailog.orb.local"
echo "   api      https://api.dailog.orb.local/health"
echo "   importer https://importer.dailog.orb.local"
echo "   日志      docker compose logs -f"
echo "   停止      docker compose down"
echo "   提示      录音/麦克风需安全上下文："
echo "            · 推荐 http://localhost:3000（localhost 天然安全上下文，登录+录音全可用）"
echo "            · 或 https://dailog.orb.local（首次需绕过 OrbStack 自签证书警告）"
echo "            · http://dailog.orb.local 仅浏览/登录，录音不可用"
