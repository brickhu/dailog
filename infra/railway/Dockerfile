FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/api/package.json ./services/api/package.json
RUN pnpm install --filter @dailogues/api --frozen-lockfile

COPY services/api ./services/api
WORKDIR /app/services/api

EXPOSE 8787
# 启动前自动跑迁移（drizzle 幂等：已应用的跳过）；失败则不启动，日志可查
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
