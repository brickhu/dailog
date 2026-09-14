# ARC — 技术架构

> 状态：本质版（2026-08-13 架构极简改造后重写）——投稿 = URL + 采样；**采编 lab 化（2026-09-05）**：dailog-editor 本地 Agent 管线下线，制作迁移 dailog lab（tools/script-lab：浏览器工作台 + 轻服务端，本地运行）；产物 R2 权威 + 浏览器缓存，无本地草稿依赖。
> 配套文档：[PRD.md](./PRD.md)（产品与功能）· [MRD.md](./MRD.md)（市场与商业）· [AGENT.md](./AGENT.md)（项目总览）

## 1. 技术栈总览

| 层 | 选型 | 部署位置 |
|---|---|---|
| 内容站 SSR（dailog.fm） | SolidStart（SSR）+ StyleX | Cloudflare Pages/Workers（免费） |
| 统一后端（api.dailog.fm） | Node.js + TypeScript + Hono + Drizzle ORM | **Railway**（Git 集成自动部署，Docker，按用量约 $5–10/月） |
| 数据库 | Railway Postgres（Drizzle + postgres.js 直连） | Railway（与后端同平台，~$5–15/月） |
| 认证 | **better-auth**（自托管：邮箱 + 密码 + 会话，跑在统一后端内） | $0 无外部依赖（邮件验证可后接 Resend 免费额度） |
| 对象存储 | Cloudflare R2（采样音频/成品音频/封面） | R2 免费 10GB + 流量永久免费 |
| 邮件 | Resend（拒审/上线通知） | 免费 3000 封/月 |
| **采编 lab** | `tools/script-lab`（web 前端 + 轻服务端 `server.mjs`，`pnpm lab` 本地运行，127.0.0.1 + Host 头校验）+ 浏览器 ffmpeg.wasm（跨域隔离 SAB；不可用降级 lab 服务端 ffmpeg） | 编辑机器本地（无需部署） |

**服务端（api.dailog.fm）职责：API 校验落库 + 认证 + R2 存储 + 公开内容服务**——无采集、无 LLM 编排；
采集、审题/创作/打磨（LLM 直连）、TTS、合成与封面制作由 **dailog lab**（tools/script-lab，本地运行）承担，
经 `/v1/editor/*` 与 `/v1/editor/storage` 读写服务端数据与 R2（服务端曾实现 importer 采集与生成管线，
2026-08-13 已删除；dailog-editor 本地 Agent 管线 2026-09-05 下线）。`/v1/editor/tts` 保留为统一 TTS 兼容端点；
lab 的逐段 TTS 由 lab 服务端直调 Fish API（复用 tools/dailog-cli 的 fish 封装，底座迁移中）。

## 2. 部署拓扑

```
         ┌─────────────────────── 用户（浏览器） ────────────────────────┐
         │  dailog.fm（CF Pages/Workers，SSR）                          │
         │  首页 / 投稿（URL + 采样）/ 播放页 / RSS / 投稿人主页 / 通知   │
         └───────────────────────┬──────────────────────────────────────┘
                                 │ cookie 会话（子域共享）
         ┌───────────────────────▼──────────────────────────────────────┐
         │  api.dailog.fm（Railway）                                     │
         │  · POST /v1/submissions（URL 合法性 + 触达性检查 → 落库待审） │
         │  · /v1/me/*（采样上传 / 投稿状态 / 通知 / 收藏）              │
         │  · /v1/editor/*（队列 / 详情 / 拒审 / 发布 / 嘉宾 / 采样下载） │
         │  · /v1/public/episodes/:id/audio|cover（公开播放）            │
         └───────────────┬───────────────────────────────┬──────────────┘
                         │                               │
              Railway Postgres                    R2（voices/ episodes/ covers/）
                         │
         ┌───────────────▼──────────────────────────────────────────────┐
         │  编辑浏览器 ──► dailog lab（tools/script-lab，本地 127.0.0.1） │
         │  采集对话（R2）→ 审题/创作/打磨（LLM，提示词即改即生效）        │
         │  → 逐段 TTS（Fish）→ 合成 full audio（浏览器 wasm / 服务端兜底）│
         │  → 封面 + 节目信息 → publish（音频零拷贝入库）                │
         └──────────────────────────────────────────────────────────────┘
```

