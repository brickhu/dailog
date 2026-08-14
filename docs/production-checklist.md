# 主网（dailog.fm）上线配置清单

> 架构：site=`dailog.fm`（CF Pages）· admin=`admin.dailog.fm`（CF Pages）· api=`api.dailog.fm`（Railway）
> 存储：R2（生产独立 bucket）· 数据库：Railway Postgres（生产环境）
> 依赖顺序：① DNS 域准备 → ② Resend 发信域 → ③ Railway API → ④ CF Pages → ⑤ 初始化数据

---

## ① DNS（Cloudflare，dailog.fm）

- [ ] dailog.fm 迁入 Cloudflare（nameserver 切换）
- [ ] 记录：
  | 类型 | 名称 | 目标 |
  |---|---|---|
  | CNAME | dailog.fm | site 的 pages.dev 地址（或 CF Pages 自动绑定） |
  | CNAME | admin | admin 的 pages.dev 地址 |
  | CNAME | api | Railway 分配的域名（`*.up.railway.app`） |
- [ ] Resend 验证记录（见 ②，配好后统一加）

## ② Resend（发信域 dailog.fm）

- [ ] Resend → Domains → Add domain：`dailog.fm`
- [ ] 把返回的 SPF（TXT）与 DKIM（TXT/CNAME）记录加到 Cloudflare DNS
- [ ] 等验证状态 verified（几分钟~几小时）

## ③ Railway（api + Postgres 生产环境）

- [ ] 新建 Production 环境（或复用现有，与 dev 隔离）
- [ ] Postgres 服务（生产库）
- [ ] API 服务环境变量：

| 变量 | 值/说明 |
|---|---|
| `DATABASE_URL` | 生产库连接串（internal 即可，同环境） |
| `BETTER_AUTH_SECRET` | **随机强密钥**（`openssl rand -base64 32`，绝不用 dev 值） |
| `BETTER_AUTH_URL` | `https://api.dailog.fm` |
| `BETTER_AUTH_COOKIE_DOMAIN` | `.dailog.fm`（SSO 跨子域 cookie） |
| `APP_ORIGINS` | `https://dailog.fm,https://admin.dailog.fm` |
| `PORT` | Railway 默认 8080（代码读 PORT，无需改） |
| `STORAGE_DRIVER` | `r2` |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY` / `R2_SECRET_KEY` / `R2_BUCKET` | 生产 bucket 凭据（**不要复用 dev bucket**） |
| `RESEND_API_KEY` | Resend key（生产） |
| `EMAIL_FROM` | `dailog <no-reply@dailog.fm>` |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | 润色/质量门 LLM |
| `FISH_API_KEY` | TTS（**不要配 FISH_PROXY_URL**——Railway 海外直连） |
| `FISH_GUEST_REFERENCE_ID` | 可选：逐段降级路径的嘉宾音色 ID（主路径用 R2 资产，可不配） |
| `POLISH_MAX_VERSIONS` | `5` |

- [ ] 生产 R2 bucket 初始化：上传 `assets/guest-voice-zh.mp3`（本地 bucket 已有，复制或重传）
- [ ] 首次迁移：Railway 启动自动 `db:migrate`（Dockerfile CMD 已含）

## ④ Cloudflare Pages

- [ ] site 项目：production branch = `master`；custom domain：`dailog.fm`
- [ ] admin 项目：production branch = `master`；custom domain：`admin.dailog.fm`
- [ ] site **Production 环境变量**：
  | 变量 | 值 |
  |---|---|
  | `DATABASE_URL` | **Railway 生产库的 `DATABASE_PUBLIC_URL`**（公网 TCP 代理串——site 在 CF，必须公网可达；勿用内网 DATABASE_URL） |
  | `API_BASE_URL` | `https://api.dailog.fm` |
  | `SITE_BASE_URL` | `https://dailog.fm` |
  | `ADMIN_BASE_URL` | `https://admin.dailog.fm` |
- [ ] admin **Production 环境变量**：
  | 变量 | 值 |
  |---|---|
  | `VITE_API_BASE_URL` | `https://api.dailog.fm` |

## ⑤ 初始化数据（生产库）

- [ ] 初始化编辑角色（`user.role=editor`，0027 起账号级字段在 user 表）：本地连生产库更新第一个账号（DATABASE_URL 指向生产库，临时用）
- [ ] 验证链路（自查清单）：
  - [ ] `https://api.dailog.fm/health` → `{"ok":true}`
  - [ ] `dailog.fm` 打开正常、登录页 brand 显示 "dailog"
  - [ ] 注册 → 收到 `no-reply@dailog.fm` 验证邮件 → 点链接自动登录
  - [ ] `admin.dailog.fm` SSO 免登录（跨子域 cookie）
  - [ ] 注册（邮箱验证）→ 投稿（分享链接 + 人设配置）→ 编辑工作台：审核/润色 → 选脚本 → 生成 → 自动发布 → `dailog.fm/<slug>` 播放 + 单 feed RSS（`/feed.xml`）
  - [ ] 上传的样本/产物出现在生产 R2 bucket（`voices/`、`episodes/`、`imports/`）

## 备忘

- **不要做的**：R2 bucket 与 dev 共用；BETTER_AUTH_SECRET 用 dev 值；FISH_PROXY_URL 配到生产
- **代码要推 master**：本地所有未提交改动（样本直传/2D/transcript/R2 规划/改名）需要先提交推送 master 分支，Pages/Railway 才会构建新代码
- 主网全部就绪后，把 `dailog.fm` 相关生产配置在 AGENT.md/ARC.md 中标注 ✅（文档同步）
