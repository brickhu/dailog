# ARC — 技术架构

> 状态：MVP 设计稿（2026-08-02）
> 配套文档：[PRD.md](./PRD.md)（产品与功能）· [MRD.md](./MRD.md)（市场与商业）· [AGENT.md](./AGENT.md)（项目总览）

## 1. 技术栈总览

| 层 | 选型 | 部署位置 |
|---|---|---|
| 工作台 SPA（app.dailog.fm） | SolidJS + Solid Router + StyleX | Cloudflare Pages（静态，免费） |
| 内容站 SSR（dailog.fm） | SolidStart（SSR）+ StyleX | Cloudflare Pages/Workers（免费） |
| 分享采集服务（extract.dailog.fm） | Node.js + TypeScript + Hono + undici（解析器 + 多通道重试） | **Railway**（独立 service；平台规则变化只更新此服务） |
| 统一后端（api.dailog.fm） | Node.js + TypeScript + Hono + Drizzle ORM + fluent-ffmpeg | **Railway**（Git 集成自动部署，Docker，按用量约 $5–10/月） |
| 数据库 | Railway Postgres（纯 Postgres 用法：Drizzle + postgres.js 直连） | Railway（与后端同平台，~$5–15/月） |
| 认证 | **better-auth**（自托管：邮箱 + 密码 + 会话，跑在统一后端内） | $0 无外部依赖（邮件验证可后接 Resend 免费额度） |
| 对象存储 | Cloudflare R2（音频/封面/录音样本） | R2 免费 10GB + 流量永久免费 |
| LLM（质量审核 + 润色 + 语言检测） | **DeepSeek**（OpenAI 兼容接口，配置化可切换） | 外部按量（成本低） |
| 语音合成 | Fish Audio TTS（多说话人 + 声音克隆） | 外部按量 |
| 支付 | Stripe Checkout / Portal / Webhook | 外部，费率 2.9% + $0.30/笔 |

## 2. 部署拓扑

> **双环境**（2026-08-03）：`dev` 分支集成部署到开发环境（Railway Development 环境 + CF Pages project `dailog-studio-dev`），`master` 部署到生产。开发环境域名：`gracious-caring-development.up.railway.app`（API，Railway 默认 URL）/ `app.candelbot.app` / `candelbot.app`（SSR，预留）；生产域名待定（`dailog.fm` 或 `dailog.fm`）。拓扑图按生产形态绘制，开发环境结构相同、域名与实例不同。

```
         ┌──────────────────────── 用户（浏览器） ────────────────────────┐
         │  粘贴 AI 对话分享链接（claude.ai/share/*、chatgpt.com/share/*…）│
         │  → 工作台预览确认（/import）                                   │
         └─────────────────────────────┬──────────────────────────────────────┘
                                       │ POST /api/share/collect（转发，鉴权复用）
                                       ▼
                          share-collect（extract.dailog.fm，独立服务）
                                       ▼
                        ┌─────────────────────────────────────────┐
                        │            dailog.fm                 │
                        │   Cloudflare Pages/Workers (SSR, 免费)  │
                        │   首页浏览 / 频道页 / 节目页 / RSS / 搜索  │
                        └──────────────┬──────────────────────────┘
                                       │
app.dailog.fm (SPA, SolidJS+StyleX) │         R2 (音频/封面/样本)
  Solid Router, 静态部署在 CF Pages     │         ┌──────────────┐
  接收采集 → 润色编辑 → 生成 → 发布      └────────►│  *.mp3 / png │
                                       │         └──────────────┘
                              ┌────────▼─────────┐
                              │ api.dailog.fm │
                              │  统一后端 (Railway, Docker)            │
                              │  · imports 接收（采集确认后入库）   │
                              │  · LLM 润色(SSE 流式)             │
                              │  · 生成管线(TTS→ffmpeg→R2)        │
                              │  · 配额 / Stripe / 邀请码          │
                              └────────┬─────────────────────────┘
                                       │
                        ┌──────────────▼──────────────┐
                        ┌──────────────▼──────────────┐
                        │ Railway Postgres（~$5–15/月） │
                        │  Postgres + better-auth 用户   │
                        │  用户/邀请码/节目/脚本/任务/订阅 │
                        └─────────────────────────────┘
```