**数据流向**：投稿人提交 URL + 采样 → API 校验落库（submissions=submitted）→ dailog lab 采集对话
存 R2（collected）→ lab 审题/创作/打磨/TTS/合成（产物 R2 权威 + 浏览器工作副本）→ 合成确认写 R2 成品位
（canonical）→ 发布（封面 + 节目信息 → episodes 表，published + 期号 max+1）→ 投稿人收到通知（站内 + 邮件）。
内容站 SSR 直连读库展示公开节目。

## 3. 统一后端（services/api）

### 3.1 技术选型

- Node.js + TypeScript + **Hono**（轻量路由）
- **Drizzle ORM** + Railway Postgres（迁移 + 类型安全）
- **better-auth**（自托管，邮箱 + 密码 + 会话；后端中间件验证会话）
- **无任务队列 / 无 LLM / 无采集**（LLM 编排与采集在 dailog lab 层，服务端保持极简）；**R2 存储代理**（`/v1/editor/storage` get/put/delete）与**统一 TTS 兼容端点**（`/v1/editor/tts`，`requireRole(editor|admin)`；lab 现逐段直调 Fish，未走此端点）
- 认证：`/v1/auth/*`（better-auth）+ 自定义 `login-or-otp` / `otp-complete`（统一登录注册）

### 3.2 API 端点

