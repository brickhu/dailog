# ARC — 技术架构

> 状态：MVP 设计稿（2026-08-02）
> 配套文档：[PRD.md](./PRD.md)（产品与功能）· [MRD.md](./MRD.md)（市场与商业）· [AGENT.md](./AGENT.md)（项目总览）

## 1. 技术栈总览

| 层 | 选型 | 部署位置 |
|---|---|---|
| 管理员工作台（admin.dailog.fm） | SolidJS + Solid Router + StyleX | Cloudflare Pages（静态，免费） |
| 内容站 SSR（dailog.fm） | SolidStart（SSR）+ StyleX | Cloudflare Pages/Workers（免费） |
| 分享采集服务（importer.dailog.fm） | Node.js + TypeScript + Hono + undici（解析器 + 多通道重试） | **Railway**（独立 service；平台规则变化只更新此服务） |
| 统一后端（api.dailog.fm） | Node.js + TypeScript + Hono + Drizzle ORM + fluent-ffmpeg | **Railway**（Git 集成自动部署，Docker，按用量约 $5–10/月） |
| 数据库 | Railway Postgres（纯 Postgres 用法：Drizzle + postgres.js 直连） | Railway（与后端同平台，~$5–15/月） |
| 认证 | **better-auth**（自托管：邮箱 + 密码 + 会话，跑在统一后端内） | $0 无外部依赖（邮件验证可后接 Resend 免费额度） |
| 对象存储 | Cloudflare R2（音频/封面/录音样本） | R2 免费 10GB + 流量永久免费 |
| LLM（质量审核 + 润色 + 语言检测） | **DeepSeek**（OpenAI 兼容接口，配置化可切换） | 外部按量（成本低） |
| 语音合成 | Fish Audio TTS（多说话人 + 声音克隆） | 外部按量 |
| 支付（v1 无） | 无收款点——投稿制下投稿人/入选者均免费；v2 听众侧用 Apple/小宇宙平台原生 | — |

## 2. 部署拓扑

> **双环境**（2026-08-03）：`dev` 分支集成部署到开发环境（Railway Development 环境 + CF Pages project `dailog-admin-dev`），`master` 部署到生产。开发环境域名：`gracious-caring-development.up.railway.app`（API，Railway 默认 URL）/ `admin.candelbot.app` / `candelbot.app`（SSR，预留）；生产域名待定（`dailog.fm` 或 `dailog.fm`）。拓扑图按生产形态绘制，开发环境结构相同、域名与实例不同。

```
         ┌──────────────────────── 用户（浏览器） ────────────────────────┐
         │  粘贴 AI 对话分享链接（claude.ai/share/*、chatgpt.com/share/*…）│
         │  → 工作台预览确认（/import）                                   │
         └─────────────────────────────┬──────────────────────────────────────┘
                                       │ POST /api/share/collect（转发，鉴权复用）
                                       ▼
                          importer（importer.dailog.fm，独立服务）
                                       ▼
                        ┌─────────────────────────────────────────┐
                        │            dailog.fm                 │
                        │   Cloudflare Pages/Workers (SSR, 免费)  │
                        │   首页 / 投稿人主页 / 节目页 / RSS / 搜索  │
                        └──────────────┬──────────────────────────┘
                                       │
admin.dailog.fm (SPA, SolidJS+StyleX) │     R2 (音频/封面/样本)
  Solid Router, 静态部署在 CF Pages     │         ┌──────────────┐
  接收采集 → 润色编辑 → 生成 → 发布      └────────►│  *.mp3 / png │
                                       │         └──────────────┘
                              ┌────────▼─────────┐
                              │ api.dailog.fm │
                              │  统一后端 (Railway, Docker)            │
                              │  · imports 接收（采集确认后入库）   │
                              │  · LLM 润色(SSE 流式)             │
                              │  · 生成管线(TTS→ffmpeg→R2)        │
                              │  · 成本预算 / 投稿资格     │
                              └────────┬─────────────────────────┘
                                       │
                        ┌──────────────▼──────────────┐
                        ┌──────────────▼──────────────┐
                        │ Railway Postgres（~$5–15/月） │
                        │  Postgres + better-auth 用户   │
                        │  用户/投稿审核/节目/脚本/任务/状态 │
                        └─────────────────────────────┘
```

