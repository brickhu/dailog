#!/bin/bash
# 本地域名绑定（SSO 完整链路验证：site ↔ studio 跨子域免登录）
# 原理：hosts 把 dailog.fm 系列指到 127.0.0.1 + mkcert 本地 CA 签 HTTPS 证书
#       + Caddy 反代到本地各服务端口。
# 用法：
#   ./scripts/setup-local-domains.sh install   # 首次安装（mkcert + hosts + Caddyfile）
#   ./scripts/setup-local-domains.sh start     # 启动 Caddy
#   ./scripts/setup-local-domains.sh stop      # 停止 Caddy
#   ./scripts/setup-local-domains.sh status    # 查看状态

set -euo pipefail

HOSTS_LINE="127.0.0.1 dailog.fm app.dailog.fm api.dailog.fm"
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

setup_hosts() {
  if grep -q "dailog.fm" /etc/hosts; then
    echo "[setup] hosts 已配置"
  else
    echo "[setup] 修改 /etc/hosts（需要 sudo，输入密码）："
    sudo sh -c "echo '$HOSTS_LINE' >> /etc/hosts"
    echo "[setup] hosts 已添加：$HOSTS_LINE"
  fi
}

setup_certs() {
  local CERT_DIR="$HOME/.dailog-local"
  mkdir -p "$CERT_DIR"
  if [ -f "$CERT_DIR/dailog.pem" ]; then
    echo "[setup] 证书已存在"
  else
    echo "[setup] 安装本地 CA + 签发证书…"
    mkcert -install >/dev/null 2>&1 || true
    (cd "$CERT_DIR" && mkcert -cert-file dailog.pem -key-file dailog-key.pem "dailog.fm" "*.dailog.fm" >/dev/null 2>&1)
    echo "[setup] 证书已签发：$CERT_DIR/dailog.pem"
  fi
}

write_caddyfile() {
  cat > "$CADDYFILE" <<EOF
# 本地开发反代：dailog.fm 系列 → 本地端口
# 启动：caddy run --config $CADDYFILE
dailog.fm {
    tls internal
    reverse_proxy localhost:3000
}
app.dailog.fm {
    tls internal
    reverse_proxy localhost:5173
}
api.dailog.fm {
    tls internal
    reverse_proxy localhost:8787
}
EOF
  echo "[setup] Caddyfile 已写入：$CADDYFILE"
}

print_env() {
  echo ""
  echo "=============================================="
  echo " 本地域名就绪！接下来："
  echo ""
  echo " 1. 启动 Caddy:      ./scripts/setup-local-domains.sh start"
  echo " 2. 本地 .env.local 配置（SSO 关键）："
  echo "    services/api/.env.local:"
  echo "      BETTER_AUTH_URL=https://api.dailog.fm"
  echo "      BETTER_AUTH_COOKIE_DOMAIN=.dailog.fm"
  echo "    apps/studio/.env.local:"
  echo "      VITE_API_BASE_URL=https://api.dailog.fm"
  echo " 3. 访问："
  echo "    https://dailog.fm      → 内容站（site，端口 3000）"
  echo "    https://app.dailog.fm  → 工作台（studio，端口 5173）"
  echo ""
  echo " 验证 SSO：app.dailog.fm 登录 → 打开 dailog.fm 应已登录"
  echo "=============================================="
}

case "${1:-}" in
  install)
    install_tools
    setup_hosts
    setup_certs
    write_caddyfile
    print_env
    ;;
  start)
    caddy start --config "$CADDYFILE" 2>/dev/null || echo "[caddy] 已在运行"
    echo "[caddy] 已启动（https://app.dailog.fm → studio）"
    ;;
  stop)
    caddy stop 2>/dev/null || true
    echo "[caddy] 已停止"
    ;;
  status)
    curl -sk -o /dev/null -w "app.dailog.fm: %{http_code}\n" https://app.dailog.fm 2>/dev/null || echo "app.dailog.fm: 未启动"
    ;;
  *)
    echo "用法: $0 {install|start|stop|status}"
    ;;
esac
