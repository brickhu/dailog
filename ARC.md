# ARC — 技术架构

> 状态：MVP 设计稿（2026-08-02）
> 配套文档：[PRD.md](./PRD.md)（产品与功能）· [MRD.md](./MRD.md)（市场与商业）· [AGENT.md](./AGENT.md)（项目总览）

## 1. 技术栈总览

| 层 | 选型 | 部署位置 |
|---|---|---|
| 工作台 SPA（app.dailogues.com） | SolidJS + Solid Router + StyleX | Cloudflare Pages（静态，免费） |
| 内容站 SSR（dailogues.com） | SolidStart（SSR）+ StyleX | Cloudflare Pages/Workers（免费） |
| 统一后端（api.dailogues.com） | Node.js + TypeScript + Hono + Drizzle ORM + fluent-ffmpeg | Fly.io 免费配额（Docker，256MB 机器，空闲休眠） |
| 数据库 | Supabase Postgres | Supabase 免费额度（500MB） |
| 认证 | Supabase Auth（邮箱 + 密码，邀请码门禁） | Supabase 免费额度（5 万 MAU） |
| 对象存储 | Cloudflare R2（音频/封面/录音样本） | R2 免费 10GB + 流量永久免费 |
| LLM（质量审核 + 润色 + 语言检测） | **DeepSeek**（OpenAI 兼容接口，配置化可切换） | 外部按量（成本低） |
| 语音合成 | Fish Audio TTS（多说话人 + 声音克隆） | 外部按量 |
| 支付 | Stripe Checkout / Portal / Webhook | 外部，费率 2.9% + $0.30/笔 |

## 2. 部署拓扑

```
                        ┌─────────────────────────────────────────┐
                        │            dailogues.com                 │
                        │   Cloudflare Pages/Workers (SSR, 免费)  │
                        │   首页浏览 / 频道页 / 节目页 / RSS / 搜索  │
                        └──────────────┬──────────────────────────┘
                                       │
app.dailogues.com (SPA, SolidJS+StyleX) │         R2 (音频/封面/样本)
  Solid Router, 静态部署在 CF Pages     │         ┌──────────────┐
  导入 → 润色编辑器 → 生成 → 发布        └────────►│  *.mp3 / png │
                                       │         └──────────────┘
                              ┌────────▼─────────┐
                              │ api.dailogues.com │
                              │  统一后端 (Fly.io 免费配额, Docker) │
                              │  · 导入解析器(可插拔)              │
                              │  · LLM 润色(SSE 流式)             │
                              │  · 生成管线(TTS→ffmpeg→R2)        │
                              │  · 配额 / Stripe / 邀请码          │
                              └────────┬─────────────────────────┘
                                       │
                        ┌──────────────▼──────────────┐
                        │ Supabase (免费)              │
                        │  Postgres + Auth             │
                        │  用户/邀请码/节目/脚本/任务/订阅 │
                        └─────────────────────────────┘
```

**数据流向**：SPA 与 SSR 站读 Supabase（内容站直连读库，不走统一后端）；统一后端是唯一写方；音频资产全部在 R2。

## 3. 统一后端（services/api）

### 3.1 技术选型

- Node.js + TypeScript + **Hono**（轻量路由，SSE/流式友好）
- **Drizzle ORM** + Supabase Postgres（迁移 + 类型安全）
- **fluent-ffmpeg**（片头/主对话/片尾拼接；镜像内置 ffmpeg）
- LLM：**DeepSeek**（OpenAI 兼容 SDK），默认 `deepseek-chat`（质量审核 + 润色 + 语言检测；`deepseek-reasoner` 作为备选可切换），供应商配置化（`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`）
- 认证：校验 Supabase JWT（JWKS 拉取公钥），RBAC 仅区分 `authenticated`
- 任务队列：**进程内队列 + `generation_jobs` 表**（MVP 不引 Redis；进程重启时从 DB 恢复 `queued` 任务，单实例串行消费）

### 3.2 API 端点

| 方法/路径 | 认证 | 作用 |
|---|---|---|
| `POST /api/imports` | ✓ | 提交分享链接 → 抓取器（按平台 API 模式）→ 验证码校验 → 解析器 → `parsed_dialogue` 落库，返回结构化对话 |
| `POST /api/episodes/:id/polish` | ✓ | SSE 流式润色：先质量审核（轻量 LLM 预检，不达标返回 422 + 原因）→ 语言检测 → 流式返回脚本段落 |
| `POST /api/episodes/:id/generate` | ✓ | 配额校验 → 建 job → 后台执行 |
| `GET /api/episodes/:id/job` | ✓ | 轮询生成进度（阶段 + 百分比） |
| `POST /api/episodes/:id/publish` | ✓ | 发布（`is_public=true`）→ 触发邀请码发放 |
| `POST /api/me/voice-sample` | ✓ | 上传/重录录音样本（R2 + 基础质量校验） |
| `POST /api/billing/checkout` | ✓ | 创建 Stripe Checkout 会话 |
| `POST /api/billing/portal` | ✓ | 创建 Stripe 管理门户会话 |
| `POST /api/stripe/webhook` | 签名 | 订阅状态同步（`customer.subscription.*`） |