**数据流向**：用户粘贴分享链接 → importer 服务解析（importer.dailog.fm）→ 工作台预览确认 → 统一后端落库；SPA 与 SSR 站读 Railway Postgres（内容站直连读库，只读查询；无 RLS，靠查询层约束）；统一后端是唯一写方；音频资产全部在 R2。

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
| `POST /api/auth/*` | — | **better-auth 会话路由**（注册/登录/登出/会话；注册含邮箱验证） |
| `GET /api/me` | ✓ | 当前用户（认证中间件验证） |
| `POST /api/import` | ✓ | **分享链接导入**：① 查 `snapshots`（URL 唯一）——未命中调 importer；**快照写入分层**：`platform_unreachable` 写快照（10 分钟 TTL 重试）；`parse_failed`/内容为空**不写库**（importer 解析器问题，修复后重试才有意义——写库会永久污染缓存）② 查 `polishes`（user × snapshot）——已存在返回 `{ existing: true, polishId }`（前端跳编辑页）③ 未创建则质量分析（LLM，结果写快照）→ 返回 `{ dialogue, quality }` 供预览确认 |
| `POST /api/polishes/new` | ✓ | **确认创建容器**：提交快照 → 创建 `polishes`（user × snapshot 唯一；频道未开通 403）→ 返回 `{ polishId }` |
| `GET /api/polishes/:id` | ✓ | 编辑页详情：polish + 快照 meta（标题/质量）+ transcripts 列表 |
| `POST /api/transcripts/new` | ✓ | SSE 流式润色：基于快照对话生成一条 transcript（请求体含 polishId；润色上限 free 5 条）→ 流式返回脚本段落，done 事件带 `transcriptId` |
| `PUT /api/transcripts/:id` | ✓ | 编辑保存 transcript 脚本（归属校验） |
| `POST /api/episodes/new` | ✓ | **生成节目**（编辑触发）：请求体含 transcriptId → 脚本内容安全审核（DeepSeek，拒绝 422 + 原因且不进入制作）→ 建 job → 后台执行 |
| `GET /api/episodes/:id/job` | ✓ | 轮询生成进度（阶段 + 百分比） |
| `POST /api/episodes/:id/publish` | editor | 发布（`is_public=true`，收录）→ 投稿人作品集更新 |
| `POST /api/editor/reviews/:id/process` | editor | 触发大模型审核 + 润色（按话题切分 1–N 版脚本；审核不通过 → 标记 rejected + reason） |
| `POST /api/editor/reviews/:id/reject` | editor | 拒绝（任何阶段可用，reason 必填，投稿人可见） |
| `GET /api/editor/queue` | editor | 投稿队列（inbox：submitted 按提交时间升序；可筛 accepted/rejected） |
| `GET /api/editor/reviews/:id` | editor | 审核详情（对话全文 + 脚本列表 + 节目列表） |
| `PUT /api/editor/transcripts/:id` | editor | 编辑修改脚本（改文本/情绪标签/插删段落） |
| `POST /api/editor/episodes/new` | editor | 生成（选脚本 → 安全审核 → job；完成后 status=ready 待发布确认） |
| `GET /api/editor/episodes/:id/publish-form` | editor | 发布预填（LLM 生成 title/description/tags/coverKeywords，预填为主） |
| `POST /api/editor/episodes/:id/publish` | editor | 发布确认（元数据落库 + 期号分配 max+1 + published） |
| `PUT /api/editor/episodes/:id` | editor | 已发布节目编辑（tags / is_picked 精选；未来清单入口） |
| `POST /api/editor/reviews/:id/cover-search` | editor | 封面候选（LLM 关键词 → Pexels 搜索 4 张；未配 key 503） |
| `GET /api/editor/guests` | editor | 嘉宾列表 + 采样（guest 管理，迁移自 admin 白名单） |
| `GET /api/importer/platforms` | ✓ | 转发 importer 校验规则（前端预检用，规则单一来源） |

