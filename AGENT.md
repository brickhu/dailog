# AGENT — 项目总览

> 本项目所有文档的入口与汇总。任何 Agent / 协作者先读本文件。
> 最后更新：2026-08-03（M1-M4 已完成：spike 定稿 + 后端骨架 + 扩展采集器 + 生成管线全链代码；M4 门控 E2E 待 DEEPSEEK_API_KEY 实跑；商店上架与 M5+ 排期中）

## 项目一句话

**dailogues**：把用户与 AI 的对话一键发布为二人对谈播客（用户 = 主持人，克隆音色；AI = 嘉宾，固定音色），每个用户一个可订阅的播客频道（播放页 + RSS）。

## 文档索引

| 文档 | 内容 | 状态 |
|---|---|---|
| [PRD.md](./PRD.md) | 产品设计与功能：流程、MVP 功能清单、页面、边界 | ✅ 已确认 |
| [ARC.md](./ARC.md) | 技术架构：栈、拓扑、API、管线、数据模型、成本、测试 | ✅ 已确认 |
| [MRD.md](./MRD.md) | 产品定位、市场策略、商业模式、竞争优势、风险 | 🟡 初稿待审（市场部分为起草） |

## 工程目录参考（monorepo，待实施）

```
dailogues/
├── apps/
│   ├── studio/                 # app.dailogues.com — 工作台 SPA
│   │   ├── src/pages/          #   auth / onboarding-voice / dashboard / episodes-new / settings
│   │   └── src/components/     #   录音器、导入结果、润色编辑器、生成进度、发布表单
│   ├── site/                   # dailogues.com — 内容分发 SSR（SolidStart + CF adapter）
│   │   └── src/routes/         #   /(首页) /episode/:id(单集页) /@username /@username/feed.xml
│   └── extension/              # 采集扩展（Manifest V3，Chrome/Edge 商店）— 统一导入通道
│       ├── manifest.json       #   content_scripts 按平台 URL 匹配 + background 权限
│       ├── src/content/        #   按平台采集器：claude.ts / deepseek.ts / chatgpt.ts / ...
│       │   └── core.ts         #   虚拟列表滚动循环 + MutationObserver + 去重排序
│       ├── src/background.ts   #   service worker：接收 content 消息 → POST api.dailogues.com
│       └── src/shared.ts       #   采集协议类型（platform/conversation_id/title/url/messages[]）
├── services/
│   └── api/                    # api.dailogues.com — 统一后端（Railway，Node + Hono）
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
| 后端 API | `api.candelbot.app`（Railway Development 环境） | `api.dailogues.com`（Railway Production 环境）⚠️ 生产域名待定：`dailog.fm` 或保留 `dailogues.com` |
| 工作台 SPA | `app.candelbot.app`（CF Pages project `dailogues-studio-dev`，production branch = dev） | `app.dailogues.com`（CF Pages project `dailogues-studio`，production branch = master） |
| 内容站 SSR | `candelbot.app`（Pages project 预留，等 apps/site 创建） | `dailogues.com`（Pages/Workers） |
| Postgres | Railway Development 环境内独立实例 | Railway Production 环境内实例 |
| 采集扩展 | `pnpm build:dev`（API 指向 api.candelbot.app；popup 可覆盖） | `pnpm build`（API 指向 api.dailogues.com） |

> **品牌名**：`dailogues`——由 `dialogues` 交换 `ia→ai` 变形（寓意 AI）。开发域名 `candelbot.app`（已确认），生产域名待定（`dailog.fm` / `dailogues.com`），定稿后统一替换文档与扩展 manifest 中的占位。

## 技术要点速查

- 前端：SolidJS + Solid Router + StyleX（两站共用设计 token）
- 后端：Node + TypeScript + Hono + Drizzle + fluent-ffmpeg
- 认证：**better-auth**（自托管邮箱+密码会话，后端中间件验证）；注册需邀请码
- 生成管线：TTS = **Fish Audio**（形态已实测，`docs/spikes/fish-audio.md`）——**多说话人一次调用**：`text` 内嵌 `<|speaker:N|>` 标签 + `reference_id` 数组（**非 text/chunks 数组**）；主持人零样本克隆走 **msgpack `references` 内联音频**（JSON 无 base64 字段、带不了原始音频）；**混合模式受限**（一次调用不能混用内联 + 固定 id）→ 按段 fallback（host 段 msgpack 内联零样本 + guest 段固定音色逐段合成，实测形态）+ ffmpeg 拼接；单请求 ≥12000 中文未触上限；免费模型 `s2.1-pro-free`（$0）可用；默认 `temperature=0.7` 一致性波动 ~12%（可接受）→ ffmpeg 拼接固定片头片尾 → R2；备选切换预案见 ARC §3.3 / `docs/spikes/tts-comparison.md`
- 后端 LLM：**DeepSeek**（OpenAI 兼容，`deepseek-chat` 默认，配置化可切换）
- 润色：LLM SSE 流式；**打磨前质量审核前置** + **生成前内容安全审核**（编辑后脚本提交生成时，DeepSeek 安全审核通过才合成，拒绝不扣配额）；语言跟随对话内容（与界面语言无关）；单期目标 5–10 分钟
- 计费：Stripe Checkout/Portal/Webhook；**按脚本字数计费**（LLM/TTS 成本随字数线性，对齐成本结构）；**脚本硬上限 5000 字**；润色免费（获客）+ 免费用户每日限 3 次；免费首期 0 扣费；Pro 订阅无限
- 导入：**浏览器扩展统一采集**（登录态下读取本人对话，含元数据：标题/对话ID/平台/原始链接，无验证码、无分享链接）；**平台分级（`docs/spikes/chat-dom.md`）**：首发 Claude/DeepSeek（高），次批 ChatGPT（中~高），Gemini（中）/Kimi、豆包（中~低）/通义（低）按需；虚拟列表平台（ChatGPT/DeepSeek/Gemini/豆包）走**滚动采集循环 + 去重**；元数据取 URL + `document.title`；回传统一走 **background service worker**（Claude CSP）；**扩展定位=采集器（thin）**，创作发布仍在 SPA
- 邀请码：管理员 CLI + 用户奖励（>3 期后每发布一期 +1）
- 成本策略：除 LLM/TTS/Stripe 外：CF/R2 免费 + better-auth $0；Railway（API+DB）约 $10–25/月

## 里程碑

- [ ] M0：文档定稿（PRD/ARC/MRD 审阅通过）
- [x] M1：Fish Audio 集成 spike（多说话人格式、单请求限额、克隆音质、计费实测）—— 已完成（`docs/spikes/fish-audio.md`；真实扣费金额上线前用付费账号核对）
- [x] M2：统一后端骨架（Hono + Drizzle + 9 表迁移 + 本地 Postgres 集成测试 + JWT 认证 + Docker/Railway 配置 + CI）—— 代码完成，**待用户：GitHub 仓库推送 + Railway（Postgres + 应用）绑定部署**
- [x] M3：浏览器扩展采集器（Manifest V3，首发 Claude/DeepSeek）—— 已完成（fixture 基于公开资料，待真实登录态页面校准，见 `docs/spikes/chat-dom.md` 待实测清单）
- [x] M4：质量审核 + 润色（LLM 流式）+ 生成前内容安全审核 + 生成管线（TTS → ffmpeg → R2）—— 已完成（代码全链 + 门控 E2E 待 DEEPSEEK_API_KEY 实跑；真实扣费沿用 M1 核对注记）
- [ ] M5：认证与数据层迁移——**better-auth 替换 Supabase Auth**（api 认证中间件 + studio auth 基建 + 扩展 token 注入 + env 清理）+ 数据库切换 Railway Postgres（换连接串 + 跑迁移）工作台 SPA（录音引导 → 向导 → 发布）
- [ ] M6：内容站 SSR + RSS + 首页/搜索
- [ ] M7：邀请码 + Stripe 计费（**按脚本字数** + 5000 字上限校验 + 免费首期 + 润色限次 3/日 + 包月订阅）—— 实现要点见 PRD §4.7：quota 判定从"期数制"改"字数制"（generate 读已存脚本统计字数扣减）；polish 输出截断兜底；润色限次计数（DB/内存，配置化）
- [ ] M8：E2E + 上线（邀请制）

## 约定

- 文档改动同步更新 AGENT.md 索引与里程碑
- 实现时所有供应商密钥经环境变量注入，不提交仓库
- 解析器新增平台：加 fixture 测试 + 更新 PRD §4.3 平台清单
