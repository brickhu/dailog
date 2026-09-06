# dailog lab —— 编辑器工作台（同源 UI + 编排），无状态容器
# 运行：docker compose up；远程部署：同一镜像推到任意支持 docker 的主机
# 密钥不烧进镜像：全部经环境变量（见 docker-compose.yml / README）
FROM node:22-slim

# ffmpeg：服务端采样转 wav / 合成兜底（浏览器 ffmpeg.wasm 为主路径，此兜底保留）
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# 独立运行时依赖（cheerio）：不走 pnpm workspace，避免冻结 lockfile 约束
RUN echo '{"name":"dailog-lab-runtime","private":true,"type":"module","dependencies":{"cheerio":"^1.2.0"}}' > package.json \
    && npm install --omit=dev

COPY . .

# 容器内运行时不再需要 workspace package.json（保留 node_modules 中已装的 cheerio）
RUN rm -f package.json package-lock.json \
    && echo '{"name":"dailog-lab-runtime","private":true,"type":"module"}' > package.json

ENV LAB_STATE_DIR=/data
EXPOSE 4173
CMD ["node", "server.mjs"]