### 3.3 生成管线

```
queued → tts → merge → upload → done（failed 可重试）
```

1. **TTS**：主对话一次 **Fish Audio 多说话人调用**（chunks 数组，每段指定说话人）——
   - 主持人段：`reference_audio` = 用户录音样本（实时克隆）
   - 嘉宾段：平台固定音色 `reference_id`
   - 超长保护：润色以**单期 5–10 分钟**（约 1200–3000 字）为目标压缩；脚本上限 80 段；若超 Fish Audio 单请求字符限额则按批调用（批间靠 ffmpeg 拼接兜底）
   - 失败：整次重试 2 次（指数退避）
2. **合并**：ffmpeg 拼接 `intro.{lang}.mp3 + 主对话 + outro.{lang}.mp3`（中/英两套固定片头片尾，按对话语言选择），段间 300ms 自然间隔
3. **上传**：后端持 CF 凭证直传 R2 → 更新 `episodes.audio_url` / `duration_seconds` → job `done`

### 3.4 配额与邀请码发放

- 配额判定在 `generate` 入口（服务端）：免费用户累计生成 ≥1 期 → 403；按期付费用户按 `credit_balance` 扣减；订阅用户无限。额度不足 → 403 + 购买/订阅引导
- 发布时发放邀请码：已发布期数 > 3 起，每发布一期 +1 码（`source=reward`，**前 3 期不补发**），见 PRD §4.1

### 3.5 抓取与验证（URL-only 导入，双路径）

- **快路径 `api-fetcher`**：按平台内置 API 模式——从分享 URL 提取 share_id → 调已知 API（浏览器头模板：UA/Referer/sec-ch-ua）→ 结构化对话。DeepSeek 已验证（`GET /api/v0/share/content?share_id=`，无需登录）；豆包/Kimi/通义大概率可行，ChatGPT 待 spike 实测
- **慢路径 = 浏览器扩展（用户侧采集，spike 实测定稿）**：用于 Cloudflare/Turnstile 质询平台（**Claude 必须**，ChatGPT 视实测）。用户打开分享页 → 扩展 content script 按平台解析 DOM → 回传平台校验。依据（实测 `docs/spikes/headless-cf.md`）：无头浏览器被 Turnstile 交互式质询拦截（70s 未通过、数据接口 403），云端无头方案不可行；扩展运行在用户真实浏览器（住宅 IP + 真实指纹），成功率接近 100%
- 扩展形态：Manifest V3（Chrome/Edge 商店上架），content script 按平台匹配（`claude.ai/share/*` 等），DOM 解析为结构化对话（含验证码匹配）→ POST 回 `api.dailogues.com`；会话鉴权用平台登录态（token 由 app 站点页注入 `chrome.storage`）；扩展只做「采集 + 回传」，不存储对话；商店审核周期纳入排期
- **验证码机制**：`POST /api/imports` 前先请求验证码（一次性，哈希存 `imports.verification_code_hash`）→ 用户"先发码、再分享"→ 抓取内容中匹配验证码 → `verified_at` 落库；不匹配返回 422 + 引导重试
- **反爬运维**：headers 模板配置化（sec-ch-ua 版本会过时）；单次抓取 + 缓存 + 限速；平台级故障返回明确错误并监控告警

## 4. 数据模型（Supabase Postgres）

| 表 | 关键字段 |
|---|---|
| `profiles` | `id`(=auth.users), `username`(唯一), `display_name`, `bio`, `plan`(free/pro), `credit_balance`(int, 按期付费余额), `created_at` |
| `voice_samples` | `user_id`, `audio_url`(R2), `duration`, `status`, `created_at`（可重录覆盖） |
| `invite_codes` | `code`(唯一), `created_by`, `used_by`, `used_at`, `expires_at`, `source`(admin/reward), `issued_for_episode_id` |
| `imports` | `user_id`, `source_type`(仅 link), `platform`(chatgpt/claude/kimi/doubao/tongyi/gemini/deepseek/plain), `verification_code_hash`, `verified_at`, `raw_content`, `parsed_dialogue`(JSONB), `status`, `created_at` |
| `episodes` | `id`, `user_id`, `slug`, `title`, `description`, `cover_url`, `audio_url`, `duration_seconds`, `status`(draft/generating/published/failed), `quality_status`(pending/passed/rejected), `quality_reason`, `language`, `is_public`, `created_at`, `published_at` |
| `scripts` | `episode_id`, `version`, `segments`(JSONB: `[{speaker: host\|guest, text}]`), `created_at` |
| `generation_jobs` | `episode_id`, `status`(queued/tts/merge/upload/done/failed), `progress`, `error`, `attempts`, `timestamps` |
| `payments` | `user_id`, `stripe_session_id`, `amount`, `episodes_granted`, `status`, `created_at`（按期付费购买记录） |
| `subscriptions` | `user_id`, `stripe_customer_id`, `stripe_subscription_id`, `plan`, `status`, `current_period_end` |

