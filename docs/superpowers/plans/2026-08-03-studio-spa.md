# 计划 5：工作台 SPA（app.dailogues.com）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

> **⚠️ 架构变更（2026-08-03 决策）**：认证方案由 Supabase Auth 改为 **better-auth**（自托管，与后端同库 Railway Postgres）。Task 1-3 中基于 supabase-js 的认证基建（auth.tsx、登录/注册页）在 **M5 迁移任务**中切换到 better-auth 客户端；后续未执行任务按目标态实现。前置条件中的 `VITE_SUPABASE_ANON_KEY` 不再需要。

**Goal:** 实现用户工作台单页应用（SolidJS + StyleX + Solid Router）：登录/注册 → 录音引导（声音克隆样本）→ 节目列表 → 四步向导（选对话 → 润色编辑 → 生成进度/试听 → 发布）→ 设置。与扩展采集器和统一后端打通，本地可完整跑通。

**Architecture:** `apps/studio/` 独立 Vite 应用（不依赖 SolidStart，纯 SPA 静态部署 CF Pages）。认证用 **supabase-js**（云端 Supabase Auth 签发 JWT，api 用 JWKS 校验同一 token——SPA 登录后直接可用）。API 客户端 fetch wrapper 带 Bearer；润色 SSE 用 **fetch 流式解析**（EventSource 无法带 Authorization 头）。录音用 `getUserMedia + MediaRecorder`（本地/HTTPS 环境可用），上传 `POST /api/me/voice-sample` 触发 Fish fast 音色训练。四步向导中"生成"步骤轮询 `GET /api/episodes/:id/job`（阶段 + 百分比）。扩展 token 注入：`chrome.runtime.sendMessage(EXTENSION_ID, {type:"dailogues:set-token"})`（background.ts 已实现接收端）。

**Tech Stack:** Vite 6 + vite-plugin-solid + StyleX（官方 `@stylexjs/babel-plugin` 经 `solid({ babel: { plugins: [[stylex, { treeshakeCompensation: false }]] } })` 接入——**maintainer 确认 StyleX 支持 Solid**，facebook/stylex#845；`treeshakeCompensation:false` 必须，否则 defineVars 运行时错误）+ `@solidjs/router` + supabase-js + Vitest（lib 单测，组件走本地手测清单）。

**前置条件（手动，由用户提供）：**
- 云端 Supabase project（已有：`SUPABASE_URL`/`SUPABASE_JWKS_URL` 已在 `services/api/.env.local`）→ 提供 **anon public key** 给 SPA（`VITE_SUPABASE_ANON_KEY`）；Auth 需允许测试邮箱登录（确认邮件流程或关闭 email confirmation）
- api 本地运行：`cd services/api && set -a && source .env.local && set +a && npm run dev`（端口 8787）
- 浏览器扩展（dev 模式 chrome://extensions 加载 `apps/extension`），获取其 extension id 填入 SPA env

**env 扩展**（新建 `apps/studio/.env.local`）：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_API_BASE_URL=http://localhost:8787`、`VITE_EXTENSION_ID=<dev 扩展 id>`

---

### Task 0: api 最小补充（工作台依赖的 3 个缺口）+ 测试

工作台需要但后端缺：CORS（跨域调 api）、音频回读（试听）、voice-sample 回读（onboarding 守卫）。

**Files:**
- Create: `services/api/src/middleware/cors.ts`
- Modify: `services/api/src/app.ts`（挂 CORS）
- Modify: `services/api/src/routes/voice.ts`（GET 回读）
- Modify: `services/api/src/routes/episodes.ts`（GET audio 流式返回）
- Modify: `services/api/src/config/env.ts`（`APP_ORIGINS` 逗号分隔列表）
- Modify: 对应测试 `services/api/tests/{app,voice,episodes}.test.ts`

- [x] **Step 1: CORS 中间件**——`createCorsMiddleware(origins: string[])`：匹配请求 Origin（dev `http://localhost:5173`、生产 `https://app.dailogues.com`）→ 设置 `Access-Control-Allow-Origin/Methods/Headers`；OPTIONS 返回 204；不匹配的 Origin 不加头（api 仍可被 curl 直调）。env 新增 `APP_ORIGINS`。
- [x] **Step 2: `GET /api/me/voice-sample`**——返回最新样本 `{ status, referenceId, audioUrl, duration, createdAt }` 或 404（从未录过）。repo 加 `getVoiceSample(userId)`（已有 `getVoiceSampleKey/getHostModelId`，补一个完整行读取）。
- [x] **Step 3: `GET /api/episodes/:id/audio`**——归属校验（getEpisode with userId）→ `storage.get(audioUrl)` → `c.body(流)` 带 `Content-Type: audio/mpeg`；无 audioUrl → 404。
- [x] **Step 4: 测试**——CORS 头/预检/跨域拒绝、voice-sample 404 与回读、audio 404 与 200 流（fs driver + 临时文件）。

