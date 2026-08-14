# 计划 6：消费端 SSR 站 + 统一登录（SSO）+ 收藏点赞 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建消费端内容站 dailogues.com（SolidStart SSR：首页/频道页/单集页/RSS/统一登录/收藏点赞），与 studio（app.dailogues.com）完全区分。**统一登录**：dailogues.com/login 为全站唯一登录入口，登录后写 `.dailogues.com` 共享 cookie，app.dailogues.com 免二次登录（跨子域同站 SSO）。**收藏/点赞**：api 新增数据层与端点，两站共用同一份数据。

**Architecture:**
- **站点形态**（最终定稿，无兼容跳转）：`dailogues.com` = 消费端（SSR）、`app.dailogues.com` = studio（SPA，无前缀路由）、`api.dailogues.com` = 统一后端（Railway）。**不存在 dailogues.com/app 路径**。
- **统一登录（SSO）**：SSR 站 `/login` 表单 → **SSR server 端代理** better-auth API（`/api/auth/*` 站内路由转发 api.dailogues.com，同源无 CORS）→ 登录成功拿 session token → **set-cookie：`Domain=.dailogues.com; SameSite=Lax; HttpOnly`**。app/api/dailogues 都是 .dailogues.com 子域（同站）→ 浏览器对 app.dailogues.com 访问 api.dailogues.com 自动带 cookie（跨子域同站，SameSite=Lax 合法，无第三方 cookie 风险）→ **两站共享会话**。
- **SPA 侧改造**：api client fetch 改 `credentials: "include"`（cookie 认证优先），localStorage token 机制降级为兜底；新增 `GET /api/auth/token`（cookie 会话 → 返回 token）供**扩展自动注入**（页面加载/登录后 sendMessage）。**登录页冗余（修正）**：`dailogues.com/login` 为主入口，`app.dailogues.com/login` 永久保留为备用登录页——两站都只依赖 api（无 SPA→SSR 耦合）；守卫默认跳主站 `/login?redirect=<原URL>`，主站不可达时备用页可用。
- **收藏/点赞**：新表 `favorites`/`likes`（user_id+episode_id 唯一约束）+ 端点 `POST/DELETE /api/episodes/:id/favorite|like`（toggle）+ `GET /api/me/favorites`（join episode 摘要）。SSR 站收藏请求：浏览器带 cookie → SSR server 读 token → 转发 api（Bearer）。SPA 无收藏页（消费端收藏在 dailogues.com/me）。
- **内容读取**：SSR 站 **server-only 直连读库**（postgres.js 只读连接 + 查询层，ARC 定稿：内容站直连读库不走统一后端）。
- **部署**：**双 Pages 项目**（`dailogues-studio` 静态 SPA + `dailogues-site` SSR）+ Railway API；CI 构建两项目；DNS：`dailogues.com`/`app.dailogues.com` CNAME 各自 Pages 项目、`api.dailogues.com` CNAME Railway。

**Tech Stack:** SolidStart（CF Pages adapter）+ StyleX（unplugin，同 studio 方案）/ better-auth（cookie 会话，server 代理）/ postgres.js（server-only 只读）/ drizzle（查询层）/ @solidjs/router（SSR 路由）

**前置条件（手动）：**
- DNS：dailogues.com、app.dailogues.com 指向各自 Pages 项目（部署阶段）
- api 环境：`APP_ORIGINS` 加 `https://dailogues.com,https://app.dailogues.com`（本地加 `http://localhost:3000`）
- 本地开发：SSR `localhost:3000` + SPA `localhost:5173` + api `localhost:8787`

---

### Task 1: api——收藏/点赞数据层 + CORS credentials + /api/auth/token

**Files:**
- Modify: `services/api/src/db/schema.ts`（+favorites/likes 表）
- Create: `services/api/src/routes/favorites.ts`（收藏/点赞端点）
- Modify: `services/api/src/routes/voice.ts` 或新增 `routes/token.ts`（GET /api/auth/token）
- Modify: `services/api/src/middleware/cors.ts`（Allow-Credentials）
- Modify: `services/api/src/app.ts` / `index.ts`（挂载 + deps）
- Test: `services/api/tests/favorites.test.ts` + CORS 用例更新

