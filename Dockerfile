# 本地调试镜像（OrbStack/docker compose 全家桶共用）
# 生产部署不走此镜像（Railway/CF Pages 各自构建）
FROM node:22-alpine

RUN corepack enable

WORKDIR /app

# 依赖装进镜像（compose 挂载源码时用匿名卷保护 /app/node_modules）
COPY . .
RUN pnpm install --frozen-lockfile