**路由挂载约定**：import/polishes/transcripts 路由内部自带 `/api` 前缀（挂根 `app.route("/", ...)`）；importer 路由无前缀（挂 `app.route("/api", ...)`）。
| `POST /api/me/voice-sample` | ✓ | 上传/重录录音样本（R2 + 基础质量校验） |
| ~~`GET /api/public/episodes/:id/dialogue`~~ | 预留 | 节目页"查看原文"（未来）：对话全文 + 来源元数据。内容站 SSR 直连读库（`repo.episodes.getPublishedDialogue`，仅 `is_public=true`、草稿不可见）；如需 HTTP 公开端点再按此形态暴露（无鉴权） |
| ~~billing / stripe-webhook~~ | — | **v1 不实现**（投稿制无创作者收费，MRD §5）；v2 听众侧用 Apple/小宇宙平台原生收款 |

### 3.3 生成管线

```
queued → tts → merge → upload → done（failed 可重试）
```

**生成前内容安全审核**：`generate` 入口先对最新脚本版本做 DeepSeek 安全审核（色情/违法/仇恨/诈骗等）——拒绝则返回 422 + 原因、**不创建 job、不进入制作**。质量门/安全门的审核结果当前仅以 422 + reason 返回、不落库（`episodes.quality_status/quality_reason` 字段已在 schema 预留，语义 = 最近一次审核结果，待前端展示时启用）。

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
2. **合并**：ffmpeg 拼接 `intro.{lang}.mp3 + 主对话 + outro.{lang}.mp3`（中/英两套固定片头片尾，按对话语言选择），段间 300ms 自然间隔；**输出按行业标准**（Apple Podcasts 指南）：MP3 128k mono 44.1kHz + `loudnorm I=-16:TP=-1.0` 响度归一 + ID3 标签（title/album=dailog/genre=Podcast/期号）
3. **上传**：后端持 CF 凭证直传 R2 → 更新 `episodes.audio_url` / `duration_seconds` → job `done`

### 3.4 投稿成本预算（v1 无创作者收费，编辑驱动）

**v1 无任何收费点**——投稿免费、收录免费（MRD §5）；成本控制 = **编辑决策（用稿率）** + 硬上限：

- **编辑驱动**：大模型审核 + 润色由编辑对具体投稿触发（`POST /api/editor/reviews/:id/process`）——被拒投稿只产生审核成本（~¥0.1），只有通过者产生制作成本（~¥1/期）
- **generate 校验**：脚本内容安全审核（422 不进入制作）→ **脚本字数校验（硬上限 5000 字，超限 400/422 提示精简）** → 建 job（无投稿资格校验——注册 + 邮箱验证即获资格）
- **成本上限（配置化）**：单次输入对话量上限；**免费层 TTS 模型 = `s2.1-pro-free`（$0）**（音质待人工试听确认，见 docs/spikes/fish-audio.md）；付费音色模型为 v2 选项——**无润色次数限制**（润色仅编辑触发，成本由编辑决策兜底）
- **预算核算**：审核 ~¥0.1/投稿 + 制作 ~¥1/期（润色 + TTS 实测费率）——**编辑用稿率 = 成本总开关**（MRD §5；例：100 投稿/天 ≈ ¥30/天 ≈ ¥900/月）
- 润色支持**方向指示**（instruction 拼入 prompt），有未保存手动改动时先确认
- **邀请码机制已移除**（2026-08-11 定稿）：注册 + 邮箱验证即获投稿资格；`invite_codes` 表废弃

### 3.5 采集与导入（importer 纯解析 + API 编排）

**职责分层**：
- **importer（纯解析器）**：URL → 解析内容。无状态、无 LLM、无业务逻辑——只做「抓取 + 结构化」，平台规则变化只更新它
- **API（业务编排）**：快照缓存、质量分析（LLM）、对话容器管理——全部业务在 API 侧

**导入流程（POST /api/import）**：
```
① snapshots 查 URL（分享链接内容固定 → 快照资源全局唯一）：
   未命中 → 调 importer；**快照写入分层**：
     · platform_unreachable（网络/CF）→ 写快照（status=unreachable，10 分钟可重试）
     · parse_failed / 内容为空（伪成功——importer 解析器对平台结构变化
       返回空 content 的消息数组）→ **不写库**，直接 422；修复后自动重试恢复
② polishes 查 user × snapshot：
   已存在 → 返回 { existing: true, polishId } → 前端直接跳编辑页
   不存在 → 质量分析（DeepSeek，结果写 snapshot）→ 返回 { dialogue, quality }
③ 前端预览确认 → POST /api/polishes/new 创建容器 → 跳编辑页（/polish/:id——
   transcripts/new 润色生成脚本 → 选一条 episodes/new 生成节目 → 发布）
```

