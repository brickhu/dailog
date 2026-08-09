#!/bin/bash
# 腾讯云香港轻量（Ubuntu 22.04）：安装并配置 dante socks5 代理
# 用法: sudo bash setup-dante.sh <用户名> <密码> [端口]
# 示例: sudo bash setup-dante.sh dailog 'S3cretPass!' 1080
set -euo pipefail

USERNAME="${1:?用法: sudo bash setup-dante.sh <用户名> <密码> [端口]}"
PASSWORD="${2:?缺少密码}"
PORT="${3:-1080}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y dante-server

# 代理认证用户（nologin，仅用于 socks 认证，不能登录系统）
id "$USERNAME" &>/dev/null || useradd -r -s /usr/sbin/nologin "$USERNAME"
echo "$USERNAME:$PASSWORD" | chpasswd

# 默认出口网卡（腾讯云轻量通常是 eth0，自动探测更稳）
EXT_IF=$(ip route | awk '/^default/ {print $5; exit}')
[ -n "$EXT_IF" ] || EXT_IF=eth0

cat > /etc/danted.conf <<EOF
logoutput: syslog
user.privileged: root
user.unprivileged: nobody

internal: 0.0.0.0 port = $PORT
external: $EXT_IF

method: username
user.libwrap: never

client pass {
    from: 0.0.0.0/0 to: 0.0.0.0/0
    method: username
}

socks pass {
    from: 0.0.0.0/0 to: 0.0.0.0/0
    method: username
}
EOF

systemctl enable danted
systemctl restart danted

echo ""
echo "=============================================="
echo " dante socks5 已启动:"
echo "   socks5://$USERNAME:$PASSWORD@<服务器公网IP>:$PORT"
echo ""
echo " 别忘了：腾讯云轻量控制台 → 防火墙 → 添加规则"
echo "   协议 TCP，端口 $PORT，来源 0.0.0.0/0"
echo "=============================================="
