# AGENT — 项目总览

> 本项目所有文档的入口与汇总。任何 Agent / 协作者先读本文件。
> 最后更新：2026-08-14（**架构极简改造完成**：投稿 = URL + 声音采样，制作 = 编辑本地 Agent。
> 服务端无采集/LLM/队列代码，TTS 收敛为服务端统一端点 `/v1/editor/tts`；
> admin/studio/extension/importer 四个 app 删除；
> 编辑工作流落地为 `tools/dailog-editor` 子工程（源码 → 打包产物 `.agents/skills/dailog-editor`）

## 项目一句话

**dailog**：一档将「AI 聊天记录」模拟为真人采访 AI 的播客，单期 5-10 分钟呈现对话原文中的收获时刻（认知、经验、建议及启发）——任何人（dailog.fm）投稿
「**分享链接 + 声音采样**」即可；**编辑在本地 Agent**（ZCode + dailog-editor skill）拉取网页、
生成脚本、合成语音、制作封面，成品一次性上传发布（投稿人 = 主持人克隆音色，AI = 嘉宾品牌声线），
在 dailog 单一品牌频道分发（播放页 + 单 feed RSS）。

## 核心流程（本质版）

```
【投稿人】dailog.fm 注册（开放 + 邮箱验证）→ 提交分享链接（合法性+触达性检查）+ 声音采样
         → /me/submits 查看状态（submitted / rejected / published）
【编辑】本地 Agent（pnpm editor + dailog-editor skill）：
         list 队列 → detail 详情 → download 采样 → 本地拉取网页 → 生成脚本（dailog 标准）
         → Fish TTS（host 克隆 / guest 品牌声线）→ ffmpeg 合成 → Pexels 封面
         → publish 一次性上传（published + 期号 + 通知投稿人）/ reject（附原因 + 通知）
【听众】订阅 dailog 单 feed → 收听 / 分享（播放页 /episode/:id + RSS）
```

## 文档索引

| 文档 | 内容 | 状态 |
|---|---|---|
| [PRD.md](./PRD.md) | 产品设计与功能：流程、MVP 功能清单、页面、边界 | ✅ 已确认 |
| [ARC.md](./ARC.md) | 技术架构：栈、拓扑、API、数据模型、成本、测试 | ✅ 已确认 |
| [MRD.md](./MRD.md) | 产品定位、市场策略、商业模式、竞争优势、风险 | 🟡 初稿待审 |
| [docs/market-payments.md](./docs/market-payments.md) | 市场与收款策略：国际优先 GTM、v1 无收款、v2 听众侧路线 | ✅ 调研定稿 |
| [docs/console-setup.md](./docs/console-setup.md) | 控制台配置：Railway / CF Pages / Resend / 域名 / 环境变量 | ✅ 当前 |
| [docs/local-dev.md](./docs/local-dev.md) | 本地开发：OrbStack compose（site/api/postgres，orb.local 域名） | ✅ 当前 |
| [docs/developer-guide.md](./docs/developer-guide.md) | **开发指南（避坑手册）**：StyleX dev FOUC 修复、Grid minmax、overflow 裁剪边界——接手前必读 | ✅ 当前 |
| [docs/archive/](./docs/archive/) | 历史文档归档（旧计划 / 已删功能 spike / 本质版前清单） | 🗄️ 归档 |

## 工程目录（monorepo）