**质量分析归属 API**：importer 不调 LLM。基于快照内容分析（对话过短 <3 轮 / 寒暄 / 信息量不足 / 违规 → 拒绝 + 原因；语言识别 zh/en），结果随快照存库——内容固定 → 分析一次全局复用，生成环节不再重复检测（原 polish 流程的 qualityCheck 移除）。

**用户 × 快照唯一**：同一用户对同一分享链接只有一个 polish（重复粘贴 → 跳转编辑页，语义是「继续创作」而非重复导入）；不同用户可用同一快照各自创建容器（快照是公开资源，不做限制）。

**平台通道（`services/importer`，实测全通）**：
| 平台 | 通道 |
|---|---|
| claude | chat_snapshots API（CF 拦时 ScraperAPI）；文本在 `content[]` blocks（type=text 的 .text，tool_use/tool_result 跳过——2026-08 结构迁移）|
| chatgpt | RSC payload 解码（ScraperAPI 兜底）|
| gemini | batchexecute RPC（直连）|
| doubao | SSR 快照（ScraperAPI + 香港出口）|
| kimi | SSR HYDRATION（直连）|
| deepseek | share/content API（直连）|

**URL 校验三级**：协议 → 平台域名锚定 → 分享页结构（id 格式）——规则经 `GET /platforms` 下发给前端预检（单一来源不双写）。

## 4. 数据模型（Railway Postgres）

**分层**：快照（资源，无用户）→ polish（用户创作容器）→ transcript（润色脚本，polish 可含多个）→ 节目 → 音轨。

| 表 | 关键字段 | 说明 |
|---|---|---|
| `snapshots` | `url`(唯一), `platform`, `source_title`, `source_conversation_id`, `parsed_dialogue`(JSONB), `quality`(JSONB: `{pass, reason?, language?}`), `status`(ok/unreachable), `last_error`, `created_at`, `updated_at` | **分享快照**：对分享 URL 的内容提取（全局资源，与用户无耦合；URL 唯一）。分享页是原对话的快照——内容固定、永久有效；关闭后重开 = 新 URL。`status=unreachable` 时 10 分钟内不重试 importer |
| `polishes` | `id`, `user_id`, `snapshot_id`, `title`, `status`(editing/generating/published/failed/submitted/accepted/rejected), `rejected_reason`, `reviewed_at`, `created_at`, `updated_at` | **创作容器 + 投稿单元**：用户 × 快照的工作区（**唯一约束 `(user_id, snapshot_id)`**——重复提交同一对话返回已有）。**纯容器**——不含脚本内容；质量门/语言随快照。**投稿状态机承载于此**（submitted→accepted/rejected；editing 等为旧自助模型残留，新流程不再产生） |
| `transcripts` | `id`, `polish_id`, `segments`(JSONB: `[{speaker: host\|guest, text}]`), `language`, `created_at` | **润色脚本**：polish 可包含多个（多次润色各生成一条独立 transcript，无版本概念）；节目由其中一条生成 |
| `episodes` | `id`, `user_id`, `transcript_id`, `polish_id`, `slug`, `title`, `description`, `cover_url`, `audio_url`, `duration_seconds`, `status`(generating/ready/published/failed), `number`(期号), `is_picked`(精选), `created_at`, `published_at` | **节目**：仅生成后才创建（transcriptId NOT NULL——投稿状态在 polishes）；**generating → ready（管线 done，待编辑确认）→ published（编辑确认 + 期号分配 max+1）** |
| `tracks` | `episode_id`, `language`(zh/en/ja), `audio_url`, `duration_seconds`, `created_at` | **音轨**：节目音频，单语言（跟随对话语言，`language` 列保留扩展性）；**不做单节目多语言**——翻译版 = 基于同一快照的新节目（PRD §4.3） |
| `profiles` | `id`(=auth.users), `username`(唯一), `display_name`, `bio`, `role`(user/editor), `created_at` | 用户（投稿人/编辑） |
| `personas` | `user_id`, `display_name`, `bio`, `voice_sample_id`, `created_at` | **人设**（主持人配置）：信息 + 声音采样；投稿确认时配置、已有自动填充（PRD §4.2） |
| `voice_samples` | `user_id`, `audio_url`(R2), `duration`, `status`, `created_at` | 录音样本（人设内，可重录覆盖） |
| ~~`invite_codes`~~ | （废弃 2026-08-11：注册 + 邮箱验证即获投稿资格） | — |
| `generation_jobs` | `episode_id`(或 polish_id), `status`(queued/tts/merge/upload/done/failed), `progress`, `error`, `attempts` | 生成任务 |
| `payments` / `subscriptions` | （v2 预留，v1 不建） | 计费（v2 听众侧） |

