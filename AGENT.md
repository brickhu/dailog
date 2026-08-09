# AGENT — 项目总览

> 本项目所有文档的入口与汇总。任何 Agent / 协作者先读本文件。
> 最后更新：2026-08-09（M1-M4 已完成；**采集已切换为分享链接服务**（scraper.dailog.fm，六平台全通）——扩展采集停用、源码保留在 apps/extension；M4 门控 E2E 待 DEEPSEEK_API_KEY 实跑）

## 项目一句话

**dailog**：把用户与 AI 的对话一键发布为二人对谈播客（用户 = 主持人，克隆音色；AI = 嘉宾，固定音色），每个用户一个可订阅的播客频道（播放页 + RSS）。

## 文档索引

| 文档 | 内容 | 状态 |
|---|---|---|
| [PRD.md](./PRD.md) | 产品设计与功能：流程、MVP 功能清单、页面、边界 | ✅ 已确认 |
| [ARC.md](./ARC.md) | 技术架构：栈、拓扑、API、管线、数据模型、成本、测试 | ✅ 已确认 |
| [MRD.md](./MRD.md) | 产品定位、市场策略、商业模式、竞争优势、风险 | 🟡 初稿待审（市场部分为起草） |
| [docs/pitch-narrative.md](./docs/pitch-narrative.md) | 融资叙事：一句话定位、三幕讲稿（楔子→形态→平台）、质疑反击话术、90 天消费端验证 | 🟡 v2（2026-08-04） |
| [docs/pitch-deck.md](./docs/pitch-deck.md) | Pitch Deck 大纲：10 页结构 + 每页内容/台词/视觉 + Demo 脚本 + Q&A 预判 | 🟡 v2（2026-08-04，形态命名入 P4/P10） |

## 工程目录参考（monorepo，待实施）

```
dailog/
├── apps/
│   ├── studio/                 # app.dailog.fm — 工作台 SPA
│   │   ├── src/pages/          #   auth / onboarding-voice / dashboard / episodes-new / settings
│   │   └── src/components/     #   录音器、导入结果、润色编辑器、生成进度、发布表单
│   ├── site/                   # dailog.fm — 内容分发 SSR（SolidStart + CF adapter）
│   │   └── src/routes/         #   /(首页) /episode/:id(单集页) /@username /@username/feed.xml
│   └── extension/              # 采集扩展（已停用，源码保留——登录态 DOM 采集历史实现）
│   └── share-collect/          # 分享链接采集服务（独立部署 scraper.dailog.fm，六平台解析器）
│       ├── manifest.json       #   content_scripts 按平台 URL 匹配 + background 权限
│       ├── src/content/        #   按平台采集器：claude.ts / deepseek.ts / chatgpt.ts / ...
│       │   └── core.ts         #   虚拟列表滚动循环 + MutationObserver + 去重排序
│       ├── src/background.ts   #   service worker：接收 content 消息 → POST api.dailog.fm
│       └── src/shared.ts       #   采集协议类型（platform/conversation_id/title/url/messages[]）
├── services/
│   └── api/                    # api.dailog.fm — 统一后端（Railway，Node + Hono）
│       ├── src/
│       │   ├── routes/         #   imports / polish / generate / jobs / voice / billing / stripe-webhook
│       │   ├── pipeline/       #   生成管线（tts → merge → upload）
│       │   ├── tts/            #   Fish Audio 适配（多说话人/零样本克隆，见 docs/spikes/fish-audio.md）
│       │   ├── llm/            #   质量审核 + 润色 + 语言检测（DeepSeek，配置化）
│       │   ├── billing/        #   Stripe checkout/webhook/配额
│       │   └── db/             #   Drizzle schema + migrations（Railway Postgres）
│       └── （Dockerfile 在 infra/railway/，含 ffmpeg）
├── packages/
│   └── shared/                 # 领域类型（含采集协议）+ 设计 token（StyleX）
├── infra/
│   ├── railway/               # Dockerfile、railway.json、健康检查配置
│   ├── cloudflare/            # wrangler.toml、Pages 配置、_routes.json
│   ├── github/workflows/      # CI（typecheck + test；部署走 Railway Git 集成）
│   └── scripts/               # 管理员 CLI（生成邀请码等）
├── assets/
│   └── audio/                  # 固定片头片尾：intro.zh.mp3 / intro.en.mp3 / outro.zh.mp3 / outro.en.mp3
├── fixtures/                   # 采集器测试样本（各平台对话页 DOM 快照）
├── AGENT.md / PRD.md / ARC.md / MRD.md
```

