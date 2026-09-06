# 双环境控制台配置清单（本质版 2026-08-13；采编 lab 化 2026-09-05）

仓库：`https://github.com/brickhu/dailog`（`dev` = 开发环境，`master` = 生产环境）

| 环境 | 分支 | API | 消费站 (SSR) | Postgres |
|---|---|---|---|---|
| 开发 | `dev` | `api.candelbot.app` | `candelbot.app` | Railway Development 环境 |
| 生产 | `master` | `api.dailog.fm` | `dailog.fm` | Railway Production 环境 |

> 本质版要点：**服务端（api）无采集/LLM/ffmpeg**——编辑工作流在 **dailog lab**（`tools/script-lab`：浏览器采编控制台 +
> 轻服务端，本地运行；LLM/Fish 密钥在 `tools/script-lab/.env`）。dailog-editor 本地 Agent 管线已下线（2026-09-05）。
> admin/studio/extension/importer 四个前端与采集服务已删除，无对应部署；`/v1/editor/tts` 保留为兼容端点（FISH_* 保留在服务端）。

## 1. Railway（API + Postgres）

1. [x] 新建项目 → **Connect GitHub repo**：`brickhu/dailog`
2. [x] 分支部署按服务配置：Production 环境各 service Source branch = `master`；Development 环境 = `dev`
3. [x] Production 环境：`Add Database → PostgreSQL` + 部署 API service（自动识别根 `railway.json`，healthcheck `/health`）
4. [x] Development 环境：同样有 Postgres + API service；两个环境 Postgres 独立
5. [x] 域名：Production API 绑 `api.dailog.fm`；Development API 绑 `api.candelbot.app`
6. [x] 各环境 Variable（按环境分别设置）：

| 变量 | 开发环境 | 生产环境 |
|---|---|---|
| `DATABASE_URL` | 本环境 Postgres | 本环境 Postgres |
| `APP_ORIGINS` | `https://candelbot.app`（站点域名；新增域名需补） | `https://dailog.fm` |
| `ADMIN_EMAILS` | 逗号分隔邮箱——**部署自动预留管理员**（api 启动时提升、注册即时提升） | 同左（生产填你的邮箱） |
| `STORAGE_DRIVER` | `fs`（或 r2） | `r2` + `R2_ACCOUNT_ID/ACCESS_KEY/SECRET_KEY/BUCKET` |
| `BETTER_AUTH_SECRET` | 已启用（各环境独立随机） | 同左 |
| `BETTER_AUTH_URL` | `https://api.candelbot.app` | `https://api.dailog.fm` |
| `BETTER_AUTH_COOKIE_DOMAIN` | `.candelbot.app` | `.dailog.fm`（SSO 跨子域 cookie） |
| `FISH_API_KEY` / `FISH_PROXY_URL` | ✓（统一 TTS 端点合成语音；本地容器经 socks 代理出网） | ✓ |
| `PORT` | 不配（Railway 默认；healthcheck 自动探测） | 同左 |

> 已移除的服务端变量：`DEEPSEEK_*`、`PEXELS_API_KEY`、`IMPORTER_URL/TOKEN`、`POLISH_MAX_VERSIONS`、`ASSETS_DIR`（LLM/封面/资产由 dailog lab 承载；TTS 兼容端点保留，故 FISH_* 仍在服务端）。

7. [x] 迁移**随部署自动执行**（Dockerfile CMD = `pnpm db:migrate && pnpm start`；drizzle 幂等）。手动兜底：
   `pnpm --filter @dailogues/api db:migrate`（Service → Exec 或本地 `railway run`）
8. [ ] 编辑角色：注册开放 + 邮箱验证即获投稿资格；编辑账号 = `ADMIN_EMAILS` 自动提升（无需手动 SQL）
9. [ ] **验证链**：`https://api.candelbot.app/health` → 200；`https://api.dailog.fm/health` → 200

## 2. Cloudflare Pages（消费站 SSR）——单项目双分支

| 项目 `dailog-site` | production 环境 | preview 环境 |
|---|---|---|
| 分支 | `master` | `dev`（**勾选 "Builds for non-production branches"**） |
| 构建命令 | `pnpm --filter @dailogues/site build` | 同左 |
| 输出目录 | `apps/site/dist` | 同左 |
| Node 版本 | 22 | 22 |
| **Node.js compatibility** | **开启（Node 22）**——postgres 直连需要 | 同左 |
| 自定义域名 | `dailog.fm` | `candelbot.app` |
| 变量 | `DATABASE_URL`=生产 Postgres、`VITE_API_BASE_URL`=`https://api.dailog.fm`、`VITE_SITE_BASE_URL`=`https://dailog.fm` | `DATABASE_URL`=dev Postgres、`VITE_API_BASE_URL`=`https://api.candelbot.app`、`VITE_SITE_BASE_URL`=`https://candelbot.app` |

> 变量（各环境）：`DATABASE_URL`（对应环境 Postgres，只读连接可加 `?sslmode=require`）、
> `VITE_API_BASE_URL`（`https://api.candelbot.app` / `https://api.dailog.fm`）、
> `VITE_SITE_BASE_URL`（站点自身，**登录代理以它作为 Origin 转发给 API**）。
> ⚠️ **站点实际域名必须加入 API 的 `APP_ORIGINS`**（auth-proxy 转发时以 `SITE_BASE_URL` 为 Origin，
> better-auth CSRF 白名单校验）——preview 分支用 Pages 默认域名时也要加。
>
> ⚠️ **Not found handling 必须设为 `404-page`**（项目 Settings → Builds & deployments →
> Not found handling）。默认 single-page-application 会对缺失的 /_build/assets/*.js 返回
> 200+text/html（SPA fallback 顶替首页 HTML，且 immutable 缓存一年）——浏览器把 HTML 当 JS
> 解析报 MIME 错误，hydration 不执行 → 页面卡死（iOS 登录跳回首页复现，见 developer-guide §11）。
> 改 404-page 后缺失资源返回真 404，不再顶替。

## 3. DNS（candelbot.app 托管处）

- `api.candelbot.app` → CNAME/ALIAS 到 Railway Dev API
- `candelbot.app` → CF Pages `dailog-site` preview 环境

## 4. dailog lab 采编控制台（无需部署，本地运行）

```bash
cd tools/script-lab
cp .env.example .env               # LLM/Fish 密钥（gitignored）
pnpm lab:dev                       # 启动 lab（127.0.0.1:4173，--env dev）
# 浏览器打开 http://127.0.0.1:4173 → 登录选环境（dev/prod）→ 采编控制台
```

lab 经服务端 `/v1/editor/*` 与 `/v1/editor/storage` 操作数据与 R2；产物 R2 权威 + 浏览器缓存。

## 5. dev 跑通验证链

1. `https://api.candelbot.app/health` → 200；`https://candelbot.app` 打开 → 正常渲染
2. 采编初始化：`cd tools/script-lab && pnpm lab:dev` → 登录选 dev 环境 → 队列出投稿
3. 本地投稿（site `dailog.orb.local` /submit）→ dev 队列可见 → 编辑制作 → 发布 → 站点播放
4. 全部通过后：`dev → master` 合并触发生产部署