**数据流向**：用户粘贴分享链接 → share-collect 服务解析（extract.dailog.fm）→ 工作台预览确认 → 统一后端落库；SPA 与 SSR 站读 Railway Postgres（内容站直连读库，只读查询；无 RLS，靠查询层约束）；统一后端是唯一写方；音频资产全部在 R2。

## 3. 统一后端（services/api）

### 3.1 技术选型

- Node.js + TypeScript + **Hono**（轻量路由，SSE/流式友好）
- **Drizzle ORM** + Railway Postgres（迁移 + 类型安全）
- **fluent-ffmpeg**（片头/主对话/片尾拼接；镜像内置 ffmpeg）
- LLM：**DeepSeek**（OpenAI 兼容 SDK），默认 `deepseek-chat`（质量审核 + 润色 + 语言检测；`deepseek-reasoner` 作为备选可切换），供应商配置化（`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`）
- 认证：**better-auth**（自托管，邮箱 + 密码 + 会话；后端中间件验证会话，不再依赖外部 auth 平台）
- 任务队列：**进程内队列 + `generation_jobs` 表**（MVP 不引 Redis；进程重启时从 DB 恢复 `queued` 任务，单实例串行消费）

### 3.2 API 端点

| 方法/路径 | 认证 | 作用 |
|---|---|---|
| `GET /health` | — | 健康检查（Railway healthcheckPath） |
| `POST /api/auth/*` | — | **better-auth 会话路由**（注册/登录/登出/会话；注册含邀请码校验） |
| `GET /api/me` | ✓ | 当前用户（认证中间件验证） |
| `POST /api/imports` | ✓ | 接收结构化对话（扩展回传/分享链接采集确认）→ 落库（imports + draft episode 同事务），返回 `{ importId, episodeId }` |
| `POST /api/share/collect` | ✓ | 分享链接采集转发：调 share-collect 独立服务（`SHARE_COLLECT_URL`）→ 透传 dialogue/错误 |
| `POST /api/episodes/:id/polish` | ✓ | SSE 流式润色：先质量审核（轻量 LLM 预检，不达标返回 422 + 原因）→ 语言检测 → 流式返回脚本段落 |
| `POST /api/episodes/:id/generate` | ✓ | **脚本内容安全审核**（DeepSeek，拒绝 422 + 原因且不扣配额）→ 配额校验 → 建 job → 后台执行 |
| `GET /api/episodes/:id/job` | ✓ | 轮询生成进度（阶段 + 百分比） |
| `POST /api/episodes/:id/publish` | ✓ | 发布（`is_public=true`）→ 触发邀请码发放 |
| `POST /api/me/voice-sample` | ✓ | 上传/重录录音样本（R2 + 基础质量校验） |
| ~~`GET /api/public/episodes/:id/dialogue`~~ | 预留 | 节目页"查看原文"（未来）：对话全文 + 来源元数据。内容站 SSR 直连读库（`repo.episodes.getPublishedDialogue`，仅 `is_public=true`、草稿不可见）；如需 HTTP 公开端点再按此形态暴露（无鉴权） |
| `POST /api/billing/checkout` | ✓ | 创建 Stripe Checkout 会话 |
| `POST /api/billing/portal` | ✓ | 创建 Stripe 管理门户会话 |
| `POST /api/stripe/webhook` | 签名 | 订阅状态同步（`customer.subscription.*`） |

### 3.3 生成管线

```
queued → tts → merge → upload → done（failed 可重试）
```

