# ARC — 技术架构

> 状态：本质版（2026-08-13 架构极简改造后重写）——投稿 = URL + 采样；制作 = 编辑本地 Agent。
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
| **编辑本地** | ZCode Agent + `tools/dailog-editor` 工程（skill + CLI） + 本机 ffmpeg | 编辑机器本地（无需部署） |

**服务端职责：API 校验落库 + 认证 + 统一 TTS 端点 + 公开内容服务**——内容拉取、脚本生成、
音频合成拼接、封面制作由编辑本地 Agent 完成（服务端曾实现 importer 采集服务与生成管线，
2026-08-13 已删除）；语音合成收敛为服务端统一端点 `/v1/editor/tts`（Fish TTS + ffmpeg 转 wav，
编辑本地一次调用，multi-speaker 整集合成）。

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
         │  编辑本地 Agent（ZCode + tools/dailog-editor + ffmpeg）    │
         │  list → detail → download 采样 → 拉取网页 → 生成脚本         │
         │  → TTS（服务端 /v1/editor/tts 统一端点）→ ffmpeg 合成        │
         │  → Pexels 封面 → publish 一次性上传                          │
         └──────────────────────────────────────────────────────────────┘
```

**数据流向**：投稿人提交 URL + 采样 → API 校验落库（submissions=submitted）→ 编辑本地 Agent
拉取待审队列 → 本地完成全部制作 → multipart 一次性上传（音频→R2、元数据→episodes 表，
published + 期号 max+1）→ 投稿人收到通知（站内 + 邮件）。内容站 SSR 直连读库展示公开节目。

## 3. 统一后端（services/api）

### 3.1 技术选型

- Node.js + TypeScript + **Hono**（轻量路由）
- **Drizzle ORM** + Railway Postgres（迁移 + 类型安全）
- **better-auth**（自托管，邮箱 + 密码 + 会话；后端中间件验证会话）
- **无任务队列 / 无 LLM**（本地编辑管线的存在使服务端保持极简）；**含统一 TTS 端点**（`/v1/editor/tts`：Fish TTS 代理 + ffmpeg 转 wav，`requireRole(editor|admin)`）
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
| `POST/DELETE /v1/episodes/:id/like`、`GET /v1/episodes/:id/interactions` | ✓ | 消费端互动（简化版 0034）：仅点赞 toggle（返回最新计数）+ interactions 合并返回点赞状态与计数；收藏已移除（由「加入播放列表」+ 默认列表覆盖） |
| `GET /v1/public/episodes/:id/audio\|cover` | — | 公开播放（仅 published + is_public；音频 ETag 缓存） |
| `GET /v1/public/episodes/:id/stats`、`POST /v1/public/episodes/:id/stats/:type` | — | 播放/完播统计（0036 恢复展示：详情页播放/完播次数 + 点赞计数；播放器上报 + 限频） |
| `GET /v1/public/episodes/recommended` | — | 推荐队列（热度分排序 + 语言优先；首页滚屏每屏 4 条 × 最多 5 屏 / 发现页） |
| `GET /v1/public/playlists`、`GET /v1/public/playlists/:slug` | — | **播放列表**（0032）：平台公开列表索引（`?lang=zh|en` 语言偏好优先 + 精选优先，不足自然回退；附节目数与首期封面）+ 详情（仅公开节目，position 排序） |
| `POST/GET/PATCH/DELETE /v1/me/playlists`、`/v1/me/playlists/:id` | ✓ | **我的播放列表**：创建（kind=user）/ 列表（含私有，?contains= 附带收录标记）/ 编辑 / 删除（归属校验 404） |
| `POST/DELETE /v1/me/playlists/:id/episodes`、`PUT .../episodes/reorder` | ✓ | **我的列表条目**：加节目（校验公开、重复幂等）/ 移除 / 重排（有序 episodeIds） |
| `POST/GET/PATCH/DELETE /v1/editor/playlists`、`/v1/editor/playlists/:id` | editor | **平台策展列表**（kind=platform，isPicked 精选标记）+ 条目管理（同 /me 形态，requireRole 守卫） |
| `POST /v1/editor/playlists/:id/cover`、`GET /v1/public/playlists/:id/cover` | editor / — | **列表封面**：multipart 上传（sharp 归一 1400² JPEG → R2 `covers/playlists/{id}.jpg`）/ 公开读取（缓存 86400s） |
| `GET /v1/public/stats`、`/hosts`、`/guests`、`/guests/:id` | — | 站点头部数据 / 热门主播 / 嘉宾列表 / 嘉宾详情（含参与节目） |
| `GET /v1/me/episodes`、`PATCH /v1/me/episodes/:id` | ✓ | **我的节目**（列表含已下架）/ 下架·重新上架（切换 is_public，仅归属人） |
| `GET /v1/editor/submissions?status=` | editor | **待审队列**（先到先审；含投稿人邮箱/显示名/采样就绪标记） |
| `GET /v1/editor/submissions/:id` | editor | 投稿详情（URL/投稿人/**采样 transcript**/已上线节目） |
| `POST /v1/editor/submissions/:id/reject` | editor | 拒审（reason 必填 → rejected + 通知 + 邮件） |
| `POST /v1/editor/submissions/:id/publish` | editor | **一次性上传发布**（multipart：audio + cover? + meta JSON）→ 音频/封面存 R2 → episode 创建（published + 期号 max+1）→ 投稿 published + 通知 + 邮件 |
| `GET /v1/editor/guests` | editor | 嘉宾列表（品牌声线宿主） |
| `GET /v1/editor/samples/host/:userId/audio`、`/guest/:guestId/audio` | editor | 主持人/嘉宾采样音频下载（本地 TTS 参考） |
| `POST /v1/editor/tts` | editor | **统一 TTS 端点**：Fish TTS 合成（multi-speaker，msgpack references）+ ffmpeg 转 wav（编辑本地一次调用） |
| `GET /v1/editor/episodes`、`PUT /v1/editor/episodes/:id` | editor | 已发布节目清单 / 微调（tags/精选/标题/简介/封面） |
| `POST/GET /v1/device/approve` 等 `/v1/device/*` | ✓ | 设备配对授权（编辑/管理员角色，自包含授权页） |

### 3.3 数据模型（本质版）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `submissions` | `user_id`, `url`, `title`, `status`(submitted/rejected/published), `rejected_reason`, `reviewed_at` | **投稿**：URL + 采样（采样在 voice_samples，投稿只关联 userId）；唯一约束 `(user_id, url)` 防重复 |
| `episodes` | `submission_id`, `user_id`, `host_id`, `guest_id`, `slug`, `title`, `description`, `cover_url`, `audio_url`(R2), `audio_size`, `duration_seconds`, `language`, `tags`, `number`(期号), `is_picked`, `status`(published), `is_public`, `published_at` | **成品节目**：编辑上传即发布（published + isPublic）；期号发布时 max+1 分配——"dailog 第 N 期" |
| `guests` / `guest_voice_samples` | `platform`(枚举), `name`, `intro` + `audio_key`, `reference_id`, `transcript` | **AI 平台嘉宾库 + 品牌声线采样**（编辑本地 TTS 的嘉宾音色来源；guest×language 唯一） |
| `voice_samples` | `user_id`, `language`, `audio_url`(R2), `transcript`, `duration`, `status` | 投稿人声音采样（一人多语种各一条；主持人克隆音色参考） |
| `profiles` | `id`(=auth.users), `display_name`, `bio`, `persona`(JSONB) | 主持人档案（账号级属性在 user 表：`name`=@slug、`role`(user/editor/admin)、`image`） |
| `notifications` | `user_id`, `type`(rejected/published), `title`, `body`, `link` | 站内通知（拒审/上线） |
| `favorites` / `likes` | `user_id`, `episode_id` | 消费端互动 |
| `playlists` | `slug`(唯一), `kind`(platform/user), `owner_id`, `title`, `description`, `cover_url`, `is_public`, `is_picked`, `is_default`, `language` | **播放列表**（0032；0033/0035）：平台策展（编辑创建，精选标记）/ 用户自建（公开可分享）+ **每个用户一个 is_default「我的收藏」默认列表**（Spotify 式，强制私有、不可编辑/删除）；封面 = 编辑自定义上传（无则自动取首期节目封面） |
| ~~`favorites`~~ / `episode_stats` | — | 收藏表已移除（0033，并入默认播放列表）；`episode_stats` 播放/完播统计保留（0036 恢复）；`likes` 保留 |
| `playlist_episodes` | `playlist_id`+ `episode_id`(唯一), `position` | **列表条目**（有序集合）：删列表/删节目级联清理；索引 (playlist_id, position) 顺序读 + (episode_id) 反查「收录于」 |
| auth 表（`user`/`session`/`account`/`verification`） | better-auth 官方字段 | 认证 |

**已删除表（0026 迁移）**：`snapshots`、`polishes`、`transcripts`、`tracks`、`generation_jobs`、`payments`、`subscriptions`（内容五层旧模型；支付 v1 无）。

**R2 存储路径**：
```
voices/{userId}/{language}.webm            ← 投稿人采样（录音上传）
episodes/{userId}/{submissionId}.mp3       ← 成品音频（编辑上传，不可变）
covers/{submissionId}.jpg                  ← 封面（可选；无封面播放页自适应）
```

## 4. 编辑本地 Agent（tools/dailog-editor 工程 → skill 产物）

- **配置**（db-ops 风格）：`.dailog-editor/.env`（gitignored，chmod 600）——API_BASE /
  编辑账号 / FISH_API_KEY / PEXELS_API_KEY / GUEST_REFERENCE_ID；模板 `.env.example`
- **草稿**：`.dailog-editor/drafts/{submissionId}/`（gitignored）——脚本 JSON、采样（webm/wav/transcript）、
  分段音频、final.mp3、封面；发布成功后保留（可重新生成对比）
- **命令**：`overview / batch / batch-reject / batch-scripts / produce / fetch / script-preview / tts / merge / cover / publish / reject / guests / guest-voice / guest-set / playlist / progress` 等（源码 `tools/dailog-editor/src/`，编译产物 `.agents/skills/dailog-editor/scripts/*.js`）
- **认证**：编辑账号登录（better-auth sign-in/email）→ bearer token（内存缓存）
- **工作流规范**（脚本生成标准/情绪标签/开场白结构）：`.agents/skills/dailog-editor/SKILL.md`

### 4.1 TTS（统一服务端端点，编辑本地调用）

形态实测知识（`docs/spikes/fish-audio.md`，服务端集成时实测）：
- **整集合成**（tools/dailog-editor/src/tts.ts 调用 `/v1/editor/tts`）：multi-speaker 一次调用
  （msgpack `references` 内联音频 + transcript，必须 msgpack——JSON 无 base64 字段）；
  host 段 = 投稿人采样零样本克隆，guest 段 = 品牌声线（guests 采样克隆，服务端取用）
  guest 段 = 品牌声线（guests 采样克隆或 `GUEST_REFERENCE_ID` 音色模型）
- 端点：`POST https://api.fish.audio/v1/tts`（msgpack body）；`format=mp3`、`streaming=false`
- 计费：官方 $15/百万字节（实测账单 ≈$9.7/M 字节 → 10 分钟期 ≈ ¥0.63）；免费模型 `s2.1-pro-free`（$0）实测全功能可用
- 一致性：默认 `temperature=0.7`，同文本两次时长波动 ~12%——可接受；长节目可调低或按段重试

### 4.2 合成（ffmpeg，编辑本地）

`tools/dailog-editor/src/merge.ts`：段间 0.6s 静音 + 可选 intro/outro（本地资产路径，缺失降级）
→ concat demuxer 拼接 → `final.mp3`（libmp3lame 192k）→ ffprobe 时长。**发布前必须试听**。

### 4.3 封面（编辑本地）

`tools/dailog-editor/src/cover.ts`：Pexels 关键词搜索（脚本 coverKeywords）→ 下载到草稿目录 →
发布时随 multipart 上传（服务端存 R2 `covers/{submissionId}.jpg`）；无封面 → 不传（播放页自适应）。

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
- 站内 v1 代理（`/v1/*` → API）：submissions / me/* / notifications / favorites / episodes 互动（favorite·like·interactions）/ auth

## 6. 计费与成本（v1 无收款）

- **v1 无计费系统**——投稿制下无创作者收费（MRD §5）；v2 听众侧用 Apple/小宇宙平台原生收款
- 服务端成本：Railway（API+DB）~$5–15/月 + CF/R2 免费 + better-auth $0 + Resend 免费额度
- 编辑本地成本（按量可控）：LLM 脚本生成几美分/期 + Fish TTS ~¥0.6/期 + Pexels 免费额度
- **编辑用稿率 = 成本总开关**（MRD §5）

## 7. 测试策略

- **API 契约**：Vitest + Hono app 直测（fake repo 注入）——submissions（URL 校验/触达性/并发/重复）、
  editor（队列/详情/拒审/发布 multipart/嘉宾/采样下载）、voice/profile/favorites/app/auth
- **真库集成**：门控（DATABASE_URL 存在时跑）——repo（submissions/episodes/guests/notifications）、
  auth 全链路、favorites 互动
- **前端**：site `typecheck`；编辑脚本 `tsc --noEmit`
- **验证命令**：`pnpm -r typecheck` + `cd services/api && pnpm test`（本地 PG 时含真库用例）

## 8. 技术风险

| 风险 | 缓解 |
|---|---|
| 分享页反爬（CF/Turnstile） | 编辑本地 Agent 有浏览器（browser-use/WebFetch）可交互处理——**这正是去掉服务端采集的原因**；拉取失败如实汇报，不伪造内容 |
| Fish 克隆音质受录音环境影响 | 录音引导（朗读固定文案、8–30s、可重录）；发布前本地试听 |
| 编辑流程依赖本地环境 | 前置要求明确（Node ≥22 + ffmpeg）；脚本报错信息具体可重试；草稿保留可对比重做 |
| 投稿队列积压 | 并发上限 5（429 引导等待）；编辑用稿率 = 成本总开关 |
| 重复投稿/垃圾投稿 | user×url 唯一 + 触达性检查 + 人工审核队列（编辑拒审附原因） |