```
dailog/
├── apps/
│   └── site/                   # dailog.fm — 内容站 + 投稿人端 SSR（SolidStart + CF adapter）
│       └── src/routes/         #   /（landing） /discover /submit（URL+采样） /me/* /playlists /playlist/:slug /episode/:id /feed.xml /@username
├── services/
│   └── api/                    # api.dailog.fm — 统一后端（Railway，Node + Hono + Drizzle）
│       ├── src/routes/         #   submissions（投稿） / editor（队列/详情/拒审/发布/嘉宾/采样下载）
│       │                       #   voice（采样上传） / profile / notifications / favorites / playlists / auth
│       ├── repo/               #   submissions / episodes / guests / notifications / playlists
│       └── db/                 #   Drizzle schema + migrations（Railway Postgres）
├── tools/
│   └── dailog-editor/            # 编辑本地 Agent **源码工程**（src CLI + skill/ + templates/ + assets/ 资源 + build.mjs）
│       └── build.mjs             #   构建 → 产物 .agents/skills/dailog-editor/（scripts/*.js + SKILL.md + 模板 + assets/）
├── .agents/skills/
│   └── dailog-editor/            # 编辑工作流 skill **打包产物**（gitignored，构建生成——pnpm editor 跑这里）
├── .dailog-editor/               # 编辑本地配置（.env，gitignored）+ envs.json + drafts/ 草稿（gitignored）
├── packages/                     # ui（设计 token）/ i18n / auth-ui / shared
├── infra/                        # railway Dockerfile、local compose
├── AGENT.md / PRD.md / ARC.md / MRD.md
```

## 域名与部署速查

**Git 工作流**：`dev` = 集成分支（推送即集成部署到开发环境）；`master` = 生产分支。

| | 本地（dev 分支） | 开发环境 | 生产环境 |
|---|---|---|---|
| 后端 API | `https://api.dailog.orb.local`（OrbStack 容器，`pnpm dev:orb`） | `https://api.candelbot.app` | `https://api.dailog.fm` |
| 内容站 SSR | `https://dailog.orb.local` | `https://candelbot.app`（CF Pages） | `https://dailog.fm`（Pages/Workers） |
| Postgres | `dailog-pg` 容器（5432） | Railway Dev 实例 | Railway Prod 实例 |

> API 路径统一 `/v1/` 前缀（认证 `/v1/auth/*` 为 better-auth basePath）。
> **编辑不部署任何前端**——用本地 Agent（tools/dailog-editor 工程 → .agents/skills/dailog-editor 产物）操作，密钥只放 `.dailog-editor/.env`。
> 环境清单（编辑本地）：`.dailog-editor/envs.json`（local/dev/prod 三环境，模板 `tools/dailog-editor/templates/envs.example.json`）。

## 技术要点速查

- **任务开始先读 MEMORY.md（如已读取过就略过）**——跨会话长期记忆见该文件
- **前端数据获取原则（硬性约定）**：非必要不要把数据获取逻辑放进 `onMount`。
  优先顺序：`createAsync`/`createResource`（配合 Suspense 骨架）→ `createEffect`
  （依赖驱动，query/信号变化自动刷新）→ `onMount`（仅事件绑定等一次性副作用）。
  典型反例与正解：路由 query 变化（如 `/submit?id=`）用 `createEffect` 响应而非
  整页刷新；列表/详情数据用 `createAsync`（SSR 服务端取数序列化，客户端复用）或
  `createResource`（注意：SSR 短路返回 null 会被序列化、客户端不再重新请求——见
  developer-guide §投稿详情页修复记录）。
- 前端：SolidJS + Solid Router + StyleX（设计 token 与基础组件在 `packages/ui`）
- 后端：Node + TypeScript + Hono + Drizzle + better-auth（自托管邮箱+密码会话）
- **服务端无采集/LLM**——内容拉取、脚本生成、音频拼接、封面在编辑本地完成；
  **含统一 TTS 端点** `/v1/editor/tts`（Fish TTS + ffmpeg 转 wav，编辑本地一次调用）
- 存储：R2/fs（voice_samples / episodes 音频 / covers）；`STORAGE_DRIVER=fs|r2`
- 数据模型（本质版核心）：`submissions`（投稿：URL + 状态 submitted/rejected/published）
  → `episodes`（成品：submissionId 关联、audioUrl 直读、期号 max+1、published 即公开）；
  `guests`/`guest_voice_samples`（品牌声线宿主，编辑 TTS 取用）；`voice_samples`（投稿人采样）；
  `playlists`/`playlist_episodes`（0032 播放列表：平台策展 + 用户自建，有序集合；封面 MVP 取首期节目封面）