### Task 1: 工程脚手架 spike（vite + solid + stylex 三件套验证）

**Files:**
- Create: `apps/studio/package.json`、`tsconfig.json`、`vite.config.ts`、`index.html`
- Create: `apps/studio/src/main.tsx`、`apps/studio/src/theme.ts`
- Test: 本地 `pnpm dev` 启动验证

- [x] **Step 1: 初始化**——`package.json`（vite、vite-plugin-solid、solid-js、@solidjs/router、supabase-js、@stylexjs/babel-plugin、@stylexjs/core、typescript、vitest）；vite.config：`solid({ babel: { plugins: [["@stylexjs/babel-plugin", { dev: true, runtimeInjection: true, treeshakeCompensation: false }]] } })` + dev server proxy `/api → http://localhost:8787`（避免 CORS 依赖，双保险）。
- [x] **Step 2: spike 验证**——`theme.ts`（`stylex.defineVars`：color/space/type token）+ 一个 `stylex.create` 组件渲染彩色文字；`pnpm dev` 启动无编译错误、样式注入生效（**styxel 运行时错误即本步验收失败**）。`pnpm build` 产物 CSS 文件存在。
- [x] **Step 3: dev proxy 验证**——页面 fetch `/api/health` 通。

### Task 2: API 客户端 + SSE 解析 + 认证基建

**Files:**
- Create: `apps/studio/src/lib/env.ts`
- Create: `apps/studio/src/lib/api.ts`
- Create: `apps/studio/src/lib/sse.ts`
- Create: `apps/studio/src/lib/auth.tsx`（SupabaseClient + AuthProvider + useAuth + RequireAuth/RequireVoice 守卫组件）
- Test: `apps/studio/src/lib/__tests__/{api,sse}.test.ts`

- [x] **Step 1: 写失败测试**（TDD）——`api.ts`：GET/POST/PUT 带 Bearer、非 2xx 抛 `ApiError{status,code,detail}`、`app.dailogues.com` 场景；`sse.ts`：从 `ReadableStream` 解析 `event:`/`data:` 行 → 回调（segment 增量、done、error），流中途截断不吞错误。
- [x] **Step 2: 实现 api.ts/sse.ts/env.ts**——baseURL `VITE_API_BASE_URL`；token 由 auth context 提供（无 token 时抛 `unauthenticated`）。
- [x] **Step 3: auth.tsx**——supabase-js `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)`；AuthProvider 持有 `createSignal<User|null>` + `onMount` 恢复 session + `signOut`；`RequireAuth`（无 session → `/auth`）、`RequireVoice`（无 voice-sample → `/onboarding/voice`，GET /api/me/voice-sample 判定）。
- [x] **Step 4: 测试通过**（mock fetch / mock ReadableStream，无 DOM 依赖）。

### Task 3: /auth 页（登录 + 注册）

**Files:**
- Create: `apps/studio/src/pages/auth.tsx`
- Modify: `apps/studio/src/main.tsx`（路由注册）

- [x] **Step 1: 表单**——登录/注册切换；注册字段：邀请码（必填，UI 校验非空——服务端校验计划 7 接入）、邮箱、密码（≥8）；StyleX 表单样式（品牌页头 + 卡片）。
- [x] **Step 2: 提交**——`supabase.auth.signInWithPassword` / `signUp`；错误映射（invalid_credentials/email_taken 等中文提示）；signUp 后若 `data.session` 为空 → "请查收确认邮件"状态页（Supabase 未开 email confirmation 时直接进）。
- [x] **Step 3: 登录跳转**——成功后按 voice-sample 有无 → `/onboarding/voice` 或 `/dashboard`。

### Task 4: /onboarding/voice 录音页（声音克隆样本）

**Files:**
- Create: `apps/studio/src/components/recorder.tsx`（可复用录音器）
- Create: `apps/studio/src/pages/onboarding-voice.tsx`

- [x] **Step 1: 录音器组件**——`getUserMedia({audio})` + `MediaRecorder`；状态机 `idle → recording → recorded → uploading → done/error`；波形可视化（canvas + AnalyserNode）；计时提示"10–30 秒"；≥8s 可提交，30s 自动停止；试听（录好的 Blob URL）+ 重录。
- [x] **Step 2: 上传**——`POST /api/me/voice-sample` multipart（`file=wav/webm blob`）；成功 → 标记完成 → dashboard；502 `voice_model_failed` → 错误提示 + 重试；403/401 → 回 auth。
- [x] **Step 3: 页面**——录音引导文案（为什么录、注意事项：安静环境、自然语速）+ 录音器 + 完成态。已录过（RequireVoice 放行场景）→ 提供"重录"入口（同组件）。
- [x] **Step 4: 录音状态机抽纯函数**（`reducer(state, event)`）配单测；组件本体进本地手测清单。

### Task 5: /dashboard（节目列表 + 扩展引导）

**Files:**
- Create: `apps/studio/src/pages/dashboard.tsx`
- Modify: `apps/studio/src/main.tsx`

