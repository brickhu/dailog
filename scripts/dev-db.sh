#!/bin/bash
# 确保本地 Postgres（docker dailog-pg）在跑；不存在则创建并跑迁移。
# pnpm dev 前置调用——数据库是 API 的硬依赖，缺它 api 起不来。

set -e

if docker exec dailog-pg pg_isready -U dailogues >/dev/null 2>&1; then
  echo "[db] postgres 已就绪"
  exit 0
fi

# 容器存在但没启动 → 启动
if docker ps -a --format '{{.Names}}' | grep -q '^dailog-pg$'; then
  echo "[db] 启动 postgres 容器…"
  docker start dailog-pg >/dev/null
else
  echo "[db] 创建 postgres 容器…"
  docker run -d --name dailog-pg \
    -e POSTGRES_USER=dailogues -e POSTGRES_PASSWORD=dailogues -e POSTGRES_DB=dailogues \
    -p 5432:5432 postgres:16-alpine >/dev/null
fi

# 等待就绪
for i in $(seq 1 15); do
  if docker exec dailog-pg pg_isready -U dailogues >/dev/null 2>&1; then
    echo "[db] postgres 已就绪"
    break
  fi
  sleep 1
done

# 新容器：跑迁移（幂等——已有表会跳过）
echo "[db] 检查/执行迁移…"
(cd "$(dirname "$0")/../services/api" && pnpm db:migrate 2>&1 | tail -1)
