# 计划 M5：认证迁移 better-auth + 数据层切换（Railway Postgres）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 按 2026-08-03 架构决策（fa236ec）把认证从 Supabase Auth 迁移到 **better-auth**（自托管，邮箱+密码+会话，与后端同库），同时完成数据层向纯 Postgres 的收敛（profiles 关联 better-auth user 表；Railway Postgres 连接是部署动作，本地 docker PG 继续开发）。工作台 SPA 的认证基建（supabase-js）同步切换，扩展 token 注入协议不变。

**Architecture:** better-auth v1.6（latest）作为统一后端的认证内核：
- **Bearer token 模式**（非 cookie）：启用官方 `bearer()` 插件。SPA 登录/注册从响应取 **session token** → 内存 signal + localStorage 持久化 → 所有 api 调用走 `Authorization: Bearer <token>` → 扩展注入同 token（**扩展侧零改动**，与现有 `dailogues:set-token` 协议完全兼容）。跨域无需 cookie/CORS credentials，现有 CORS（Authorization 头已允许）直接可用。
- api 集成：`app.on(["POST","GET"], "/api/auth/*", handler)` 挂载在认证中间件**之前**；认证中间件从 JWKS 校验改为 `auth.api.getSession({ headers: c.req.raw.headers })`（cookie + Bearer 双通道）→ `userId = session.user.id`。`GET /api/auth/get-session` 供 SPA 启动恢复会话。
- 数据：better-auth 官方 drizzle 表（user/session/account）+ `drizzleAdapter(db, { provider: "pg" })`；**profiles.id 由 uuid 改 text**（better-auth user.id 默认 text，外键 user_id 同步）；`inviteCodes` 表已存在，注册时经 better-auth `databaseHooks.user.create.before` 校验邀请码（无效拒绝注册、有效标记 usedBy + 建 profile 行），**最小 admin CLI** 生成邀请码（完整发放/奖励逻辑属计划 7）。
- 风险预案：若 bearer 插件 + getSession 在本版本行为不一致（GitHub issue #1405/#6583 曾报告），fallback 到 cookie 会话 + `credentials: "include"` + CORS `Access-Control-Allow-Credentials`；Task 1 单测先行验证。

**Tech Stack:** better-auth（`better-auth` + `better-auth/adapters/drizzle`）/ Hono handler / drizzle-kit 迁移（user/session/account + profiles 改型）/ tsx CLI / studio 端手写轻量 auth client（无 supabase-js）

**前置条件（手动）：**
- 本地 docker Postgres（已有，DATABASE_URL 不变）
- `BETTER_AUTH_SECRET`（本地 dev 随便 32+ 字符；Railway 各环境独立设置，见 docs/console-setup.md）

