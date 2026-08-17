FROM node:22-slim

RUN npm install -g pnpm@9

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# pnpm 的 patchedDependencies 在 install 时对所有 patch 文件做 hash——缺文件直接 ENOENT
# （api 依赖树用不到 vinxi patch，但文件必须存在；--filter 不会应用它）
COPY patches ./patches
COPY services/api/package.json ./services/api/package.json
RUN pnpm install --filter @dailogues/api --frozen-lockfile

COPY services/api ./services/api
WORKDIR /app/services/api

EXPOSE 8787
# 启动前自动跑迁移（drizzle 幂等：已应用的跳过）；失败则不启动，日志可查
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