- [x] **Step 1: 列表**——`GET /api/episodes`：标题、平台徽标（来源 import 平台）、状态徽标（草稿/已发布/失败）、创建时间、操作（编辑草稿 → `/episodes/new?id=`；已发布 → 占位链接）。空状态：引导安装扩展。
- [x] **Step 2: 扩展引导卡**——三步说明（安装/打开对话页点击采集/回到这里）；检测 `window.chrome?.runtime?.sendMessage` → `{type:"dailogues:set-token", token}`（EXTENSION_ID 来自 env）；成功后显示"扩展已连接"（本地 sessionStorage 记状态）。
- [x] **Step 3: 占位区**——邀请码卡片（"邀请好友"按钮置灰，计划 7 接入）、订阅入口（链接占位）。
- [x] **Step 4: 路由**——`/` 重定向 `/dashboard`；RequireAuth + RequireVoice 守卫。

### Task 6: /episodes/new 向导 ①②（选对话 + 润色编辑器）

**Files:**
- Create: `apps/studio/src/pages/new-episode.tsx`（向导外壳 + ①②③④ 步骤状态机）
- Create: `apps/studio/src/components/script-editor.tsx`
- Modify: `apps/studio/src/main.tsx`

- [x] **Step 1: ① 选对话**——`GET /api/episodes`（status=draft 且有 script 或语言为空项优先）列表；点选 → ②；URL `?id=` 直达 ②（dashboard "继续编辑"入口）。
- [x] **Step 2: ② 润色编辑器（首次）**——`GET /api/episodes/:id/script`；无 script → 自动触发 `POST /polish`（fetch 流式，SSE `segment` 事件逐段追加、`done` 返回 version）；422（质量门）→ 展示 reason + 返回①选别的对话。
- [x] **Step 3: ② 编辑能力**——段落卡片（host/guest 标签切换、textarea 编辑、上移/下移/删除、末尾插入）；"保存草稿"（PUT script）→ 提示成功；"下一步" → ③。
- [x] **Step 4: 编辑模型纯函数**（`scriptOps.ts`：updateText/move/remove/insert）配单测；SSE 展示逻辑手测。

### Task 7: 向导 ③④（生成进度/试听 + 发布）

**Files:**
- Modify: `apps/studio/src/pages/new-episode.tsx`
- Create: `apps/studio/src/components/generate-progress.tsx`

- [x] **Step 1: ③ 生成**——POST /generate → 202 → 轮询 `GET /api/episodes/:id/job`（1s 间隔，阶段映射中文文案 queued→排队/tts→合成语音/merge→拼接/upload→上传，百分比进度条）；failed → 展示 error + "重试"；403（配额不足）→ 展示购买引导（计划 7 前为静态文案）。
- [x] **Step 2: ③ 试听**——done → `GET /api/episodes/:id/audio` 播放 `<audio controls>`；"不满意" → 回 ② 修改后重新生成；"下一步" → ④。
- [x] **Step 3: ④ 发布**——标题（预填对话标题）、描述 textarea；POST /publish → 成功页（"节目已发布，播放页即将上线"+ 返回 dashboard）；发布后邀请码奖励说明（计划 7 前静态文案）。

### Task 8: /settings + 全局收尾 + 本地手测清单

**Files:**
- Create: `apps/studio/src/pages/settings.tsx`
- Modify: `apps/studio/src/main.tsx`（顶层导航布局）
- Create: `apps/studio/docs/manual-test.md`（本地手测清单）

- [x] **Step 1: /settings**——重录声音（复用 recorder 组件 + 上传）、邀请码管理（计划 7 前占位）、订阅状态（占位）、退出登录。
- [x] **Step 2: 全局**——顶部导航（dashboard/新建/设置 + 用户邮箱）、加载态骨架、错误 toast、404 页；StyleX token 统一走 theme.ts。
- [x] **Step 3: 本地手测清单**——文档化验收路径：`pnpm dev` + api + 真实 Supabase 登录 → 注册（无邀请码服务端校验）→ 录音上传（Fish 训练，参考真实 402 场景降级提示）→ 扩展采集一条对话 → dashboard 出现草稿 → 四步向导到发布。标注依赖 Fish 额度的步骤。
- [x] **Step 4: 全量回归**——`pnpm typecheck && pnpm test`（studio 单测 + api 单测）通过；`pnpm build` 产物可部署（CF Pages 静态）。

---

**验收标准（Definition of Done）：**
- `apps/studio` 本地 dev 全流程可用：注册/登录（真实 Supabase）→ 录音 → 扩展采集 → 润色编辑（SSE）→ 生成（job 轮询，真实 Fish 额度可用时跑到 done）→ 发布
- 所有单测通过；TypeScript 严格模式无错；StyleX 编译无运行时错误
- api 侧 3 个新增端点有测试覆盖，CORS 配置正确
- 邀请码/订阅均为 UI 占位（明确标注计划 7 接线），不阻塞主流程
