# @dailogues/share-collect

分享页采集独立服务：粘贴链接 → 全量对话（六大平台，API 优先 + DOM 兜底）。

## 接口

```
POST /collect   body: { "url": "https://claude.ai/share/xxx" }
GET  /health
```

成功 → `{ platform, conversationId, title, url, messages: [{role, content}] }`
失败 → `{ error: "platform_unreachable" | "parse_failed" | "invalid_url" | "unsupported_platform", detail: { status?, cf?, message? } }`

## 支持的平台与通道

| 平台 | 主通道 | 兜底 |
|---|---|---|
| claude | `chat_snapshots` API（改版后免 orgId）| 代理池换通道重试（客户端渲染无 DOM）|
| deepseek | `share/content` API | 页面 HTML |
| chatgpt | RSC payload 解码（全量）| 静态 HTML `data-message-author-role` |
| doubao | SSR `data-fn-args` 快照 | （HTML 即数据源）|
| gemini | `batchexecute` RPC（undici，免 curl）| 代理池重试（客户端渲染无 DOM）|
| kimi | SSR `HYDRATION_INIT_STATE` | （HTML 即数据源）|

## 环境变量

| 变量 | 说明 |
|---|---|
| `PORT` | 监听端口（默认 8787；Railway 自动注入）|
| `SOCKS_PROXY` | 可选。逗号分隔多代理 `socks5://a:1080,socks5://b:1080`。配了默认走第一个代理（本机调试/CF 拦截时），claude/gemini 被 CF 拦自动换通道重试；不配则全直连|
| `CF_WORKER_URL` | 可选。Cloudflare Worker 转发（见 worker-proxy.js），形如 `https://<worker>.workers.dev/?token=<TOKEN>`。claude 被 CF 拦时自动走 Worker 转发（出口=CF 网络通常放行）|

## Railway 部署

1. New Project → Deploy from GitHub repo → 选本服务目录（`services/share-collect`）——Nixpacks 自动识别 `start` 脚本
2. 无需额外配置；claude 被 CF 拦时加 `SOCKS_PROXY` 环境变量
3. 部署后先测 claude 成功率（采样 100 次）：直连过 CF 就保持直连，不过就配代理

## 开发

```bash
pnpm --filter @dailogues/share-collect dev
pnpm --filter @dailogues/share-collect test   # 解析器单测（10 个）
pnpm --filter @dailogues/share-collect typecheck
```

平台规则变化：只改 `src/platforms/<平台>.ts` 重新部署即可，不影响 API/Studio。