| 方法/路径 | 认证 | 作用 |
|---|---|---|
| `GET /health` | — | 健康检查（Railway healthcheckPath） |
| `POST/GET /v1/auth/*` | — | better-auth 会话路由（注册/登录/登出/会话） |
| `POST /v1/auth/login-or-otp` / `otp-complete` | — | 统一登录/注册（老用户密码登录 / 新用户验证码注册，限流） |
| `GET /v1/me` | ✓ | 当前用户（role / hasVoiceSample） |
| `POST /v1/submissions` | ✓ | **投稿**：`{url, title?}` → URL 合法性（http/https）+ 触达性检查（HEAD 8s，网络失败即拒）→ 创建 submitted；并发上限 5（429）、同 user+url 重复（existing） |
| `GET /v1/me/submissions` | ✓ | 我的投稿及状态（submitted/rejected/published + 最新节目状态） |
| `GET/POST /v1/me/voice-sample`、`GET /v1/me/voice-sample/audio` | ✓ | 声音采样上传/回读/试听（R2） |
| `GET/PATCH /v1/me/profile`、`PATCH /v1/me/persona` | ✓ | 账号档案 + 主持人默认人设 |
| `GET /v1/me/notifications*` | ✓ | 站内通知（拒审/上线） |
| `POST/DELETE /v1/episodes/:id/like`、`GET /v1/episodes/:id/interactions` | ✓ | 消费端互动（简化版 0034）：仅点赞 toggle（返回最新计数）+ interactions 合并返回点赞状态与计数；收藏走「我的收藏」端点（一键收藏 = 默认列表） |
| `GET /v1/public/episodes/:id/audio\|cover` | — | 公开播放（仅 published + is_public；音频 ETag 缓存） |
| `GET /v1/public/episodes/:id/stats`、`POST /v1/public/episodes/:id/stats/:type` | — | 播放/完播统计（0036 恢复展示：详情页播放/完播次数 + 点赞计数；播放器上报 + 限频） |
| `GET /v1/public/episodes/recommended` | — | 推荐队列（热度分排序 + 语言优先；首页滚屏每屏 4 条 × 最多 5 屏 / 发现页） |
| `GET /v1/public/playlists`、`GET /v1/public/playlists/:slug` | — | **播放列表**（0032）：平台公开列表索引（`?lang=zh|en` 语言偏好优先 + 精选优先，不足自然回退；附节目数与首期封面）+ 详情（仅公开节目，position 排序） |
| `GET /v1/me/favorites`（?contains=） | ✓ | **我的收藏**：默认列表（kind=user + is_default）全部节目，position 倒序（新加入在前），含分组字段（tags/guestName/language）；?contains=<episodeId> 附带是否已收藏 |
| `POST/DELETE /v1/me/favorites/:episodeId` | ✓ | 收藏 / 取消收藏（校验节目公开；重复幂等 added=false）——用户侧无自建列表（已移除），收藏 = 每用户唯一清单 |
| `POST/GET/PATCH/DELETE /v1/editor/playlists`、`/v1/editor/playlists/:id` | editor | **平台策展列表**（kind=platform，isPicked 精选标记）+ 条目管理（同 /me 形态，requireRole 守卫） |
| `POST /v1/editor/playlists/:id/cover`、`GET /v1/public/playlists/:id/cover` | editor / — | **列表封面**：multipart 上传（sharp 归一 1400² JPEG → R2 `covers/playlists/{id}.jpg`）/ 公开读取（缓存 86400s） |
| `GET /v1/public/stats`、`/hosts`、`/guests`、`/guests/:id` | — | 站点头部数据 / 热门主播 / 嘉宾列表 / 嘉宾详情（含参与节目） |
| `GET /v1/me/episodes`、`PATCH /v1/me/episodes/:id` | ✓ | **我的节目**（列表含已下架）/ 下架·重新上架（切换 is_public，仅归属人） |
| `GET /v1/editor/submissions?status=` | editor | **待审队列**（先到先审；含投稿人邮箱/显示名/采样就绪标记） |
| `GET /v1/editor/submissions/:id` | editor | 投稿详情（URL/投稿人/**采样 transcript**/已上线节目） |
| `POST /v1/editor/submissions/:id/reject` | editor | 拒审（reason 必填 → rejected + 通知 + 邮件） |
| `POST /v1/editor/submissions/:id/publish` | editor | **发布**（multipart：cover? + meta JSON；音频已在合成确认时入 R2 成品位，crafted 零拷贝发布；submitted/collected 可带 audio 上传）→ episode 创建（published + 期号 max+1）→ 投稿 published + 通知 + 邮件 |
| `GET /v1/editor/guests` | editor | 嘉宾列表（品牌声线宿主） |
| `GET /v1/editor/samples/host/:userId/audio`、`/guest/:guestId/audio` | editor | 主持人/嘉宾采样音频下载（lab TTS 参考） |
| `POST /v1/editor/tts` | editor | **统一 TTS 兼容端点**（multi-speaker，msgpack references；lab 逐段 TTS 直调 Fish，见 §4.2） |
| `POST /v1/editor/storage/get`、`/put`、`/delete` | editor | **R2 通用读写**（lab 存取对话/产物/音频字节） |
| `GET/POST /v1/editor/submissions/:id/workflow` | editor | **制作产物工作态**（GET 返回 / POST 合并 patch → R2 workflows 槽） |
| `PUT /v1/editor/submissions/:id/scripts` | editor | **脚本槽写 R2**（`scripts/{id}.json`，多候选数组；定稿 segments 写回同槽） |
| `PUT /v1/editor/submissions/:id/review` | editor | **审题采纳结果入库**（submissions.review jsonb；不改状态——拒稿/续作由编辑动作决定） |
| `PATCH /v1/editor/submissions/:id/collected` | editor | 采集完成标记（collected 1/0，含对话条数） |
| `POST /v1/editor/submissions/:id/crafted` | editor | **crafted 标记**（成品音频已入 R2 成品位，未发布） |
| `GET /v1/editor/submissions/:id/audio`、`/v1/editor/full/:id/audio` | editor | 成品/合成音频转发（旧 full/ 布局回退） |
| `GET /v1/editor/episodes`、`PUT /v1/editor/episodes/:id` | editor | 已发布节目清单 / 微调（tags/精选/标题/简介/封面） |
| `POST/GET /v1/device/approve` 等 `/v1/device/*` | ✓ | 设备配对授权（编辑/管理员角色，自包含授权页） |