**env 变更**（`services/api/.env.local` + `.env.example`）：移除 `SUPABASE_URL`/`SUPABASE_JWKS_URL`，新增 `BETTER_AUTH_SECRET`；studio 移除 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`

---

### Task 1: api 认证迁移（better-auth 内核 + 邀请码注册 + CLI）

**Files:**
- Modify: `services/api/src/db/schema.ts`（+user/session/account 表；profiles.id → text）
- Create: `services/api/src/auth/better-auth.ts`（auth 实例：drizzle adapter + emailAndPassword + bearer + hooks）
- Modify: `services/api/src/middleware/auth.ts`（getSession 校验）
- Modify: `services/api/src/app.ts`（挂 /api/auth/*，先于认证中间件）
- Create: `services/api/src/cli/invites.ts`（管理员生成邀请码）
- Modify: `services/api/src/config/env.ts`（BETTER_AUTH_SECRET）
- Modify: `services/api/.env.local`/`.env.example`
- Test: `services/api/tests/auth.test.ts`（重写为 better-auth 真实流程）

- [x] **Step 1: 写失败测试**——`auth.test.ts`：① 注册（带有效邀请码）→ 201 + 响应含 token；② 无邀请码/无效邀请码 → 拒绝；③ 登录 → token 可用（`GET /api/me` 200）；④ 无效 token → 401；⑤ 注册后 invites.usedBy 被标记 + profiles 行存在。注册→登录→受保护接口全链路走**真实本地 PG**（db.test.ts 同款门控）。
- [x] **Step 2: schema 迁移**——user/session/account 三表（按 better-auth drizzle 官方字段：user{id text, name, email unique, emailVerified, image, createdAt, updatedAt}、session{id, token unique, userId fk, expiresAt, ipAddress, userAgent, createdAt, updatedAt}、account{id, userId fk, accountId, providerId, ...}）；`profiles.id`/`user_id`/`created_by`/`issued_for_episode_id` 等 uuid 外键列 → text（drizzle-kit generate 生成 ALTER 迁移）。
- [x] **Step 3: auth 实例**——`betterAuth({ database: drizzleAdapter(db, { provider: "pg" }), secret, emailAndPassword: { enabled: true, minPasswordLength: 8 }, bearer: {}, databaseHooks: { user: { create: { before: 邀请码校验 } } }, user: { additionalFields: { inviteCode: { type: "string" } } } })`——before hook 校验：inviteCodes 表存在且 code 未用未过期 → 事务内标记 usedBy（新用户 id 未生成，先标记 usedAt/占位再回填，或 after hook 回填；实现细节以单测为准）→ 校验失败抛 `APIError(400, "invalid_invite_code")`；注册成功创建 profiles 行（after hook，displayName 取邮箱前缀、username 随机）。
- [x] **Step 4: 中间件与挂载**——`createAuthMiddleware` 改为 `auth.api.getSession({ headers })` → `userId = session.user.id`；app.ts `app.on(["POST","GET"], "/api/auth/*", c => auth.handler(c.req))` 注册在认证中间件之前（CORS 之后）。
- [x] **Step 5: CLI**——`src/cli/invites.ts create <code> [--expires 7d]`（insert inviteCodes：source=admin、createdBy 用占位 admin profile 或 nullable——schema createdBy 是 notNull，CLI 建/复用 admin profile）。
- [x] **Step 6: env + 测试通过**——BETTER_AUTH_SECRET 接入 loadEnv；单测全绿（含 E2E 门控不回归：e2e 测试的假 verifyToken 路径保留——createApp 的 verifyToken 参数改为可选注入，E2E 继续用假 token，与 better-auth 并存）。

### Task 2: studio 认证切换（better-auth 客户端，bearer 模式）

**Files:**
- Create: `apps/studio/src/lib/auth-api.ts`（signIn/signUp/getSession/signOut 轻量 fetch 客户端）
- Modify: `apps/studio/src/lib/auth.tsx`（token 内存 signal + localStorage 持久化；user 信息来自 getSession）
- Modify: `apps/studio/src/pages/auth.tsx`（提交逻辑换 auth-api；邀请码字段已存在直接接线）
- Modify: `apps/studio/src/lib/env.ts`（移除 supabase 配置）
- Modify: `apps/studio/src/lib/api.ts`（错误映射兼容 better-auth 错误格式）
- Test: `apps/studio/src/lib/__tests__/auth-api.test.ts`（mock fetch：注册/登录/会话恢复/登出路径）

- [x] **Step 1: 写失败测试**——auth-api.ts 客户端：signUp(含 inviteCode) → token 落 localStorage；signIn → token；getSession(bearer) → user；signOut 清 token；错误响应（400 invalid_invite_code / 401）映射。
- [x] **Step 2: auth.tsx 重写**——`AuthProvider`：`token` signal（启动时 localStorage 恢复 → getSession 验证 → 失效则清）；`user` 从 session 响应；`signIn/signUp/signOut` 调 auth-api；`setTokenGetter` 接线不变（api client 同步取 token）。
- [x] **Step 3: auth 页**——提交逻辑换 auth-api；注册成功（有 token）→ /onboarding/voice；登录 → /dashboard；错误文案（invalid_invite_code → "邀请码无效"）。
- [x] **Step 4: env 清理**——删除 VITE_SUPABASE_*；`VITE_API_BASE_URL` 保留。
- [x] **Step 5: 测试通过 + typecheck + build**。

### Task 3: 本地端到端验证 + 收尾

**Files:**
- Modify: `apps/studio/docs/manual-test.md`（认证步骤更新：注册邀请码来自 CLI）
- Modify: `docs/console-setup.md`（若 CLI 用法变化补充）
- Modify: `services/api/.env.example`

- [x] **Step 1: CLI 造码**——`pnpm --filter @dailogues/api invites:create test-code-1` → 本地 PG invites 表有记录。
- [x] **Step 2: 本地端到端（真实 api + 真实 PG）**——api dev 起（BETTER_AUTH_SECRET 已配）→ curl 注册（带码）→ 响应 token → Bearer 调 GET /api/me → 200；无码注册 → 400；studio dev → 注册页真实注册 → 进 dashboard（sessionStorage token）。
- [x] **Step 3: 全量回归**——api `vitest run`（含新 auth 单测）+ studio `vitest run` + `tsc --noEmit` 双包 + studio build；真实 E2E 复跑（门控，假 verifyToken 路径）确认无回归。
- [x] **Step 4: 文档更新**——manual-test.md 认证段重写；AGENT.md/ARC.md 中残留 Supabase 引用清理（如还有）；提交。

---

**验收标准（Definition of Done）：**
- 注册（邀请码门禁）→ 登录 → Bearer 会话 → 受保护接口 → 登出，全链路在本地真实 PG 上跑通（curl + studio 页面）
- better-auth 三表迁移落库，profiles 与 user 表正确关联；旧 Supabase 相关 env/依赖（supabase-js、jose JWKS 路径）从 api 与 studio 移除
- 扩展采集 token 注入协议不变（SPA → 扩展 → api 链路在 dev 环境可用）
- 全量单测通过；真实 E2E 无回归；CLI 邀请码生成可用