**废弃表**：`imports`（由 snapshots + polishes 替代）、`scripts`（由 transcripts 替代）、`conversations`（不存在该概念——容器直接叫 polish）；`episodes.status=draft` 移除（创作态归 polishes）。
**迁移策略**：**清空重建**（内测期数据量小，不做存量迁移；`imports`/`scripts` 表删除，`episodes` 重建去掉 draft/quality 字段——质量归 snapshots）。

**R2 存储路径**：
```
snapshots/{snapshot_id}.dialogue.json        ← 快照内容（URL 维度；meta 存库，内容在 R2）
transcripts/{transcript_id}.json         ← 润色脚本备份（可选；segments 主存库 jsonb）
episodes/{user_id}/{episode_id}.mp3          ← 生成产物（不可变）
tracks/{episode_id}/{language}.mp3           ← 音轨（预留）
covers/{user_id}/{episode_id}.jpg            ← 封面图（预留）
voices/{user_id}.webm                        ← 录音样本
assets/guest-voice-zh.mp3 等                 ← 平台资产
```
**存储决策**：二进制/大文件 → R2；结构化/可查询文本（segments/quality/dialogue meta）→ 数据库。

## 5. 前端

### 5.1 管理员工作台（apps/admin，仅 admin/editor 登录）

**admin.dailog.fm = 编辑部后台**（独立工程，新建于 P3；旧 apps/studio 保留不再演进；投稿人端在 site §5.2）：

```
/login               编辑/管理员登录（普通用户无权限）
/queue               投稿队列（待审核/已收录/已发布）
/reviews/:id         审核详情：触发审核 + 润色 → 选脚本（可手工编辑）→ 生成 → 发布 / 拒绝
/settings            嘉宾音色管理、账号
```


- Vite + SolidJS + Solid Router + StyleX（Babel/Oxc 插件接入）
- 复用：润色编辑器（script-editor）、生成进度组件
- **封面（图库匹配，非 AI 生成）**：润色 LLM 输出封面关键词 → Pexels API 搜索（`PEXELS_API_KEY`，免费额度）→ 编辑工作台 4 张候选选择 → 下载存 R2 → `cover_url`；跳过/未配置 key → 渐变模板兜底（服务端 SVG→PNG 生成，零成本）

### 5.2 内容站 + 投稿人端 SSR（apps/site）

- SolidStart + Cloudflare adapter，SSR 部署于 CF Pages/Workers；**无任何编辑路由**（编辑在 apps/admin §5.1）
- 路由：`/`（landing：左 tagline+CTA / 右精选播放器）、`/discover/<new|hot|picked|top>`（新热精荐）、`/tags`（标签聚合）、`/episodes?params=`（搜索）、`/submit`（投稿流程：导入 + 人设配置 + 提交）、`/me/*`（submits/episodes/favorites/likes）、`/account/*`（账户/设置/重置密码）、`/login`、`/@<username>`（投稿人主页，默认邮箱前缀）、`/episode/<id>`（播放页）、`/hosts`·`/guests`（主持人/嘉宾展示）、`/feed.xml`（单 feed RSS，进 Apple/Spotify/小宇宙）
- 注：投稿流程的录音组件（人设声音采样）在 site 内实现（SSR 安全：浏览器 API 只在客户端 effect 内使用），或按 packages/ui 约束抽取
- RSS：itunes 元数据 + 封面 + 节目列表；feed 响应加 CF 短 TTL 缓存（防高频拉取）
- 直连 Railway Postgres 读公开数据（只读查询 + 服务端只暴露公开字段）