**生成前内容安全审核**：`generate` 入口先对最新脚本版本做 DeepSeek 安全审核（色情/违法/仇恨/诈骗等）——拒绝则返回 422 + 原因、**不创建 job、不扣配额**。质量门/安全门的审核结果当前仅以 422 + reason 返回、不落库（`episodes.quality_status/quality_reason` 字段已在 schema 预留，语义 = 最近一次审核结果，待前端展示时启用）。

1. **TTS = Fish Audio（决策定稿，`docs/spikes/tts-comparison.md`；集成形态已实测，`docs/spikes/fish-audio.md`）**：核心刚需 = 即时克隆（录音样本上传后即时可用：fast 音色模型 5–8s，或零样本按需——参考音频随请求携带；重录即时生效，**实测通过**）——
   - **多说话人一次调用（实测可用）**：`text` 内嵌 `<|speaker:0|>` / `<|speaker:1|>` 标签 + `reference_id` 数组（下标对应 speaker 序号）——**不是 text/chunks 数组**（旧计划假设有误）；仅 S2-Pro 系模型支持（`s2-pro` / `s2.1-pro*`，`s1` 不行）；单次调用返回一条 mp3（实测 6 段对话 = 27.6s 单文件）
   - 主持人音色：voice-sample 上传后经 `POST /model` 建 fast 音色模型（训练 5–8s，免费，`_id` 存 `voice_samples.reference_id`）；创建失败降级**零样本按需克隆**：参考音频随请求携带（**必须 msgpack**——`application/msgpack` + `references: [{audio: 原始音频字节, text: 转录}]`，JSON 无 base64 字段、无法携带原始音频）；重录即时生效
   - 嘉宾固定音色：音色库 `GET /model?language=zh`（或控制台 Voice Library）取模型 `_id` 存为 `reference_id`
   - **混合模式限制（实测）**：一次多说话人调用不能混用「主持人内联 references + 嘉宾固定 `reference_id`」（只支持全模型 id 或全内联两种纯模式）→ **实测 fallback = 按段合成**：主持人/嘉宾音色模型任一缺失时，逐段调用 `synthesizeSingle`（host 段 msgpack 内联零样本、guest 段固定 `reference_id`，均缺失时用默认音色），ffmpeg 按段拼接；需单次混排可先建主持人音色模型（`POST /model`，fast 5–8s，免费）走全 `reference_id` 数组
   - 单请求字符上限：实测 12000 中文（36000 UTF-8 字节）未命中上限，未再上探；语速 ≈7.2 字/秒
   - 一致性：默认 `temperature=0.7` 且 schema 无 `seed`，同文本两次合成时长波动 ~12%（实测区间 ~12–46%）——可接受但需注意；长节目需稳定节奏可调低 temperature（0.3 量级）或按段重试
   - 计费：**$15/百万 UTF-8 字节**（按输入文本字节计费，中文 1 字 3 字节，10 分钟 ≈ ¥0.97）；免费模型 `s2.1-pro-free`（$0）实测全功能可用——测试/onboarding 用
   - 超长保护：润色以**单期 5–10 分钟**（约 1200–3000 字）为目标压缩；脚本上限 80 段
   - 失败：每批重试 2 次（指数退避）
   - **备选切换预案**（触发条件：成本超标/音质/合规）：讯飞一句话复刻（¥2.3 训练 + ¥1.15/万字符）、火山声音复刻（5 秒级）、MiniMax、自部署 CosyVoice2（Apache-2.0，规模后迁移路径）——TTS 层保持供应商抽象
2. **合并**：ffmpeg 拼接 `intro.{lang}.mp3 + 主对话 + outro.{lang}.mp3`（中/英两套固定片头片尾，按对话语言选择），段间 300ms 自然间隔
3. **上传**：后端持 CF 凭证直传 R2 → 更新 `episodes.audio_url` / `duration_seconds` → job `done`

### 3.4 配额与邀请码发放