### 3.3 数据模型（本质版）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `submissions` | `user_id`, `url`, `title`, `status`(submitted/collected/crafted/rejected/published), `rejected_reason`, `reviewed_at`, `review`(JSONB) | **投稿**：URL + 采样（采样在 voice_samples，投稿只关联 userId）；唯一约束 `(user_id, url)` 防重复；`review` = 审题采纳结果（lab 写入） |
| `episodes` | `submission_id`, `user_id`, `host_id`, `guest_id`, `slug`, `title`, `description`, `cover_url`, `audio_url`(R2), `audio_size`, `duration_seconds`, `language`, `tags`, `number`(期号), `is_picked`, `status`(published), `is_public`, `published_at` | **成品节目**：lab 发布（合成确认即入 R2 成品位，crafted → 发布零拷贝；published + isPublic）；期号发布时 max+1 分配——"dailog 第 N 期" |
| `guests` / `guest_voice_samples` | `platform`(枚举), `name`, `intro` + `audio_key`, `transcript` | **AI 平台嘉宾库 + 品牌声线采样**（lab TTS 的嘉宾音色来源；guest×language 唯一，未定义语种 TTS 按英文兜底；reference_id 已移除 0043） |
| `voice_samples` | `user_id`, `language`, `audio_url`(R2), `transcript`, `duration`, `status` | 投稿人声音采样（一人多语种各一条；主持人克隆音色参考） |
| `profiles` | `id`(=auth.users), `display_name`, `bio`, `persona`(JSONB) | 主持人档案（账号级属性在 user 表：`name`=@slug、`role`(user/editor/admin)、`image`） |
| `notifications` | `user_id`, `type`(rejected/published), `title`, `body`, `link` | 站内通知（拒审/上线） |
| `likes` | `user_id`, `episode_id` | 消费端点赞（收藏已并入默认播放列表，无独立表） |
| `playlists` | `slug`(唯一), `kind`(platform/user), `owner_id`, `title`, `description`, `cover_url`, `is_public`, `is_picked`, `is_default`, `language` | **播放列表**（0032；0033/0035；0037 收窄）：kind=platform 平台策展合集（编辑创建，精选标记，公开索引）；kind=user 仅**每用户唯一 is_default「我的收藏」默认列表**（Spotify 式，强制私有、不可编辑/删除/重排）——用户自建列表已移除，收藏 = 一键写入该列表；封面 = 编辑自定义上传（无则自动取首期节目封面） |
| ~~`favorites`~~ / `episode_stats` | — | 收藏表已移除（0033，并入默认播放列表）；`episode_stats` 播放/完播统计保留（0036 恢复）；`likes` 保留。收藏 = 每用户唯一 `is_default` 列表（0037 起无自建列表，收藏按钮直写默认列表） |
| `playlist_episodes` | `playlist_id`+ `episode_id`(唯一), `position` | **列表条目**（有序集合）：删列表/删节目级联清理；索引 (playlist_id, position) 顺序读 + (episode_id) 反查「收录于」 |
| auth 表（`user`/`session`/`account`/`verification`） | better-auth 官方字段 | 认证 |

**已删除表（0026 迁移）**：`snapshots`、`polishes`、`transcripts`、`tracks`、`generation_jobs`、`payments`、`subscriptions`（内容五层旧模型；支付 v1 无）。

**R2 存储路径**：
```
voices/{userId}/{language}.webm            ← 投稿人采样（录音上传）
dialogues/{...}                            ← 对话原文（key = 分享 URL 哈希，lab 采集写入）
episodes/{userId}/{submissionId}.m4a       ← 成品音频（lab 合成确认写入，canonical，发布零拷贝）
scripts/{id}.json                          ← 脚本槽（多候选；定稿 segments 写回）
workflows/{env}/{id}.json                  ← 制作产物工作态（旧布局；新写入 scripts/，读取兼容回退）
covers/{submissionId}.jpg                  ← 封面（lab 发布时上传，可选）
```

## 4. 采编工作台 dailog lab（tools/script-lab）

- **形态**：浏览器控制台（web/）+ 轻服务端（server.mjs，`pnpm lab` 本地运行，127.0.0.1 + Host 头校验）；
  登录页选择环境（dev/prod，cookie 会话存 `.lab-cookies.json`）