- 编辑端点：`requireRole(editor|admin)`；`ADMIN_EMAILS` 环境变量 = 部署自动预留管理员
- 通知：站内 notifications + Resend 邮件（拒审 / 上线「dailog 第 N 期」）
- 成本：除 LLM/TTS（编辑本地按量）/Resend 外：CF/R2 免费 + better-auth $0 + Railway ~$5–15/月
- 编辑本地：ffmpeg/ffprobe 必需；Fish Audio + Pexels key 在 `.dailog-editor/.env`

## 编辑工作流（新增协作者必读）

1. 配置：`.dailog-editor/.env`（Pexels key）+ `envs.json`（local/dev/prod 环境清单）
2. 登录：`pnpm editor login --env <环境>`（配对码，浏览器授权——token 绑定环境）
3. 命令（23 个）：`overview`（工作台概要）/ `batch`（批量提取分组）/ `batch-reject`（批量拒审）/
   `batch-scripts`（脚本批次汇总）/ `produce`（制作流水线 tts→merge→cover）/
   `fetch`（采集+解码，规则自进化）/ `script-preview`（脚本确认门）/ `tts` / `merge` / `cover` /
   `publish`（发布=状态+通知+邮件+草稿清理）/ `reject` / `guests` / `guest-voice` / `guest-set` /
   `playlist`（平台播放列表：list/create/add/remove/reorder/pick/cover 等）/ `progress`（中断恢复）/
   `login` / `auth-status` / `list` / `detail` 等
4. 完整流程与规范：`.agents/skills/dailog-editor/SKILL.md`（含 `prompts/script-generation.md` 提示词模板；
   批量两级流程：提取分组处置 → 自动质量检查/脚本生成 → 脚本分组处置 → 选号 produce → 两个确认点 → publish）
5. 草稿：`.dailog-editor/drafts/{submissionId}/`（gitignored；发布后自动清理）

## 共享设计系统约束（StyleX 硬性规则）

设计 token 与基础组件唯一源在 **`packages/ui`**（`@dailogues/ui`），site 消费。规则：

1. tokens 导入路径必须以 `.stylex.ts` 结尾（`@dailogues/ui/theme.stylex`），禁止 barrel 导入
2. 本地禁止新建/修改 theme.stylex.ts（token 值只改 `packages/ui/src/theme.stylex.ts`）
3. 新增共享组件加入 `packages/ui/src/components/`，从 barrel 导出；组件内禁用
   `window`/`document` 顶层依赖（site 是 SSR）；源码分发不预编译
4. site 的 vite 含 `ssr.noExternal: ["@dailogues/ui"]`
5. 改共享包后必跑：site `typecheck` + `build`

## 里程碑

- [x] M1–M4：Fish spike / 后端骨架 / 采集器 / 润色管线（本质版前历史实现，代码已随极简改造移除）
- [x] M5：better-auth + Railway Postgres + 投稿制状态机（本质版简化：submitted/rejected/published）
- [x] P1–P3（2026-08-11/12）：首页 landing + 投稿流程 + 编辑端审核/生成/发布（旧实现，已重构）
- [x] **架构极简改造（2026-08-13）**：投稿 = URL + 采样；编辑 = 本地 Agent（skill + scripts）；
      服务端删采集/LLM/队列；TTS 收敛回服务端统一端点；admin/studio/extension/importer 删除；0026 迁移落地
- [x] M6：内容站完善（播放器化重构：全局播放条 + 个人中心 + 统计卡片 + FAQ + 主播/嘉宾入口 + 我的节目下架上架）
- [ ] M7：成本与风控（质量门前置、用稿率观察；编辑本地按量可控）
- [ ] M8：E2E + 上线（首期节目制作 + 分发验证）

## 约定

- 文档改动同步更新 AGENT.md 索引与里程碑
- 实现时所有供应商密钥经环境变量注入，不提交仓库（编辑本地密钥只在 `.dailog-editor/.env`）
- 前端样式/组件改动遵循「共享设计系统约束」章节
