#!/bin/bash
# 本地域名绑定（SSO 完整链路验证）——sslip.io 方案：
# *.127.0.0.1.sslip.io 公网通配 DNS 自动解析到 127.0.0.1（无需 hosts，
# 浏览器全兼容——.local 会被 Chrome 当 mDNS 绕过 hosts）。
# mkcert 本地 CA 签 HTTPS 证书 + Caddy 反代到本地端口。
# PSL 中 127.0.0.1.sslip.io 是可注册域 → Domain=.127.0.0.1.sslip.io
# cookie 合法（localhost 本身是 PSL 条目，拒绝设 cookie）。
#
# 用法：
#   ./scripts/setup-local-domains.sh install   # 首次安装（mkcert + Caddyfile）
#   ./scripts/setup-local-domains.sh start     # 启动 Caddy
#   ./scripts/setup-local-domains.sh stop      # 停止 Caddy
#   ./scripts/setup-local-domains.sh status    # 查看状态

set -euo pipefail

BASE="127.0.0.1.sslip.io"
CERT_DIR="$HOME/.dailog-local"
CADDYFILE="$HOME/dailog-local-Caddyfile"

install_tools() {
  if ! command -v mkcert >/dev/null; then
    echo "[setup] 安装 mkcert…"
    brew install mkcert >/dev/null
  fi
  if ! command -v caddy >/dev/null; then
    echo "[setup] 安装 caddy…"
    brew install caddy >/dev/null
  fi
}

setup_certs() {
  mkdir -p "$CERT_DIR"
  if [ -f "$CERT_DIR/dailog.pem" ]; then
    echo "[setup] 证书已存在"
  else
    echo "[setup] 安装本地 CA + 签发证书…"
    mkcert -install >/dev/null 2>&1 || true
    (cd "$CERT_DIR" && mkcert -cert-file dailog.pem -key-file dailog-key.pem "*.${BASE}" "${BASE}" >/dev/null 2>&1)
    echo "[setup] 证书已签发：$CERT_DIR/dailog.pem（*.${BASE}）"
  fi
}

write_caddyfile() {
  cat > "$CADDYFILE" <<EOF
# 本地开发反代：*.127.0.0.1.sslip.io → 本地端口
# 启动：caddy run --config $CADDYFILE
{
    local_certs
}

app.${BASE} {
    tls $CERT_DIR/dailog.pem $CERT_DIR/dailog-key.pem
    reverse_proxy localhost:5173
}
api.${BASE} {
    tls $CERT_DIR/dailog.pem $CERT_DIR/dailog-key.pem
    reverse_proxy localhost:8787
}
site.${BASE} {
    tls $CERT_DIR/dailog.pem $CERT_DIR/dailog-key.pem
    reverse_proxy localhost:3000
}
EOF
  echo "[setup] Caddyfile 已写入：$CADDYFILE"
}

print_env() {
  echo ""
  echo "=============================================="
  echo " 本地域名就绪！接下来："
  echo ""
  echo " 1. 启动 Caddy:  ./scripts/setup-local-domains.sh start"
  echo " 2. 更新 .env.local："
  echo "    services/api/.env.local:"
  echo "      BETTER_AUTH_URL=https://api.${BASE}"
  echo "      BETTER_AUTH_COOKIE_DOMAIN=.${BASE}"
  echo "      APP_ORIGINS=https://admin.${BASE}"
  echo "    apps/admin/.env.local:"
  echo "      VITE_API_BASE_URL=https://api.${BASE}"
  echo "    apps/site/.env.local:"
  echo "      API_BASE_URL=https://api.${BASE}"
  echo "      SITE_BASE_URL=https://site.${BASE}"
  echo " 3. 访问："
  echo "    https://admin.${BASE}   → 工作台（admin，端口 5174）"
  echo "    https://site.${BASE}   → 内容站（site，端口 3000）"
  echo ""
  echo " 验证 SSO：admin 登录 → 打开 site 应已登录"
  echo "=============================================="
}

# 系统开了 SOCKS 代理时（本机 1081 常见）：浏览器访问 sslip 域名会走代理
# → 代理解析到 127.0.0.1（代理自己）连接死循环。需把 *.sslip.io 加入忽略代理：
#   networksetup -setproxybypassdomains Wi-Fi "*.sslip.io" "localhost" "127.0.0.1"
setup_proxy_bypass() {
  if scutil --proxy | grep -q "SOCKSEnable : 1"; then
    if ! networksetup -getproxybypassdomains Wi-Fi 2>/dev/null | grep -q "sslip.io"; then
      echo "[setup] 检测到系统 SOCKS 代理——设置 *.sslip.io 忽略代理（否则浏览器连不上）"
      networksetup -setproxybypassdomains Wi-Fi "*.sslip.io" "localhost" "127.0.0.1"
    fi
  fi
}

case "${1:-}" in
  install)
    install_tools
    setup_proxy_bypass
    setup_certs
    write_caddyfile
    print_env
    ;;
  start)
    caddy start --config "$CADDYFILE" --adapter caddyfile 2>/dev/null || echo "[caddy] 已在运行"
    echo "[caddy] 已启动"
    ;;
  stop)
    caddy stop 2>/dev/null || true
    echo "[caddy] 已停止"
    ;;
  status)
    curl -sk -o /dev/null -w "app: %{http_code}\n" "https://app.${BASE}" 2>/dev/null || echo "app: 未启动"
    ;;
  *)
    echo "用法: $0 {install|start|stop|status}"
    ;;
esac