- **计费单位 = 脚本字数**（与 LLM/TTS 成本线性对齐）：`generate` 入口先做脚本内容安全审核（422 不扣配额）→ **脚本字数校验（硬上限 5000 字，超限 400/422 提示精简）** → 配额判定（服务端）：
  - 免费用户**首期 0 扣费**；之后按 `credit_balance` **按脚本字数扣减**（余额不足 → 403 + 购买/订阅引导）
  - 按期付费用户按 `credit_balance` 扣减；订阅用户无限
  - 扣减字数 = 最新脚本版本总字符数（generate 时读库统计，无需额外 LLM 调用）
- **润色免费（获客漏斗）**：质量门（低质对话 422）过滤垃圾输入；**对话级润色上限：每对话最多 5 个脚本版本**（=5 次润色调用，`episodes.polish_count` 计数，仅计 LLM 润色、手动保存不计；pro 不限；超限 429；配置化）+ 单次输入对话量上限，防规模化白嫖；单次润色成本约 ¥0.04；重新润色支持**方向指示**（instruction 拼入 prompt），有未保存手动改动时先确认
- 发布时发放邀请码：已发布期数 > 3 起，每发布一期 +1 码（`source=reward`，**前 3 期不补发**），见 PRD §4.1

### 3.5 采集与导入（分享链接采集服务）

- **统一采集器（服务端 `share-collect`，`extract.dailog.fm`）**：用户粘贴 AI 平台对话**分享链接** → 服务端按平台解析（公开接口 / SSR 内嵌数据 / RSC payload / batchexecute RPC）→ 结构化对话 → 经 `POST /api/share/collect`（API 转发，鉴权复用）→ 工作台预览确认 → `POST /api/imports` 入库
- **元数据**：`{ platform, conversation_id, title, url, messages[] }`——标题取分享页元数据预填节目名；`(user_id, platform, conversation_id)` 唯一约束防重复导入；播放页展示来源信息
- **平台通道（实测全通，`services/share-collect`）**：

| 平台 | 可行性 | 关键适配 |
|---|---|---|
| Claude | **高（首批）** | `[data-testid="user-message"]` + `[data-is-streaming]` 判角色；无虚拟化公开证据；**页面 CSP 阻止 content script 外发 fetch → 回传必须走 background service worker** |
| DeepSeek | **高（首批）** | `.ds-markdown` 产品前缀稳定；**虚拟列表必做滚动采集**（>50 轮直接复制可见区丢 ~30% 历史的坑） |
| ChatGPT | 中~高 | `data-message-author-role` 多年稳定；原生虚拟化：边滚边采 + 记录 offsetTop 排序 + `data-message-id` 去重 + 空块内容校验 |
| Gemini | 中 | 自定义元素 `user-query`/`model-response` 较稳；Angular class 混淆频繁，禁用 class 依赖 |
| Kimi | 中~低 | 类名/哈希约 24h 轮换；首选内部 API（`/api/user/v6/chat/message/{chat_id}`）或通用 DOM 引擎 |
| 豆包 | 中~低 | 虚拟列表强截断；首选 hook `POST /im/chain/single` API（登录态 XHR 注入） |
| 通义 | 低 | 无公开稳定选择器、会话路由格式未知；备选官方数据导出（24h 邮箱 ZIP） |

- **通道重试链**：直连 → ScraperAPI（CF 挑战兜底，免费额度内）→ Web Unlocker → CF Worker → socks 代理池——数据中心 IP 直连 claude.ai 被 CF 拦（新加坡/美区实测 403），ScraperAPI 实测全通
- **真实性 = 分享页公开数据**：分享链接为平台公开内容，无需登录态；采集服务无鉴权（内部服务，经 API 转发调用）
- **采集服务定位 = 独立部署的解析器**：只做「采集 → 结构化对话」，编辑/生成/发布全部在 SPA 工作台完成；平台规则变化只更新 `services/share-collect` 重新部署，不影响主站
- ~~浏览器扩展采集（Manifest V3 登录态 DOM 采集）~~：**已停用**——源码保留在 `apps/extension`（含各平台 DOM 解析器、滚动采集、主世界 hook），不再作为导入通道；`docs/spikes/chat-dom.md` 为历史勘察记录