- **数据边界**：产物 **R2 权威 + lab 进程内存缓存**——对话（key = 分享 URL 哈希）、脚本（`scripts/{id}.json`）、
  制作工作态（`workflows/{env}/{id}.json`）、成品音频（`episodes/{userId}/{id}.m4a`）；
  浏览器 localStorage（`assets-{id}` 素材 store：review/scripts/metadata 工作流输入槽 + dialogue 快照）与 IndexedDB（seg 音频/full/BGM）
  只作工作副本——**无本地草稿目录**（dailog-editor 的 `.dailog-editor/drafts` 依赖已去除）
- **提示词工程**：`prompts/*.md`（r1-review → 审题；r2-script handoff+user → 创作；r3-polish → 打磨；r4-meta → 节目信息）+ prompts.json；
  服务端 promptSig（md mtime 指纹）随每轮输出落 `feedback/review.jsonl`——可回溯“哪版规则产生了这个结果”，构成提示词反馈闭环
- **采集**：lib/collect.mjs 自包含（不依赖 CLI）——分享链接解码 → dialogue.json → R2（URL 哈希 key）；
  服务端标记 collected；批量并发（/api/run/batch）
- **LLM 编排（lab 服务端直连，配置 lib/config.mjs + .env）**：DeepSeek 默认；审题、创作（多候选）、打磨（scope=all/one/line）、meta——
  统一信封注入（dialogue + review + host/guests），提示词按 key 指针取值；复用请求前缀缓存降本
- **工作流状态**：submitted → collected（采集完成）→ crafted（成品音频就绪）→ published / rejected；
  status 存服务端 submissions，lab 详情页驱动各环节

### 4.1 审题与脚本（提示词两段式）

- r1-review：主线话题 + 「用户的困惑」（逐字引用）+ 四维评分（共鸣×4/思考推进×2/张力×3/可迁移×1，硬伤写进维度理由）+
  创作方向——输出材料，不给通过/拒绝结论（编辑决定）
- r2-script（handoff = 剪辑规则 / user = 素材与任务）：保真单位 = **用户的问题链**；困惑颗粒不磨平；
  AI 点破困惑的提炼句与**重塑时刻**（换框架，“思考真正移动的证据，比金句更值钱”）近原样保留；任务式改写请教式；
  现场感（话筒是热的，禁重放腔/解说腔）；结尾必须收住（收获对 host 说，不对听众喊话）
- r3-polish：只做顺口 / 放大 / 停顿 / 情绪标签——三主角 = host 困惑句 / guest 接住与提炼 / 想通瞬间；
  北极星 = 听起来像“两个人在想”不是“两个人在念”；不做结构创作（事件/顺序/提炼句含义不可动），
  offset（1-10）汇报终稿与原文偏离并交代“动了哪/为什么/守住什么”

### 4.2 TTS 与合成

- **逐段 TTS**（lab 服务端 /api/run/tts-seg）：按 seg speaker 取参考——host = 投稿人采样（R2 voices），guest = 品牌声线（guests 采样）
  → ffmpeg 转 wav → Fish 单说话人合成（复用 tools/dailog-cli 的 fish 封装，底座迁移中）→ base64 mp3；段音频缓存浏览器 IndexedDB（5h TTL）
- 形态实测（`docs/spikes/fish-audio.md`）：msgpack references 内联音频；计费 ≈$9.7/M 字节（10 分钟期 ≈¥0.63）；
  免费模型 `s2.1-pro-free`（$0）可用；默认 temperature 0.7，同文本时长波动 ~12% 可接受
- **合成**（merge）：浏览器 ffmpeg.wasm（需跨域隔离 SAB）拼接各段 + 段间间隔表达式（可穿插 intro/外部音频 URL）+ 可选 BGM
  （音量/淡入淡出，两段式 amix 人声 1:1）；SAB 不可用 → 降级 lab 服务端 /api/run/full-merge（同一语义）
- **full audio**：合成确认 → 上传 R2 成品位 `episodes/{userId}/{submissionId}.m4a`（canonical，发布零拷贝）→ crafted 标记；
  上传失败可从 IndexedDB 本地副本重传

### 4.3 发布与封面

- meta 提示词（输入 = 定稿 segments）：title/summary/description/tags/coverKeywords/category/references/highlights——
  “卖过程不卖答案”，金句逐字来自台词
