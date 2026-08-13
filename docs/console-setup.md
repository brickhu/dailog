# 双环境控制台配置清单（本质版，2026-08-13 更新）

仓库：`https://github.com/brickhu/dailog`（`dev` = 开发环境，`master` = 生产环境）

| 环境 | 分支 | API | 消费站 (SSR) | Postgres |
|---|---|---|---|---|
| 开发 | `dev` | `api.candelbot.app` | `candelbot.app` | Railway Development 环境 |
| 生产 | `master` | `api.dailog.fm` | `dailog.fm` | Railway Production 环境 |

> 本质版要点：**服务端无采集/LLM/TTS/ffmpeg**——编辑工作流全部在编辑本地 Agent
> （`tools/dailog-editor` 子工程 → 产物 `.agents/skills/dailog-editor`，密钥在编辑机器 `.dailog-editor/.env`）。
> admin/studio/extension/importer 四个前端与采集服务已删除，无对应部署。

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

> 已移除的服务端变量：`DEEPSEEK_*`、`PEXELS_API_KEY`、`IMPORTER_URL/TOKEN`、`POLISH_MAX_VERSIONS`、`ASSETS_DIR`（LLM/封面/资产编辑本地承载；TTS 已收敛回服务端统一端点，故 FISH_* 保留在服务端）。

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

## 3. DNS（candelbot.app 托管处）

- `api.candelbot.app` → CNAME/ALIAS 到 Railway Dev API
- `candelbot.app` → CF Pages `dailog-site` preview 环境

## 4. 编辑本地 Agent（无需部署）

```bash
cp .dailog-editor/.env.example .dailog-editor/.env            # Fish/Pexels 密钥
cp tools/dailog-editor/templates/envs.example.json .dailog-editor/envs.json  # 环境清单（local/dev/prod）
pnpm editor --env dev login        # 配对码登录（浏览器授权 → 粘贴配对码）
pnpm editor --env dev auth-status  # 会话初始化：/health + 授权检查
pnpm editor --env dev list         # 待审队列
```

## 5. dev 跑通验证链

1. `https://api.candelbot.app/health` → 200；`https://candelbot.app` 打开 → 正常渲染
2. 新对话初始化：`pnpm editor --env dev auth-status` → 端点可用 → 配对 → list 出队列
3. 本地投稿（site `dailog.orb.local` /submit）→ dev 队列可见 → 编辑制作 → 发布 → 站点播放
4. 全部通过后：`dev → master` 合并触发生产部署