### 5.3 共享

- `packages/shared`：领域类型 + 设计 token（颜色/间距/字体），StyleX 编译时 CSS 两站共用

## 6. 计费（v1 无；v2 听众侧）

- **v1：无计费系统**——投稿制下无创作者收费（MRD §5）；`billing`/`stripe-webhook` 路由不实现，`payments`/`subscriptions` 表不建（v2 预留）
- **v2 听众侧（频道资产验证后）**：Apple Podcasts Subscriptions / 小宇宙会员（平台原生收款 + 抽成 15–30%）→ 打赏与入选投稿人分成（Medium Partner Program 式）——收款主体/通道方案见 docs/market-payments.md

## 7. 成本模型（MVP 月度）

| 项 | 成本 |
|---|---|
| Cloudflare Pages/Workers + R2 | 免费（10GB 存储，流量免费） |
| Railway Postgres（统一后端 + 数据库 + Auth） | DB ~$5–15/月；Auth（better-auth 自托管）$0 |
| Railway（统一后端） | 按用量约 $5–10/月（小规格常驻服务；Git 集成自动部署） |
| LLM 润色 | 按量，每期约几美分 |
| Fish Audio | 按量（官方 $15/百万字节；实测账单 ≈$9.7/M 字节 → 10 分钟期 ≈ ¥0.63，见 `docs/spikes/fish-audio.md` §7） |
| 支付（v1 无） | — |

超出免费额度的触发点：R2 >10GB；Railway（API+DB）随用量线性增长（可设用量上限告警）。

## 8. 测试策略

- **采集服务解析器（`services/importer`）**：每平台解析器纯函数单测（值表解码/多层转义/BigInt 清洗/双格式流式响应等，10 用例）
- **管线**：mock LLM / mock Fish Audio 集成测试；ffmpeg 拼接 golden 文件对比（时长/字节）
- **规则单测**：收录标准判定（四类价值）、角色权限（admin/editor）、成本预算核算
- **API 契约**：Vitest + Hono app 直测
- **前端**：Vitest 组件测试（编辑器为重点）+ 1 条 Playwright E2E 主流程（注册→录音→导入→润色→生成→发布→播放）

## 9. 技术风险与前置 Spike

| 风险 | 缓解 |
|---|---|
| 多说话人混合模式受限（实测：一次调用不能混用「主持人内联零样本 + 嘉宾固定 `reference_id`」） | 设计定型：**按段 fallback**（host 段 msgpack 内联零样本 + guest 段固定音色逐段合成），ffmpeg 拼接（管线本就有）；需单次混排时先建主持人音色模型（`POST /model`，fast 5–8s，免费）走全 `reference_id` 数组 |
| Fish 免费/付费模型差异（spike 全程在 `s2.1-pro-free` 完成，0 额度账号无法直接观察扣费） | 已实测一例真实账单（$1.89/195KB → ≈$9.7/M 字节，约为官方价 65%，见 spike §7）；上线前多模型复核费率；克隆一致性默认波动 ~12%，长节目可调低 temperature |
| 平台分享页数据结构变化 | 采集服务解析器每平台一文件（`services/importer/src/platforms/`），改版时定点修复重新部署（实测案例：claude content[] blocks 结构迁移、chatgpt RSC） |
| Cloudflare/Turnstile 风控 | 数据中心 IP 直连 claude.ai 被 CF 拦（新加坡/美区/Workers 三路实测 403）；采集服务多通道重试兜底（ScraperAPI 实测全通，免费额度内） |
| 平台分享页改版 | 采集服务解析器需随平台数据结构变化维护（每平台一文件）；改版时只更新采集服务，主站不受影响 |
| ~~扩展商店审核~~ | ~~Chrome/Edge 上架~~：扩展已停用，无商店流程 |
| 克隆音色质量受录音环境影响 | 录音引导页质量校验（时长/响度/语音检测），可重录 |
| ffmpeg 在 256MB 机器上拼接大音频 | 单期时长限定 5–10 分钟，音频体量小，256MB 无压力 |
| LLM 供应商切换 | OpenAI 兼容接口 + 配置化，锁定成本 |