- 封面：按 coverKeywords 从图片源选图/生成（web/assets 与发布卡），发布时 multipart 上传 → R2 covers
- 发布（/api/run/publish-submit → `/v1/editor/submissions/:id/publish`）：cover + meta JSON（复用成品位音频）→
  episodes 表（published + 期号 max+1）→ 投稿 published + 通知 + 邮件
- 拒稿：/api/run/reject → `/v1/editor/submissions/:id/reject`（reason 必填）
- 清理：发布后清浏览器素材（store/seg/full 缓存），R2 产出物保留

## 5. 前端（apps/site）

- SolidStart + Cloudflare adapter，SSR 部署于 CF Pages/Workers
- 路由：`/`（landing：hero + **推荐滚屏**——每屏 4 条、最多 5 屏、末屏灰块补齐、加载骨架屏——+ 统计卡片 + FAQ）、`/discover`（四 tab：最新/热门/精选/榜单）、
  `/submit`（URL 输入 + 采样录音 + 提交）、`/hosts`（热门主播）、`/guests`（嘉宾列表）、`/guest/<id>`（嘉宾详情）、
  `/me/*`（个人中心 / episodes 我的节目·下架上架 / submits / favorites / notifications）、`/settings`、`/login`、
  `/subscribe`（订阅页）、`/@<username>`（主持人主页）、`/episode/<slug|id>`（播放页）、`/feed.xml`（单 feed RSS）
- **投稿页 = URL（前端基本 http/https 校验）+ 声音采样（必填）+ 人设（可选）→ POST /v1/submissions**；
  错误码映射（invalid_url / url_unreachable / pending_limit / existing）
- RSS：itunes 元数据 + 封面 + 节目列表（audio_size 直读 episodes，Apple enclosure 要求）
- 直连 Railway Postgres 读公开数据（只读查询 + 服务端只暴露公开字段）
- 站内 v1 代理（`/v1/*` → API）：submissions / me/* / notifications / favorites（收藏）/ episodes 互动（like·interactions）/ auth

## 6. 计费与成本（v1 无收款）

- **v1 无计费系统**——投稿制下无创作者收费（MRD §5）；v2 听众侧用 Apple/小宇宙平台原生收款
- 服务端成本：Railway（API+DB）~$5–15/月 + CF/R2 免费 + better-auth $0 + Resend 免费额度
- lab 制作成本（按量可控，经 lab 服务端直连）：LLM 几美分/期 + Fish TTS ~¥0.6/期 + Pexels 免费额度
- **编辑用稿率 = 成本总开关**（MRD §5）

## 7. 测试策略

- **API 契约**：Vitest + Hono app 直测（fake repo 注入）——submissions（URL 校验/触达性/并发/重复）、
  editor（队列/详情/拒审/发布 multipart/嘉宾/采样下载）、voice/profile/favorites/app/auth
- **真库集成**：门控（DATABASE_URL 存在时跑）——repo（submissions/episodes/guests/notifications）、
  auth 全链路、favorites 互动
- **前端**：site `typecheck`；dailog-cli 底座 `tsc --noEmit`
- **验证命令**：`pnpm -r typecheck` + `cd services/api && pnpm test`（本地 PG 时含真库用例）

## 8. 技术风险

| 风险 | 缓解 |
|---|---|
| 分享页反爬（CF/Turnstile） | dailog lab 采集器（lib/collect.mjs）交互式处理——**采集在编辑侧而非服务端**；拉取失败如实汇报，不伪造内容 |
| Fish 克隆音质受录音环境影响 | 录音引导（朗读固定文案、8–30s、可重录）；发布前本地试听 |
| lab 本地环境与浏览器缓存 | 前置：Node ≥22 本地运行 server.mjs；浏览器需跨域隔离（COOP/COEP，SAB）——不可用自动降级 lab 服务端 ffmpeg 合成；localStorage/IndexedDB 易失 → **关键产物即时 R2/入库（选定/采纳/定稿/成品），浏览器只存可再生工作副本** |
| 投稿队列积压 | 并发上限 5（429 引导等待）；编辑用稿率 = 成本总开关 |
| 重复投稿/垃圾投稿 | user×url 唯一 + 触达性检查 + 人工审核队列（编辑拒审附原因） |