- [x] **Step 1: 写失败测试**——favorites.test.ts：收藏 toggle（POST 收藏 → GET /api/me/favorites 含该集 → DELETE 取消）；点赞 toggle（同用户重复点赞幂等）；未登录 401；他人 episode 收藏 404（归属校验）。CORS：credentials 请求带 Allow-Credentials 头。
- [x] **Step 2: schema + 迁移**——`favorites(id, userId fk→user, episodeId fk→episodes, createdAt, unique(userId, episodeId))`、`likes` 同构。
- [x] **Step 3: 端点**——`POST/DELETE /api/episodes/:id/favorite`（episode 存在校验 → upsert/delete → `{ favorited: bool }`）；like 同款；`GET /api/me/favorites`（join episodes：id/title/status/audioUrl/durationSeconds/publishedAt）。
- [x] **Step 4: GET /api/auth/token**——cookie 会话（`auth.api.getSession`）→ `{ token }`；无会话 401。SPA 扩展注入用。
- [x] **Step 5: CORS credentials**——`Access-Control-Allow-Credentials: true`（仅白名单 Origin 时附带）。
- [x] **Step 6: 测试通过 + 全量回归**。

### Task 2: SSR 站骨架（apps/site）

**Files:**
- Create: `apps/site/package.json`、`tsconfig.json`、`app.config.ts`（SolidStart + CF adapter）
- Create: `apps/site/src/routes/...`（/、/@username、/episode/:id、/@username/feed.xml）
- Create: `apps/site/src/lib/db.ts`（server-only 只读连接 + 查询层）
- Create: `apps/site/src/theme.stylex.ts`（消费端 token，与 studio 同体系）

- [x] **Step 1: 脚手架 spike**——SolidStart + CF Pages adapter + StyleX（unplugin）最小 SSR 渲染验证（本地 `pnpm dev` + `pnpm build` 通过）。
- [x] **Step 2: server-only 读库**——`src/lib/db.ts`：postgres.js 只读连接（`?sslmode=require` 生产）暴露查询：getPublishedEpisodes（最新/热门排序）、getEpisodeById（published 过滤）、getChannelByUsername（profile + episodes）、getChannelFeed（RSS 数据）。
- [x] **Step 3: 路由页**——`/`（最新 + 热门列表，纯展示）；`/@username`（频道页：简介 + 节目列表）；`/episode/:id`（单集页：标题/描述/时长/audio 播放器 + 点赞/收藏按钮（登录态感知）+ "查看原文"入口）；`/@username/feed.xml`（RSS 2.0：title/link/description/pubDate/enclosure mp3——id = episode 短 id）。
- [x] **Step 4: 消费端样式**——首页/频道页/单集页 StyleX（token 复用 + 消费端排版）。
- [x] **Step 5: 本地验证**——fixture 数据（DB 造 published episode）→ 三页渲染 + RSS XML 校验。

### Task 3: 统一登录（SSO）+ SPA 会话切换

**Files:**
- Create: `apps/site/src/routes/login.tsx`（表单）+ `apps/site/src/server/auth-proxy.ts`（server 代理 better-auth API + set-cookie）
- Create: `apps/site/src/server/session.ts`（cookie 读取/验证中间件）
- Modify: `apps/studio/src/lib/api.ts`（credentials include）
- Modify: `apps/studio/src/lib/auth.tsx`（cookie 优先，localStorage 兜底）
- Modify: `apps/studio/src/lib/guards.tsx`（未登录跳 `dailogues.com/login?redirect=`，dev 保持 /login）

