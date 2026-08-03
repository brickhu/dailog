# 双环境控制台配置清单（2026-08-03）

仓库：`https://github.com/brickhu/dailog`（`dev` = 开发环境，`master` = 生产环境）

| 环境 | 分支 | API | SPA | SSR（预留） | Postgres |
|---|---|---|---|---|---|
| 开发 | `dev` | `api.candelbot.app` | `app.candelbot.app` | `candelbot.app` | Railway Development 环境 |
| 生产 | `master` | `api.dailogues.com`（待定 dailog.fm） | `app.dailogues.com` | `dailogues.com` | Railway Production 环境 |

## 1. Railway（API + Postgres）

1. [ ] 新建项目 → **Connect GitHub repo**：`brickhu/dailog`
2. [ ] Settings → **Production branch = `master`**；启用 **Development environment**（此后 `dev` 分支 push 自动部署到 Development 环境）
3. [ ] Production 环境：`Add Database → PostgreSQL` + 部署 API service（自动识别根 `railway.json`：Docker 镜像含 ffmpeg，healthcheck `/health`）
4. [ ] Development 环境：同样加 Postgres + API service
5. [ ] 域名：Production API 服务 → Settings → Domains 绑 `api.dailogues.com`；Development API 服务绑 `api.candelbot.app`（DNS 加 CNAME 到对应 `*.up.railway.app`）
6. [ ] 各环境 Variable（按环境分别设置）：

| 变量 | 开发环境 | 生产环境 |
|---|---|---|
| `DATABASE_URL` | 本环境 Postgres | 本环境 Postgres |
| `APP_ORIGINS` | `https://app.candelbot.app,http://localhost:5173` | `https://app.dailogues.com` |
| `DEEPSEEK_API_KEY` / `BASE_URL` / `MODEL` | ✓ | ✓ |
| `FISH_API_KEY` / `FISH_PROXY_URL` / `FISH_GUEST_REFERENCE_ID` | ✓ | ✓ |
| `STORAGE_DRIVER` | `fs`（或 r2） | `r2` + `R2_ACCOUNT_ID/ACCESS_KEY/SECRET_KEY/BUCKET` |
| `SUPABASE_URL` / `SUPABASE_JWKS_URL` | 共用现有项目（M5 迁移后移除） | 同左 |
| `BETTER_AUTH_SECRET` | M5 后启用 | M5 后启用 |
| `PORT` | 8787 | 8787 |

7. [ ] Development 环境首次部署后跑迁移（Service → Exec 或本地 `railway run`）：
   `pnpm --filter @dailogues/api db:migrate`

## 2. Cloudflare Pages（SPA）

| | dev project `dailogues-studio-dev` | prod project `dailogues-studio` |
|---|---|---|
| 连接仓库 | brickhu/dailog | brickhu/dailog |
| Production branch | `dev` | `master` |
| 构建命令 | `pnpm --filter @dailogues/studio build` | 同左 |
| 输出目录 | `apps/studio/dist` | 同左 |
| Node 版本 | 22（Pages 自动识别 pnpm 锁文件） | 22 |
| `VITE_API_BASE_URL` | `https://api.candelbot.app` | `https://api.dailogues.com` |
| 自定义域名 | `app.candelbot.app` | `app.dailogues.com`（待定） |

> `VITE_EXTENSION_ID` 可留空（扩展连接卡隐藏）；M5 后 `VITE_SUPABASE_*` 移除。
> SSR 站（apps/site 未建）：`candelbot.app` / `dailogues.com` 根域等 plan 6-7 创建后各绑一个 Pages/Workers project。

## 3. DNS（candelbot.app 托管处）

- `app.candelbot.app` → CNAME `dailogues-studio-dev.pages.dev`
- `api.candelbot.app` → CNAME Railway 提供的 `<project>.up.railway.app`
- `candelbot.app` → 暂不解析（SSR 预留）

## 4. 扩展 dev 包

```bash
pnpm --filter @dailogues/extension build:dev   # 注入 api.candelbot.app
```

chrome://extensions 加载 `apps/extension/`（unpacked），popup 确认 API 地址为 `https://api.candelbot.app`（可手动覆盖、可恢复默认）。

## 5. dev 跑通验证链

1. `https://api.candelbot.app/health` → 200
2. `https://app.candelbot.app` 打开 → 登录 → 连接扩展（externally_connectable 白名单已含 dev 域名）
3. DeepSeek 对话页点采集 → 导入 dev API → studio 出现草稿 → 向导生成
4. 全部通过后：`dev → master` 合并触发生产部署
