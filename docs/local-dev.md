# 本地开发环境（OrbStack 容器化）

> 状态：2026-08-13（本质版更新——admin/importer 容器已删除，只剩 postgres/api/site）。
> 本地调试全家桶跑在 OrbStack（docker compose），通过 `*.orb.local` 无端口访问。

## 架构

```
浏览器 ── http://dailog.orb.local ──────────┐
       ── http://api.dailog.orb.local ──────┤
                                            ▼
┌──────────────── OrbStack（docker compose，项目名 dailog）────────────────┐
│  dailog 容器（site，vinxi，:80）         api 容器（:8787）                │
│  dailog-pg（postgres，:5432）                                             │
│                                                                            │
│  容器间调用走 compose 服务名（api/postgres），不经宿主机                    │
└────────────────────────────────────────────────────────────────────────────┘
```

- 容器名/服务名 = 域名：`dailog`（site）、`api`、`dailog-pg`
- 宿主机 `localhost:3000/8787/5432` 同样可达（ports publish）
- 数据：postgres 数据在 `dailog-dev_pgdata` 卷（`docker compose down` 不丢；`down -v` 会删）

## 快速开始

```bash
pnpm dev:orb              # 构建 + 启动全家桶（首次构建几分钟；含代理例外自动配置）
docker compose logs -f   # 看日志
docker compose down      # 停止（数据保留）
```

迁移由 api 容器启动时自动执行（`db:migrate`，幂等）。

## 域名与端口

| 域名 | 服务 | 容器内端口 | 宿主映射 |
|---|---|---|---|
| `http://dailog.orb.local` | site（vinxi dev） | 80（HTTP）+ 3001（HMR） | localhost:3000 → 80 |
| `http://api.dailog.orb.local` | API（tsx watch） | 8787 | localhost:8787 |
| `dailog-pg` | postgres | 5432 | localhost:5432 |

> **不要用 https**：OrbStack 容器名域名的 443 路由会把请求导向容器内非 HTTP 端口（返回 426）。
> 统一 http——cookie 无 Secure 属性，SSO 跨子域不受影响。

## API 路径约定：`/v1/` 前缀

所有 API 端点统一 `/v1/` 前缀（域名已标识 API，路径前缀做版本化）：

- 认证：`/v1/auth/*`（better-auth `basePath: "/v1/auth"`）
- 业务：`/v1/submissions`、`/v1/me/*`、`/v1/editor/*`（编辑本地 Agent）、`/v1/device/*`（配对登录）、`/v1/episodes/*`（互动）
- 公开：`/health`（无前缀，免鉴权）；`/v1/public/episodes/:id/audio|cover`（播放）
- 鉴权：`app.use("/v1/*", authMiddleware)` 一条中间件覆盖全部业务端点；`/v1/auth/*`、`/v1/device`、`/v1/device/poll` 挂在中间件之前免鉴权

前端（site）统一用相对路径 `/v1/...` 调用——站内代理按前缀整体转发：

| 代理点 | 转发目标 | 说明 |
|---|---|---|
| site `routes/v1/**` 站内代理 | `proxyApi` → `API_BASE_URL` | orb 容器内 `http://api:8787`；透传 cookie（better-auth 会话） |

## 关键配置（docker-compose.yml environment 覆盖 .env.local）

| 变量 | 值 | 说明 |
|---|---|---|
| `BETTER_AUTH_URL` | `http://api.dailog.orb.local` | 回调/重定向基址 |
| `BETTER_AUTH_COOKIE_DOMAIN` | `.dailog.orb.local` | SSO 跨子域 cookie（site 登录态） |
| `APP_ORIGINS` | `http://dailog.orb.local` | CORS/CSRF 白名单 |
| `DATABASE_URL`（api/site） | `postgres://dailogues:dailogues@postgres:5432/dailogues` | 容器内服务名 |
| `PORT=80`（site） | 容器内监听 80 | OrbStack 域名 80 → 容器 80 |
| `ADMIN_EMAILS` | 编辑账号邮箱 | 部署自动预留管理员（启动/注册时提升为 admin） |

## 编辑本地 Agent（tools/dailog-editor）

```bash
cp .dailog-editor/.env.example .dailog-editor/.env      # Fish/Pexels 密钥
cp tools/dailog-editor/templates/envs.example.json .dailog-editor/envs.json  # 环境清单（local/dev/prod）
pnpm editor --env local login      # 配对码登录（浏览器授权 → 粘贴配对码）
pnpm editor --env local auth-status  # 会话初始化：/health 端点检查 + 授权检查
pnpm editor --env local list       # 待审队列
```

## 常用命令

```bash
pnpm dev:orb              # 启动全家桶
pnpm otp [邮箱前缀]        # 查注册/重置验证码（docker exec dailog-pg）
docker compose ps         # 状态
docker compose logs -f api # 单服务日志
docker exec dailog-pg psql -U dailogues -d dailogues  # 直连数据库
```

## 常见问题

1. **浏览器访问 orb.local 超时/不可达**：系统 SOCKS 代理拦截——`dev-orb.sh` 会自动把 `*.orb.local`
   加入代理例外；手动：`networksetup -setproxybypassdomains "Wi-Fi" "*.sslip.io" "*.orb.local" "localhost" "127.0.0.1"`
2. **site 域名返回 426**：OrbStack 自动探测多端口容器误选 HMR 端口——已用 label
   `dev.orbstack.http-port=80` 强制（勿删）
3. **改 app.config/docker-compose 后不生效**：`docker compose restart <服务>`（volume 挂载
   的代码热更新；config/compose 变更需重启容器）
4. **数据迁移**：项目名/卷名变更时用 `pg_dump` 导出再导入，或直接复用卷名 `dailog-dev_pgdata`

## 环境速查（远程）

| 环境 | API | 站点 |
|---|---|---|
| dev | `https://api.candelbot.app` | `https://candelbot.app` |
| prod | `https://api.dailog.fm` | `https://dailog.fm` |

## 历史

- 2026-08-09：sslip.io + Caddy 反代方案（已废弃——多域名 HTTPS/HMR/证书问题多）
- 2026-08-10：切换 OrbStack compose + `*.orb.local`；API 路径统一 `/v1/` 前缀
- 2026-08-13：本质版——admin/importer 容器删除；编辑工作流迁到本地 Agent（tools/dailog-editor 工程）
