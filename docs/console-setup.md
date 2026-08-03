# 双环境控制台配置清单（2026-08-03）

仓库：`https://github.com/brickhu/dailog`（`dev` = 开发环境，`master` = 生产环境）

| 环境 | 分支 | API | Studio (SPA) | 消费站 (SSR) | Postgres |
|---|---|---|---|---|---|
| 开发 | `dev` | `api.candelbot.app`（同站必须——默认 URL 跨站，凭据请求在浏览器挂起/SSO 失效） | `app.candelbot.app` | `candelbot.app` | Railway Development 环境 |
| 生产 | `master` | `api.dailogues.com` | `app.dailogues.com` | `dailogues.com` | Railway Production 环境 |

## 1. Railway（API + Postgres）

1. [ ] 新建项目 → **Connect GitHub repo**：`brickhu/dailog`
2. [ ] 分支部署是**按服务**配置的（项目级 "Production Branch" 设置已取消）：
   - 默认即 `production` 环境：各 service → Settings → **Source → Branch connected to = `master`**
   - Development 环境：顶部环境下拉 → **+ New Environment**（选 **Duplicate** 可复制生产环境的 services/变量；或 Empty 后手动加）→ 该环境各 service 的 Source branch 选 `dev`
   - 此后 `master` push 自动部署 Production、`dev` push 自动部署 Development
3. [ ] Production 环境：`Add Database → PostgreSQL` + 部署 API service（自动识别根 `railway.json`：Docker 镜像含 ffmpeg，healthcheck `/health`）
4. [ ] Development 环境（Duplicate 出来的）：确认同样有 Postgres + API service；两个环境的 Postgres 是独立的
5. [ ] 域名：Production API 服务 → Settings → Domains 绑 `api.dailogues.com`；Development API **不绑自定义域名**（直接用 Railway 默认 URL）
6. [ ] 各环境 Variable（按环境分别设置）：

| 变量 | 开发环境 | 生产环境 |
|---|---|---|
| `DATABASE_URL` | 本环境 Postgres | 本环境 Postgres |
| `APP_ORIGINS` | `https://app.candelbot.app,https://candelbot.app,https://dailog.pages.dev,http://localhost:5173,http://localhost:3000`（每次新增前端域名都要补） | `https://app.dailogues.com,https://dailogues.com` |
| `DEEPSEEK_API_KEY` / `BASE_URL` / `MODEL` | ✓ | ✓ |
| `FISH_API_KEY` / `FISH_PROXY_URL` / `FISH_GUEST_REFERENCE_ID` | ✓ | ✓ |
| `STORAGE_DRIVER` | `fs`（或 r2） | `r2` + `R2_ACCOUNT_ID/ACCESS_KEY/SECRET_KEY/BUCKET` |
| `BETTER_AUTH_SECRET` | 已启用（各环境独立随机） | 同左 |
| `BETTER_AUTH_URL` | `https://api.candelbot.app`（dev） | `https://api.dailogues.com`（生产必改） |
| `BETTER_AUTH_COOKIE_DOMAIN` | 留空（host-only） | `.dailogues.com`（SSO 跨子域 cookie） |
| `PORT` | 不配（Railway 默认 8080；内部端口与公网域名无关，healthcheck 自动探测） | 同左 |

7. [x] 迁移**随部署自动执行**（Dockerfile CMD = `pnpm db:migrate && pnpm start`；drizzle 幂等，已应用自动跳过）。手动兜底：
   `pnpm --filter @dailogues/api db:migrate`（Service → Exec 或本地 `railway run`）
8. [ ] 生成首批邀请码（注册门禁；admin user 自动创建）：
   `pnpm --filter @dailogues/api invites:create <code> [--expires <days>]`

## 2. Cloudflare Pages（SPA）——单项目双分支

**模型**：每个应用只建 **1 个 Pages 项目**，production/preview 两个环境承载 master/dev 两个分支（Pages 只有这两个环境，变量按环境分设；我们唯一的非生产分支是 dev，所以 preview 变量 = dev 值正好）。