## 域名与部署速查

**Git 工作流**：`dev` = 集成分支（推送即集成部署到开发环境）；`master` = 生产分支（推送即部署到生产环境）。功能开发合入 dev → dev 验证 → 合入 master 发生产。

**环境矩阵**（`git branch → 环境 → 域名 → 托管`）：

| | 开发环境（dev 分支） | 生产环境（master 分支） |
|---|---|---|
| 后端 API | `gracious-caring-development.up.railway.app`（Railway Development 环境默认 URL） | `api.dailog.fm`（Railway Production 环境）⚠️ 生产域名待定：`dailog.fm` 或保留 `dailog.fm` |
| 工作台 SPA | `app.candelbot.app`（CF Pages project `dailog-studio-dev`，production branch = dev） | `app.dailog.fm`（CF Pages project `dailog-studio`，production branch = master） |
| 内容站 SSR | `candelbot.app`（Pages project 预留，等 apps/site 创建） | `dailog.fm`（Pages/Workers） |
| Postgres | Railway Development 环境内独立实例 | Railway Production 环境内实例 |
| ~~采集扩展~~ | ~~已停用~~（源码保留；不再构建/部署） | |
| 分享采集服务 | `pnpm --filter @dailogues/share-collect dev` | Railway 部署（Nixpacks，`SHARE_COLLECT_URL`/`SCRAPERAPI_KEY` env） |

> **品牌名**：`dailog`——由 `dialogues` 交换 `ia→ai` 变形（寓意 AI）。开发域名 `candelbot.app`（已确认），生产域名待定（`dailog.fm` / `dailog.fm`），定稿后统一替换文档与扩展 manifest 中的占位。

## 技术要点速查

- 前端：SolidJS + Solid Router + StyleX（设计 token 与基础组件统一在共享包 `packages/ui`，见下节约束）
- 后端：Node + TypeScript + Hono + Drizzle + fluent-ffmpeg
- 认证：**better-auth**（自托管邮箱+密码会话，后端中间件验证）；注册开放，**邀请码用于开通频道**（未开通不能生成/发布）
- 生成管线：TTS = **Fish Audio**（形态已实测，`docs/spikes/fish-audio.md`）——**多说话人一次调用**：`text` 内嵌 `<|speaker:N|>` 标签 + `reference_id` 数组（**非 text/chunks 数组**）；主持人零样本克隆走 **msgpack `references` 内联音频**（JSON 无 base64 字段、带不了原始音频）；**混合模式受限**（一次调用不能混用内联 + 固定 id）→ 按段 fallback（host 段 msgpack 内联零样本 + guest 段固定音色逐段合成，实测形态）+ ffmpeg 拼接；单请求 ≥12000 中文未触上限；免费模型 `s2.1-pro-free`（$0）可用；默认 `temperature=0.7` 一致性波动 ~12%（可接受）→ ffmpeg 拼接固定片头片尾 → R2；备选切换预案见 ARC §3.3 / `docs/spikes/tts-comparison.md`
- 后端 LLM：**DeepSeek**（OpenAI 兼容，`deepseek-chat` 默认，配置化可切换）
- 润色：LLM SSE 流式；**打磨前质量审核前置** + **生成前内容安全审核**（编辑后脚本提交生成时，DeepSeek 安全审核通过才合成，拒绝不扣配额）；语言跟随对话内容（与界面语言无关）；单期目标 5–10 分钟
- 计费：Stripe Checkout/Portal/Webhook；**按脚本字数计费**（LLM/TTS 成本随字数线性，对齐成本结构）；**脚本硬上限 5000 字**；润色免费（获客）+ 对话级润色上限（每对话 ≤5 版，pro 不限）；免费首期 0 扣费；Pro 订阅无限
- 导入：**分享链接采集服务**（用户粘贴平台分享链接 → `share-collect` 解析（Claude/ChatGPT/DeepSeek/Gemini/Kimi/豆包，公开接口/SSR/RSC/batchexecute 通道）→ 工作台预览确认入库）；被 CF 拦时通道重试（ScraperAPI 兜底）；**扩展采集已停用**（源码保留 `apps/extension`，历史实现见 `docs/spikes/chat-dom.md`）
- 邀请码：管理员 CLI + 用户奖励（>3 期后每发布一期 +1）；**注册开放，授权码开通频道**
- 成本策略：除 LLM/TTS/Stripe 外：CF/R2 免费 + better-auth $0；Railway（API+DB）约 $10–25/月