## 4. 数据模型（Railway Postgres）

| 表 | 关键字段 |
|---|---|
| `profiles` | `id`(=auth.users), `username`(唯一), `display_name`, `bio`, `plan`(free/pro), `credit_balance`(int, 按期付费余额), `created_at` |
| `voice_samples` | `user_id`, `audio_url`(R2), `reference_id`（已废弃——不再训练音色模型，样本直传模式；`transcript` 为朗读固定文案，零样本克隆用）, `duration`, `status`, `created_at`（可重录覆盖） |
| `invite_codes` | `code`(唯一), `created_by`, `used_by`, `used_at`, `expires_at`, `source`(admin/reward), `issued_for_episode_id` |
| `imports` | `user_id`, `platform`(chatgpt/claude/kimi/doubao/tongyi/gemini/deepseek/plain), `source_title`, `source_conversation_id`, `source_url`, `raw_content`, `parsed_dialogue`(JSONB), `status`, `created_at`；唯一约束 `(user_id, platform, source_conversation_id)` 防重复导入 |
| `episodes` | `id`, `user_id`, `import_id`（来源导入，polish 质量门经它读 `parsed_dialogue`，迁移 0001）, `slug`, `title`, `description`, `cover_url`, `audio_url`, `duration_seconds`, `status`(draft/generating/published/failed), `quality_status`(pending/passed/rejected), `quality_reason`, `language`, `is_public`, `created_at`, `published_at` |
| `scripts` | `episode_id`, `version`, `segments`(JSONB: `[{speaker: host\|guest, text}]`), `created_at` |
| `generation_jobs` | `episode_id`, `status`(queued/tts/merge/upload/done/failed), `progress`, `error`, `attempts`, `timestamps` |
| `payments` | `user_id`, `stripe_session_id`, `amount`, `episodes_granted`, `status`, `created_at`（按期付费购买记录） |
| `subscriptions` | `user_id`, `stripe_customer_id`, `stripe_subscription_id`, `plan`, `status`, `current_period_end` |

**R2 存储路径（目录规划 v2，2026-08-04）**：
```
voices/{user_id}.webm                            ← 用户录音样本（MediaRecorder 实际输出 webm；覆盖更新）
episodes/{user_id}/{episode_id}.mp3              ← 生成产物（不可变）
imports/{import_id}.dialogue.json                ← 原始对话（meta 存库，内容在 R2；key 由 importId 推导）
imports/{import_id}.raw.json                     ← 原始导出全文（分享链接采集原始数据，预留）
covers/{user_id}/{episode_id}.jpg                ← 封面图（预留）
assets/guest-voice-zh.mp3 等                     ← 平台资产（嘉宾音色按语言；热更新无需部署）
```
**存储决策**（二进制/大文件 → R2；结构化/可查询文本 → 数据库）：
- 语音样本/播客音频/封面/原始对话/平台资产 → R2
- 脚本 segments（jsonb）/ 对话 meta（imports 表）→ 数据库（查询、关联、事务）
- 本地开发也用 R2（STORAGE_DRIVER=r2 + R2_PROXY_URL socks 代理；大陆网络直连 R2 握手失败）

## 5. 前端

### 5.1 工作台 SPA（apps/studio）

- Vite + SolidJS + Solid Router + StyleX（Babel/Oxc 插件接入）
- 页面：auth / onboarding-voice / dashboard / episodes-new（四步向导）/ settings
- 封面 v1：服务端代码模板生成（标题文字 + 渐变 SVG→PNG，零成本），用户可上传自定义图

### 5.2 内容站 SSR（apps/site）