| 项目 `dailogues-studio` | production 环境 | preview 环境 |
|---|---|---|
| 分支 | `master` | `dev`（**需勾选 "Builds for non-production branches"**） |
| 构建命令 | `pnpm --filter @dailogues/studio build` | 同左 |
| 输出目录 | `apps/site/dist` → `apps/studio/dist` | 同左 |
| Node 版本 | 22 | 22 |
| `VITE_API_BASE_URL` | `https://api.dailogues.com` | `https://api.candelbot.app` |
| 自定义域名 | `app.dailogues.com`（待定） | `app.candelbot.app`（绑 dev 分支；要求域名在 CF DNS，否则用 branch alias `dev.dailogues-studio.pages.dev`） |
| 入口（2026 统一界面） | Workers & Pages → Create application → **Pages** → Connect to Git（勿走 Workers Import a repository，其产物形态为 Workers Assets，无 output directory） | 同左 |

> ⚠️ 现网项目（studio 已建，production branch 当前是 `dev`）：**上线前把 production branch 切成 `master`**（切后 dev 分支自动转为 preview 部署，域名/变量按上表迁移）。
> `VITE_EXTENSION_ID` 可留空（扩展连接卡隐藏）；M5 后 `VITE_SUPABASE_*` 移除。

## 2.5 Cloudflare Pages（消费站 SSR）——单项目双分支

| 项目 `dailogues-site` | production 环境 | preview 环境 |
|---|---|---|
| 分支 | `master` | `dev`（**勾选 "Builds for non-production branches"**） |
| 构建命令 | `pnpm --filter @dailogues/site build` | 同左 |
| 输出目录 | `apps/site/dist` | 同左 |
| Node 版本 | 22 | 22 |
| **Node.js compatibility** | **开启（Node 22）**——postgres 直连需要 | 同左 |
| 自定义域名 | `dailogues.com` | `candelbot.app`（绑 dev 分支；域名在 CF DNS 时） |
| 变量 | `DATABASE_URL`=生产 Postgres、`API_BASE_URL`=`https://api.dailogues.com`、`SITE_BASE_URL`=`https://dailogues.com`、`STUDIO_BASE_URL`=`https://app.dailogues.com`、`SITE_COOKIE_DOMAIN`=`.dailogues.com` | `DATABASE_URL`=dev Postgres、`API_BASE_URL`=`https://api.candelbot.app`、`SITE_BASE_URL`=dev 站点 URL、`STUDIO_BASE_URL`=`https://app.candelbot.app`、`SITE_COOKIE_DOMAIN`=留空 |

> 变量（各环境）：`DATABASE_URL`（对应环境 Postgres，只读连接可加 `?sslmode=require`）、`API_BASE_URL`（`https://api.candelbot.app` / `https://api.dailogues.com`）、`SITE_BASE_URL`（站点自身，**登录代理以它作为 Origin 转发给 API**）、`STUDIO_BASE_URL`（`app.*`）、`SITE_COOKIE_DOMAIN`（生产 `.dailogues.com`，dev 留空）。
> ⚠️ **站点实际域名必须加入 API 的 `APP_ORIGINS`**（auth-proxy 转发时以 `SITE_BASE_URL` 为 Origin，better-auth CSRF 白名单校验）——dev 用 Pages 默认域名时也要加（如 preview 分支的 `https://dev.dailogues-site.pages.dev`）。
> 消费端登录统一走本站 `/login`（server 代理 api 认证端点，SSO cookie 与 studio 共享）。

## 3. DNS（candelbot.app 托管处）

- `app.candelbot.app` → CNAME `dailogues-studio-dev.pages.dev`
- `candelbot.app` → 暂不解析（SSR 预留）

## 4. 扩展 dev 包

```bash
pnpm --filter @dailogues/extension build:dev   # 注入 gracious-caring-development.up.railway.app
```

chrome://extensions 加载 `apps/extension/`（unpacked），popup 确认 API 地址为 `https://gracious-caring-development.up.railway.app`（可手动覆盖、可恢复默认）。

## 5. dev 跑通验证链

1. `https://gracious-caring-development.up.railway.app/health` → 200
2. `https://app.candelbot.app` 打开 → 登录 → 连接扩展（externally_connectable 白名单已含 dev 域名）
3. DeepSeek 对话页点采集 → 导入 dev API → studio 出现草稿 → 向导生成
4. 全部通过后：`dev → master` 合并触发生产部署
