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
| `POST /api/imports` | ✓ | 接收扩展回传的结构化对话（platform + 幂等票据）→ 落库，返回结构化对话 |
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

1. **TTS = Fish Audio（决策定稿，`docs/spikes/tts-comparison.md`；集成形态已实测，`docs/spikes/fish-audio.md`）**：核心刚需 = 即时克隆（零样本按需——参考音频随请求携带，无预注册/训练环节，重录即时生效，**实测通过**）——
   - **多说话人一次调用（实测可用）**：`text` 内嵌 `<|speaker:0|>` / `<|speaker:1|>` 标签 + `reference_id` 数组（下标对应 speaker 序号）——**不是 text/chunks 数组**（旧计划假设有误）；仅 S2-Pro 系模型支持（`s2-pro` / `s2.1-pro*`，`s1` 不行）；单次调用返回一条 mp3（实测 6 段对话 = 27.6s 单文件）
   - 主持人零样本克隆：**必须 msgpack**（`application/msgpack` + `references: [{audio: 原始音频字节, text: 转录}]`）——JSON 无 base64 字段、无法携带原始音频；重录即时生效
   - 嘉宾固定音色：音色库 `GET /model?language=zh`（或控制台 Voice Library）取模型 `_id` 存为 `reference_id`
   - **混合模式限制（实测）**：一次多说话人调用不能混用「主持人内联 references + 嘉宾固定 `reference_id`」（只支持全模型 id 或全内联两种纯模式）→ 一期若主持人零样本克隆 + 嘉宾固定音色，走**两条调用**：主持人零样本整段 + 嘉宾固定音色整段，ffmpeg 拼接（管线本就有）；需单次混排可先建主持人音色模型（`POST /model`，fast 训练 5–8s，免费）走全 `reference_id` 数组
   - 单请求字符上限：实测 12000 中文（36000 UTF-8 字节）未命中上限，未再上探；语速 ≈7.2 字/秒
   - 一致性：默认 `temperature=0.7` 且 schema 无 `seed`，同文本两次合成时长波动 ~12%（实测区间 ~12–46%）——可接受但需注意；长节目需稳定节奏可调低 temperature（0.3 量级）或按段重试
   - 计费：**$15/百万 UTF-8 字节**（按输入文本字节计费，中文 1 字 3 字节，10 分钟 ≈ ¥0.97）；免费模型 `s2.1-pro-free`（$0）实测全功能可用——测试/onboarding 用
   - 超长保护：润色以**单期 5–10 分钟**（约 1200–3000 字）为目标压缩；脚本上限 80 段
   - 失败：每批重试 2 次（指数退避）
   - **备选切换预案**（触发条件：成本超标/音质/合规）：讯飞一句话复刻（¥2.3 训练 + ¥1.15/万字符）、火山声音复刻（5 秒级）、MiniMax、自部署 CosyVoice2（Apache-2.0，规模后迁移路径）——TTS 层保持供应商抽象
2. **合并**：ffmpeg 拼接 `intro.{lang}.mp3 + 主对话 + outro.{lang}.mp3`（中/英两套固定片头片尾，按对话语言选择），段间 300ms 自然间隔
3. **上传**：后端持 CF 凭证直传 R2 → 更新 `episodes.audio_url` / `duration_seconds` → job `done`

### 3.4 配额与邀请码发放

- 配额判定在 `generate` 入口（服务端）：免费用户累计生成 ≥1 期 → 403；按期付费用户按 `credit_balance` 扣减；订阅用户无限。额度不足 → 403 + 购买/订阅引导
- 发布时发放邀请码：已发布期数 > 3 起，每发布一期 +1 码（`source=reward`，**前 3 期不补发**），见 PRD §4.1

### 3.5 采集与导入（浏览器扩展统一通道）

- **统一采集器（浏览器扩展）**：用户在 AI 平台**登录态**下打开自己的对话页 → 扩展自动滚动加载完整对话（虚拟列表）→ 按平台 DOM 解析为结构化对话 → POST `api.dailogues.com/imports`
- **元数据随采集回传**：`{ platform, conversation_id, title, url, messages[] }`——对话 ID 取自 URL 路径、标题取 `document.title`，预填节目名；`(user_id, platform, conversation_id)` 唯一约束防重复导入；播放页展示来源信息
- **平台可行性分级（DOM 勘察结论，`docs/spikes/chat-dom.md`；选择器基于公开逆向资料，各平台开发时逐一实测修正）**：

