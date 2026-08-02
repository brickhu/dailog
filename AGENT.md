# AGENT — 项目总览

> 本项目所有文档的入口与汇总。任何 Agent / 协作者先读本文件。
> 最后更新：2026-08-02（MVP 设计阶段，尚未有代码）

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
│   │   └── src/components/     #   录音器、对话导入、润色编辑器、生成进度、发布表单
│   └── site/                   # dailogues.com — 内容分发 SSR（SolidStart + CF adapter）
│       └── src/routes/         #   /(首页) /@username /@username/:slug /@username/feed.xml
├── services/
│   └── api/                    # api.dailogues.com — 统一后端（Fly.io，Node + Hono）
│       ├── src/
│       │   ├── routes/         #   imports / polish / generate / jobs / voice / billing / stripe-webhook
│       │   ├── parsers/        #   可插拔对话解析器（chatgpt/claude/kimi/doubao/tongyi/gemini/plain）
│       │   ├── pipeline/       #   生成管线（tts → merge → upload）
│       │   ├── tts/            #   Fish Audio 适配（多说话人 + 克隆）
│       │   ├── llm/            #   润色 + 语言检测（OpenAI 兼容，配置化）
│       │   ├── billing/        #   Stripe checkout/webhook/配额
│       │   └── db/             #   Drizzle schema + migrations（Supabase Postgres）
│       └── Dockerfile          #   含 ffmpeg
├── packages/
│   ├── shared/                 # 领域类型 + 设计 token（StyleX）
│   └── parsers/                # 解析器库（与 services/api 共用）
├── infra/
│   ├── fly/                    # fly.toml、Dockerfile
│   ├── cloudflare/             # wrangler.toml、Pages 配置、_routes.json
│   ├── github/workflows/       # CI/CD（build → deploy：Fly、CF Pages）
│   └── scripts/                # 管理员 CLI（生成邀请码等）
├── assets/
│   └── audio/                  # 固定片头片尾：intro.zh.mp3 / intro.en.mp3 / outro.zh.mp3 / outro.en.mp3
├── fixtures/                   # 解析器测试样本（各平台真实导出）
├── AGENT.md / PRD.md / ARC.md / MRD.md
```

## 域名与部署速查

| 域名 | 用途 | 托管 |
|---|---|---|
| `app.dailogues.com` | 工作台 SPA | Cloudflare Pages（静态） |
| `dailogues.com` | 内容站 SSR | Cloudflare Pages/Workers |
| `api.dailogues.com` | 统一后端 | Fly.io（免费配额，Docker + ffmpeg） |
| — | Postgres / Auth | Supabase（免费额度） |
| — | 音频存储 | Cloudflare R2（流量免费） |

> **品牌名**：`dailogues`——由 `dialogues` 交换 `ia→ai` 变形（寓意 AI）。域名统一为 `dailogues.com` 系列。

## 技术要点速查

- 前端：SolidJS + Solid Router + StyleX（两站共用设计 token）
- 后端：Node + TypeScript + Hono + Drizzle + fluent-ffmpeg
- 认证：Supabase Auth（JWT，后端 JWKS 校验）；注册需邀请码
- 生成管线：Fish Audio 多说话人一次调用（主持=克隆，嘉宾=固定）→ ffmpeg 拼接固定片头片尾 → R2
- 后端 LLM：**DeepSeek**（OpenAI 兼容，`deepseek-chat` 默认，配置化可切换）
- 润色：LLM SSE 流式；**打磨前质量审核前置**（低质量/信息量小/违规内容拒绝并返回原因）；语言跟随对话内容（与界面语言无关）；单期目标 5–10 分钟
- 计费：Stripe Checkout/Portal/Webhook；免费 1 期，Pro 订阅无限
- 导入：**浏览器扩展统一采集**（登录态下读取本人对话，无验证码、无分享链接）；首发平台 ChatGPT/Claude/豆包/DeepSeek；**扩展定位=采集器（thin）**，创作发布仍在 SPA
- 邀请码：管理员 CLI + 用户奖励（>3 期后每发布一期 +1）
- 成本策略：除 LLM/TTS/Stripe 外全免费（配额内）

## 里程碑

- [ ] M0：文档定稿（PRD/ARC/MRD 审阅通过）
- [ ] M1：Fish Audio spike（多说话人格式、克隆音质）—— 首个实现任务
- [ ] M2：统一后端骨架（Hono + Drizzle + 迁移 + CI/CD 部署 Fly）
- [ ] M3：浏览器扩展采集器（Manifest V3 + 按平台 content script，首发 Claude/DeepSeek）→ 商店上架
- [ ] M4：质量审核 + 润色（LLM 流式）+ 生成管线（TTS → ffmpeg → R2）
- [ ] M5：工作台 SPA（录音引导 → 向导 → 发布）
- [ ] M6：内容站 SSR + RSS + 首页/搜索
- [ ] M7：邀请码 + Stripe 计费（按期付费 + 包月订阅）
- [ ] M8：E2E + 上线（邀请制）

## 约定

- 文档改动同步更新 AGENT.md 索引与里程碑
- 实现时所有供应商密钥经环境变量注入，不提交仓库
- 解析器新增平台：加 fixture 测试 + 更新 PRD §4.3 平台清单