- SolidStart + Cloudflare adapter，SSR 部署于 CF Pages/Workers
- 路由：`/`（最新/热门/搜索）、`/@username`（频道页）、`/episode/:id`（单集页，id = 节目短 ID）、`/@username/feed.xml`（RSS）
- RSS：itunes 元数据 + 封面 + 节目列表；feed 响应加 CF 短 TTL 缓存（防高频拉取）
- 直连 Railway Postgres 读公开数据（只读查询 + 服务端只暴露公开字段）

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
| Railway Postgres（统一后端 + 数据库 + Auth） | DB ~$5–15/月；Auth（better-auth 自托管）$0 |
| Railway（统一后端） | 按用量约 $5–10/月（小规格常驻服务；Git 集成自动部署） |
| LLM 润色 | 按量，每期约几美分 |
| Fish Audio | 按量（$15/百万 UTF-8 字节，中文 1 字 3 字节；10 分钟期 ≈ ¥0.97，实测见 `docs/spikes/fish-audio.md`） |
| Stripe | 2.9% + $0.30/笔 |

超出免费额度的触发点：R2 >10GB；Railway（API+DB）随用量线性增长（可设用量上限告警）。

## 8. 测试策略

- **采集服务解析器（`services/share-collect`）**：每平台解析器纯函数单测（值表解码/多层转义/BigInt 清洗/双格式流式响应等，10 用例）
- **管线**：mock LLM / mock Fish Audio 集成测试；ffmpeg 拼接 golden 文件对比（时长/字节）
- **规则单测**：配额判定、邀请码发放（>3 期规则）、订阅状态机
- **API 契约**：Vitest + Hono app 直测
- **前端**：Vitest 组件测试（编辑器为重点）+ 1 条 Playwright E2E 主流程（注册→录音→导入→润色→生成→发布→播放）

## 9. 技术风险与前置 Spike

| 风险 | 缓解 |
|---|---|
| 多说话人混合模式受限（实测：一次调用不能混用「主持人内联零样本 + 嘉宾固定 `reference_id`」） | 设计定型：**按段 fallback**（host 段 msgpack 内联零样本 + guest 段固定音色逐段合成），ffmpeg 拼接（管线本就有）；需单次混排时先建主持人音色模型（`POST /model`，fast 5–8s，免费）走全 `reference_id` 数组 |
| Fish 免费/付费模型差异（spike 全程在 `s2.1-pro-free` 完成，0 额度账号无法直接观察扣费） | 计费口径 $15/百万 UTF-8 字节已由官方定价页确认；上线前用付费账号以 `GET /wallet/self/api-credit` 差值核对账单；克隆一致性默认波动 ~12%，长节目可调低 temperature |
| 平台 DOM 选择器基于公开逆向资料（`docs/spikes/chat-dom.md`，未登录态实测） | 各平台 content script 开发时逐一实测修正（每平台适配器交付即验证）；虚拟列表平台（ChatGPT/DeepSeek/Gemini/豆包）必须实现滚动采集循环 |
| Cloudflare/Turnstile 风控 | 数据中心 IP 直连 claude.ai 被 CF 拦（新加坡/美区/Workers 三路实测 403）；采集服务多通道重试兜底（ScraperAPI 实测全通，免费额度内） |
| 平台分享页改版 | 采集服务解析器需随平台数据结构变化维护（每平台一文件）；改版时只更新采集服务，主站不受影响 |
| ~~扩展商店审核~~ | ~~Chrome/Edge 上架~~：扩展已停用，无商店流程 |
| 克隆音色质量受录音环境影响 | 录音引导页质量校验（时长/响度/语音检测），可重录 |
| ffmpeg 在 256MB 机器上拼接大音频 | 单期时长限定 5–10 分钟，音频体量小，256MB 无压力 |
| LLM 供应商切换 | OpenAI 兼容接口 + 配置化，锁定成本 |