## 共享设计系统约束（StyleX 硬性规则）

设计 token 与基础组件唯一源在 **`packages/ui`**（`@dailogues/ui`），studio 与 site 两站共享。以下规则违反会导致构建失败或样式漂移，改动必须遵守：

1. **tokens 导入路径必须以 `.stylex.ts` 结尾**：
   `import { tokens } from "@dailogues/ui/theme.stylex"`
   - 禁止从 barrel 导入：`import { tokens } from "@dailogues/ui"` ❌（StyleX 编译器要求变量导入静态解析到 `.stylex` 文件，barrel 重导出直接构建报错）
   - 共享组件内部用相对路径 `../theme.stylex` 导入 tokens
2. **本地禁止新建/修改 theme.stylex.ts**：token 值只能改 `packages/ui/src/theme.stylex.ts`（两站同步生效，无本地副本）
3. **新增共享组件**：加入 `packages/ui/src/components/`，从 barrel（`src/index.ts`）导出；
   - 组件文件内禁用 `window`/`document` 顶层依赖（site 是 SSR，必须服务端渲染安全）
   - 共享包**源码分发、不预编译**（两站各自的 StyleX 管线处理，勿给 packages/ui 加构建产物）
4. **应用侧配置（改配置时必须保留）**：
   - `apps/studio`、`apps/site` 的 package.json 依赖含 `"@dailogues/ui": "workspace:^"`
   - `apps/site/app.config.ts` 的 vite 含 `ssr.noExternal: ["@dailogues/ui"]`（Nitro 必须打包 TS 源码）
5. **改共享包后必跑验证**：`apps/studio` 与 `apps/site` 的 `typecheck` + `build` 全绿（site 另跑 workerd 冒烟：`npx wrangler pages dev dist`）

## 里程碑

- [ ] M0：文档定稿（PRD/ARC/MRD 审阅通过）
- [x] M1：Fish Audio 集成 spike（多说话人格式、单请求限额、克隆音质、计费实测）—— 已完成（`docs/spikes/fish-audio.md`；真实扣费金额上线前用付费账号核对）
- [x] M2：统一后端骨架（Hono + Drizzle + 9 表迁移 + 本地 Postgres 集成测试 + JWT 认证 + Docker/Railway 配置 + CI）—— 代码完成，**待用户：GitHub 仓库推送 + Railway（Postgres + 应用）绑定部署**
- [x] M3：采集器—— 扩展版（Manifest V3）已完成（历史实现，已停用）；分享链接服务版（六平台）已完成并部署（scraper.dailog.fm，实测全通）
- [x] M4：质量审核 + 润色（LLM 流式）+ 生成前内容安全审核 + 生成管线（TTS → ffmpeg → R2）—— 已完成（代码全链 + 门控 E2E 待 DEEPSEEK_API_KEY 实跑；真实扣费沿用 M1 核对注记）
- [ ] M5：认证与数据层迁移——**better-auth 替换 Supabase Auth**（api 认证中间件 + studio auth 基建 + env 清理）+ 数据库切换 Railway Postgres（换连接串 + 跑迁移）工作台 SPA（录音引导 → 向导 → 发布）
- [ ] M6：内容站 SSR + RSS + 首页/搜索
- [ ] M7：邀请码 + Stripe 计费（**按脚本字数** + 5000 字上限校验 + 免费首期 + 对话级润色上限 5 版 + 包月订阅）—— 实现要点见 PRD §4.7：quota 判定从"期数制"改"字数制"（generate 读已存脚本统计字数扣减）；polish 输出截断兜底；润色限次按 `episodes.polish_count`（仅计 LLM 润色，手动保存不计）
- [ ] M8：E2E + 上线（邀请制）

## 约定

- 文档改动同步更新 AGENT.md 索引与里程碑
- 实现时所有供应商密钥经环境变量注入，不提交仓库
- 解析器新增平台：加 fixture 测试 + 更新 PRD §4.3 平台清单
- 前端样式/组件改动遵循「共享设计系统约束」章节；新增 UI 一律优先复用 `@dailogues/ui`