**R2 存储路径**：
```
audio/episodes/{user_id}/{episode_id}.mp3
audio/voices/{user_id}.wav
images/covers/{episode_id}.png
assets/intro.zh.mp3 / intro.en.mp3 / outro.zh.mp3 / outro.en.mp3   ← 固定片头片尾
```

## 5. 前端

### 5.1 工作台 SPA（apps/studio）

- Vite + SolidJS + Solid Router + StyleX（Babel/Oxc 插件接入）
- 页面：auth / onboarding-voice / dashboard / episodes-new（四步向导）/ settings
- 封面 v1：服务端代码模板生成（标题文字 + 渐变 SVG→PNG，零成本），用户可上传自定义图

### 5.2 内容站 SSR（apps/site）

- SolidStart + Cloudflare adapter，SSR 部署于 CF Pages/Workers
- 路由：`/`（最新/热门/搜索）、`/@username`（频道页）、`/@username/:slug`（节目页）、`/@username/feed.xml`（RSS）
- RSS：itunes 元数据 + 封面 + 节目列表；feed 响应加 CF 短 TTL 缓存（防高频拉取）
- 直连 Supabase 读公开数据（RLS 只读 + 服务端只暴露公开字段）

### 5.3 共享

- `packages/shared`：领域类型 + 设计 token（颜色/间距/字体），StyleX 编译时 CSS 两站共用

## 6. 计费集成

1. **按期付费**：SPA → `POST /api/billing/checkout`（one-time price）→ Stripe Checkout → webhook `checkout.session.completed` → 写 `payments` + `credit_balance` 增加
2. **包月订阅**：SPA → `POST /api/billing/checkout`（recurring price）→ webhook `customer.subscription.created/updated/deleted` → 同步 `subscriptions` → 更新 `profiles.plan`
3. 订阅取消/过期 → 自动降级 `free`；已购买额度与已发布内容保留

## 7. 成本模型（MVP 月度）

| 项 | 成本 |
|---|---|
| Cloudflare Pages/Workers + R2 | 免费（10GB 存储，流量免费） |
| Supabase（Postgres + Auth） | 免费（500MB / 5 万 MAU） |
| Fly.io（1 台 256MB 机器） | 免费配额内（3 台/3GB 卷/160GB 流量，空闲休眠） |
| LLM 润色 | 按量，每期约几美分 |
| Fish Audio | 按量（按字符） |
| Stripe | 2.9% + $0.30/笔 |

超出免费额度的触发点：R2 >10GB、Supabase >500MB、Fly 超配额（届时升 paid ~$5/月起）。

## 8. 测试策略

- **解析器**：每平台 1–2 个真实导出 fixture 快照测试
- **管线**：mock LLM / mock Fish Audio 集成测试；ffmpeg 拼接 golden 文件对比（时长/字节）
- **规则单测**：配额判定、邀请码发放（>3 期规则）、订阅状态机
- **API 契约**：Vitest + Hono app 直测
- **前端**：Vitest 组件测试（编辑器为重点）+ 1 条 Playwright E2E 主流程（注册→录音→导入→润色→生成→发布→播放）

## 9. 技术风险与前置 Spike

| 风险 | 缓解 |
|---|---|
| Fish Audio 多说话人请求格式/单请求限额不确定 | **首个实现任务：spike**——验证 chunks 格式、返回形态、批上限、克隆+固定音色混排音质 |
| Cloudflare/Turnstile 风控（Claude 等慢路径平台） | 已实测（`docs/spikes/headless-cf.md`）：无头浏览器被 Turnstile 拦截 → 慢路径定为**浏览器扩展**（用户侧真实浏览器）；扩展商店上架审核周期提前规划 |
| 克隆音色质量受录音环境影响 | 录音引导页质量校验（时长/响度/语音检测），可重录 |
| ffmpeg 在 256MB 机器上拼接大音频 | 单期时长限定 5–10 分钟，音频体量小，256MB 无压力 |
| LLM 供应商切换 | OpenAI 兼容接口 + 配置化，锁定成本 |