- [x] **Step 1: server 代理**——`apps/site/src/server/auth-proxy.ts`：`POST /api/auth/sign-in/email`、`sign-up/email`、`sign-out`、`GET /api/auth/get-session` 转发 api.dailogues.com（env `API_BASE_URL`）；登录成功响应透传 token → server 侧 `set-cookie: dailogues_session=token; Domain=.dailogues.com; Path=/; HttpOnly; SameSite=Lax`（本地 dev Domain 省略/用 localhost 验证）。
- [x] **Step 2: /login 页**——登录/注册切换表单（样式同 studio 风格）；成功 → 302 回 `redirect`（白名单：仅允许 dailogues.com/app.dailogues.com 域）；本地 dev 回跳 localhost 端口。
- [x] **Step 3: 会话中间件**——SSR 页读取 cookie → 转发 `get-session` 验证（server 端，带 User-Agent）→ 注入页面上下文（header 显示登录邮箱/登出按钮）。
- [x] **Step 4: SPA 会话切换**——api client `credentials: "include"`（cookie 自动带）；`auth.tsx`：启动先 `GET /api/auth/get-session`（cookie）→ 成功即登录态（localStorage token 仅作 dev 兜底）；`GET /api/auth/token` 拿 token 供扩展注入；guards 未登录 → `dailogues.com/login?redirect=当前页`（dev 环境跳本地 /login）；**app/login 永久保留为备用登录页**（两站登录都写同一 .dailogues.com cookie）。
- [x] **Step 5: 本地 SSO 验证**——SSR(3000) 登录 → cookie 落 localhost → SPA(5173) fetch api(8787) credentials 带 cookie → 已登录（跨端口同站验证）；生产跨子域同理。

### Task 4: 收藏/点赞 UI + 扩展自动注入

**Files:**
- Modify: `apps/site/src/routes/episode/[id].tsx`（点赞/收藏按钮交互）
- Create: `apps/site/src/routes/me.tsx`（收藏列表页 dailogues.com/me）
- Modify: `apps/extension/src/background.ts`（401 → 跳登录）
- Modify: `apps/studio/src/lib/client.ts` / 扩展注入点（自动注入）

- [x] **Step 1: 单集页交互**——点赞/收藏按钮：登录态（session 中间件注入）→ 直接调（SSR server 转发 api）；未登录 → 跳 `/login?redirect=/episode/:id`；成功后按钮态切换。
- [x] **Step 2: /me 页**——收藏列表（episode 卡片 + 播放入口 + 取消收藏）。
- [x] **Step 3: 扩展自动注入**——studio 页面加载/登录成功 → `GET /api/auth/token` → sendMessage 注入；扩展采集 401 → `chrome.tabs.create({ url: dailogues.com/login?redirect=<对话页> })`（env 注入登录页地址）。
- [x] **Step 4: studio dashboard 引导卡文案更新**（连接扩展 → 自动注入说明）。

### Task 5: 部署形态 + 收尾

**Files:**
- Modify: `docs/console-setup.md`（双 Pages 项目 + DNS + 环境变量矩阵更新）
- Modify: `.github/workflows/ci.yml`（构建 studio + site 两项目）
- Modify: `apps/studio/docs/manual-test.md`（SSR + SSO 验证链）

- [x] **Step 1: 部署配置**——console-setup：dailogues-site（SSR, production branch master/dev）+ dailogues-studio（静态）双项目；DNS 三域名；api APP_ORIGINS 生产矩阵。
- [x] **Step 2: CI**——两项目构建产物校验。
- [x] **Step 3: 本地端到端验证链**——SSR 登录 → SSO 进 SPA → 收藏 → /me 可见 → RSS 可订阅 → 扩展自动注入采集成功。
- [x] **Step 4: 全量回归**（api + studio + site 三包 tests/typecheck/build）+ 文档更新。

---

**验收标准（Definition of Done）：**
- dailogues.com 三页（首页/频道页/单集页）+ RSS 真实渲染（本地 fixture + 生产数据）
- **统一登录 SSO 打通**：dailogues.com/login 登录 → app.dailogues.com 免登录（同 cookie）；SPA 守卫跳主站登录
- 收藏/点赞：两站共用数据（SSR 单集页收藏 → dailogues.com/me 可见；SPA 侧无收藏页）
- 扩展自动注入 + 401 跳登录回跳链路可用
- 双 Pages 项目部署配置就绪；三包测试全绿
