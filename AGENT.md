# AGENT — 项目总览

> 本项目所有文档的入口与汇总。任何 Agent / 协作者先读本文件。
> 最后更新：2026-09-05（**采编 lab 化**）：dailog-editor 本地 Agent 管线下线，编辑工作流迁移 **dailog lab**
>（`tools/script-lab`：浏览器采编控制台 + 轻服务端，`pnpm lab` 本地运行）；制作产物 R2 权威 + 浏览器缓存，
> 无本地草稿目录依赖；提示词工程在 `tools/script-lab/prompts/`（即改即生效）。
> 历史：2026-08-13 架构极简改造（投稿 = URL + 采样；服务端删采集/LLM/队列；admin/studio/extension/importer 删除）。
> 服务端（api.dailog.fm）无采集/LLM；`/v1/editor/tts` 保留为兼容端点，lab 逐段 TTS 直调 Fish。

## 项目一句话

**dailog**：一档将「AI 聊天记录」模拟为真人采访 AI 的播客，单期 5-10 分钟呈现人与 AI 真实的思考过程（困惑 → 想通）——任何人（dailog.fm）投稿
「**分享链接 + 声音采样**」即可；**编辑在 dailog lab 采编工作台**（tools/script-lab）采集对话、审题、
生成脚本、语感打磨、逐段 TTS、合成语音、制作封面并发布（投稿人 = 主持人克隆音色，AI = 嘉宾品牌声线），
在 dailog 单一品牌频道分发（播放页 + 单 feed RSS）。

## 核心流程（本质版）

```
【投稿人】dailog.fm 注册（开放 + 邮箱验证）→ 提交分享链接（合法性+触达性检查）+ 声音采样
         → /me/submits 查看状态（submitted / collected / crafted / rejected / published）
【编辑】dailog lab（tools/script-lab：浏览器工作台 + 轻服务端，pnpm lab 本地运行）：
         投稿队列 → 采集对话原文（R2，URL 哈希 key）→ 审题（LLM 评分/方向）→ 脚本创作 + 手工修改 → 语感打磨
         → 逐段 Fish TTS（host 克隆 / guest 品牌声线）→ 合成 full audio（R2 成品位）→ 封面 + 节目信息
         → publish（published + 期号 + 通知投稿人）/ reject（附原因 + 通知）
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
│   ├── script-lab/               # **dailog lab 采编工作台**（web/ 浏览器控制台 + server.mjs 轻服务端；pnpm lab 本地运行）
│   │   ├── prompts/              #   提示词工程（review.score / review.script / polish.all / meta —— 即改即生效）
│   │   └── lib/ + web/           #   llm/collect/prompt 封装（采集自包含）+ 采编控制台前端
│   ├── dailog-cli/               # 共享 CLI 底座（r2.js 哈希 / fish.js 封装；script-lab 复用中，迁移完成可并入）
│   └── dailog-editor/            # **已下线**（2026-09-05）——旧本地 Agent CLI + skill 源码，保留待清理
├── .agents/skills/
│   └── dailog-editor/            # 已下线技能产物（历史遗留，不再构建/使用）
├── .dailog-editor/               # 旧本地配置与草稿（已下线，不再使用）
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
> **编辑工作台 = dailog lab（tools/script-lab，本地运行）**——不向公网部署编辑前端；
> lab 登录页选择环境（dev/prod），会话存 `tools/script-lab/.lab-cookies.json`；
> LLM/密钥等配置在 `tools/script-lab/.env`（模板 `.env.example`）。

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
- **服务端（api）无采集/LLM**——采集、脚本生成（提示词驱动）、TTS、音频拼接、封面在 **dailog lab**（tools/script-lab）完成；
  经 `/v1/editor/*` 与 `/v1/editor/storage` 读写服务端与 R2；`/v1/editor/tts` 保留为兼容端点（lab 逐段直调 Fish）
- 存储：R2/fs（voice_samples / episodes 音频 / covers）；`STORAGE_DRIVER=fs|r2`
- 数据模型（本质版核心）：`submissions`（投稿：URL + 状态 submitted/collected/crafted/rejected/published + review jsonb 审题采纳结果）
  → `episodes`（成品：submissionId 关联、audioUrl 直读、期号 max+1、published 即公开）；
  `guests`/`guest_voice_samples`（品牌声线宿主，lab TTS 取用）；`voice_samples`（投稿人采样）；
  `playlists`/`playlist_episodes`（0032 播放列表：平台策展 + 用户自建，有序集合；封面 MVP 取首期节目封面）
- 编辑端点：`requireRole(editor|admin)`；`ADMIN_EMAILS` 环境变量 = 部署自动预留管理员
- 通知：站内 notifications + Resend 邮件（拒审 / 上线「dailog 第 N 期」）
- 成本：除 LLM/TTS（lab 按量，经 tools/script-lab 服务端直连）/Resend 外：CF/R2 免费 + better-auth $0 + Railway ~$5–15/月
- dailog lab：本地运行需 Node ≥22（server.mjs）；浏览器需跨域隔离（SAB）供 ffmpeg.wasm 合成——不可用自动降级 lab 服务端合成；LLM/Fish 等 key 在 `tools/script-lab/.env`

## 采编工作流 dailog lab（tools/script-lab，新增协作者必读）

1. 启动：`cd tools/script-lab && pnpm lab`（或 `pnpm lab:dev`）→ 浏览器打开 127.0.0.1:4173 → 登录页选择环境（dev/prod）
2. 环节：投稿队列 → **采集**（对话原文 → R2，URL 哈希 key）→ **审题**（review.score：主线话题 / 用户的困惑 / 评分 / 方向）→
   **脚本创作**（review.script，多候选；链上提问保真、困惑颗粒不磨平）→ **语感打磨**（polish.all：顺口/放大/停顿/情绪标签）→
   **逐段 TTS**（host = 投稿人采样 / guest = 品牌声线）→ **合成**（浏览器 ffmpeg.wasm，段间间隔 / intro / BGM 可配）→
   **节目信息 + 封面** → **发布 / 拒审**
3. 提示词工程：`tools/script-lab/prompts/*.md` 即改即生效；服务端按 promptSig（md mtime 指纹）随输出落
   `feedback/review.jsonl`——可回溯“哪版规则产生了这个结果”，构成提示词反馈闭环
4. 产物与恢复：关键产物即时 R2/入库（审题采纳 → submission review jsonb；脚本定稿 → R2 `scripts/{id}.json`；
   成品音频 → R2 `episodes/{userId}/{id}.m4a`），浏览器 localStorage/IndexedDB 只存可再生工作副本——换浏览器/清缓存不丢已落产物
5. 服务端（server.mjs）接口入口 `/api/run/*`：fetch/batch · review · script · polish · tts-seg · full-merge · full-upload · publish-submit · reject；
   LLM 配置 `tools/script-lab/.env`（模板 `.env.example`）

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
- [x] **采编 lab 化（2026-09-05）**：dailog-editor 本地 Agent 管线下线；编辑工作流迁移 dailog lab（tools/script-lab：浏览器工作台 + 轻服务端）；产物 R2 权威 + 浏览器缓存；提示词体系迁至 tools/script-lab/prompts
- [ ] M7：成本与风控（质量门前置、用稿率观察；lab 按量可控）
- [ ] M8：E2E + 上线（首期节目制作 + 分发验证）

## 约定

- 文档改动同步更新 AGENT.md 索引与里程碑
- 实现时所有供应商密钥经环境变量注入，不提交仓库（lab 密钥只在 `tools/script-lab/.env`，gitignored）
- 前端样式/组件改动遵循「共享设计系统约束」章节