| 平台 | 可行性 | 关键适配 |
|---|---|---|
| Claude | **高（首批）** | `[data-testid="user-message"]` + `[data-is-streaming]` 判角色；无虚拟化公开证据；**页面 CSP 阻止 content script 外发 fetch → 回传必须走 background service worker** |
| DeepSeek | **高（首批）** | `.ds-markdown` 产品前缀稳定；**虚拟列表必做滚动采集**（>50 轮直接复制可见区丢 ~30% 历史的坑） |
| ChatGPT | 中~高 | `data-message-author-role` 多年稳定；原生虚拟化：边滚边采 + 记录 offsetTop 排序 + `data-message-id` 去重 + 空块内容校验 |
| Gemini | 中 | 自定义元素 `user-query`/`model-response` 较稳；Angular class 混淆频繁，禁用 class 依赖 |
| Kimi | 中~低 | 类名/哈希约 24h 轮换；首选内部 API（`/api/user/v6/chat/message/{chat_id}`）或通用 DOM 引擎 |
| 豆包 | 中~低 | 虚拟列表强截断；首选 hook `POST /im/chain/single` API（登录态 XHR 注入） |
| 通义 | 低 | 无公开稳定选择器、会话路由格式未知；备选官方数据导出（24h 邮箱 ZIP） |

- **虚拟列表通用采集循环**（ChatGPT/DeepSeek/Gemini/豆包 均为虚拟化列表）：定位滚动容器 → 滚动到顶/底 → 等待 mutation（MutationObserver）→ 收集存活节点（记 offsetTop + 消息 id）→ 去重 → 循环至无新增 → 按 offsetTop 排序
- **真实性 = 登录态**：扩展运行于用户本人账号会话，读取即本人的对话 → **验证码机制取消**，无需分享链接（架构性消解，见 `docs/spikes/headless-cf.md` 的对照结论）
- **扩展定位 = 采集器（thin client）**：只做「采集 + 回传」，不做编辑/生成/发布——创作发布全部在 SPA 工作台完成（移动端可用、密钥与服务端管线不暴露、商店审核面最小）
- 形态：Manifest V3；content script 按平台 URL 匹配（`claude.ai/chat/*`、`chat.deepseek.com/chat/*`、`chatgpt.com/c/*`、`gemini.google.com/app/*`、`kimi.moonshot.cn/chat/*`、`www.doubao.com/chat/*`、`www.tongyi.com/*`）；**回传统一走 background service worker**（claude.ai CSP 拦截 content script 直连外域，`chrome.runtime.sendMessage`）；鉴权：登录态 token 由 app 站点页注入 `chrome.storage`；扩展不本地存储对话
- 适配成本：每平台一个 DOM 解析适配器（滚动机制 + 消息块结构），平台页面改版需定点维护
- 商店上架（Chrome/Edge）审核周期入排期；移动端暂不支持（Safari 扩展另行评估）

## 4. 数据模型（Supabase Postgres）

| 表 | 关键字段 |
|---|---|
| `profiles` | `id`(=auth.users), `username`(唯一), `display_name`, `bio`, `plan`(free/pro), `credit_balance`(int, 按期付费余额), `created_at` |
| `voice_samples` | `user_id`, `audio_url`(R2), `duration`, `status`, `created_at`（可重录覆盖） |
| `invite_codes` | `code`(唯一), `created_by`, `used_by`, `used_at`, `expires_at`, `source`(admin/reward), `issued_for_episode_id` |
| `imports` | `user_id`, `platform`(chatgpt/claude/kimi/doubao/tongyi/gemini/deepseek/plain), `source_title`, `source_conversation_id`, `source_url`, `raw_content`, `parsed_dialogue`(JSONB), `status`, `created_at`；唯一约束 `(user_id, platform, source_conversation_id)` 防重复导入 |
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
| 多说话人混合模式受限（实测：一次调用不能混用「主持人内联零样本 + 嘉宾固定 `reference_id`」） | 设计定型：主持人零样本整段 + 嘉宾固定音色整段两条调用，ffmpeg 拼接（管线本就有）；需单次混排时先建主持人音色模型（`POST /model`，fast 5–8s，免费）走全 `reference_id` 数组 |
| Fish 免费/付费模型差异（spike 全程在 `s2.1-pro-free` 完成，0 额度账号无法直接观察扣费） | 计费口径 $15/百万 UTF-8 字节已由官方定价页确认；上线前用付费账号以 `GET /wallet/self/api-credit` 差值核对账单；克隆一致性默认波动 ~12%，长节目可调低 temperature |
| 平台 DOM 选择器基于公开逆向资料（`docs/spikes/chat-dom.md`，未登录态实测） | 各平台 content script 开发时逐一实测修正（每平台适配器交付即验证）；虚拟列表平台（ChatGPT/DeepSeek/Gemini/豆包）必须实现滚动采集循环 |
| Cloudflare/Turnstile 风控 | 已实测（`docs/spikes/headless-cf.md`）：无头浏览器被 Turnstile 拦截；导入统一走**浏览器扩展**（用户侧真实浏览器），天然绕开风控 |
| 平台聊天页改版 | 扩展 DOM 解析适配器需随平台页面改版维护；适配器每平台一文件，改版时定点修复 |
| 扩展商店审核 | Chrome/Edge 上架审核周期（数天~数周）入排期；先开发者模式/本地灰度 |
| 克隆音色质量受录音环境影响 | 录音引导页质量校验（时长/响度/语音检测），可重录 |
| ffmpeg 在 256MB 机器上拼接大音频 | 单期时长限定 5–10 分钟，音频体量小，256MB 无压力 |
| LLM 供应商切换 | OpenAI 兼容接口 + 配置化，锁定成本 |
