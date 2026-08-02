# 计划 1：统一后端骨架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 monorepo 与 `api.dailogues.com` 统一后端骨架：TypeScript + Hono + Drizzle 全量数据模型 + Supabase JWT 认证 + Fly.io Docker 部署 + GitHub Actions CI/CD。

**Architecture:** pnpm workspace（`services/api` + `packages/*` 占位）。后端为单一 Hono 应用，通过依赖注入（`createApp({ env, verifyToken })`）保证可测试性：测试注入 fake env 与 fake token verifier，不触达真实环境。数据库为 Supabase Postgres，Drizzle ORM 负责 schema 与迁移。生产运行用 tsx（MVP 简化，不做打包），Docker 镜像内置 ffmpeg（为后续生成管线准备）。

**Tech Stack:** pnpm 9 / Node 22 / TypeScript 5 / Hono 4 / Drizzle ORM + drizzle-kit / postgres.js / jose / zod / Vitest 3 / tsx / Docker / GitHub Actions / Fly.io

**前置条件（手动一次性，非任务）：**
- 创建 GitHub 仓库并推送本仓库
- 创建 Supabase 项目（获取 URL；数据库连接串 `DATABASE_URL`）
- 安装 flyctl，`fly auth login`，`fly apps create dailogues-api`
- `fly secrets set DATABASE_URL=... SUPABASE_URL=... SUPABASE_JWKS_URL=...`（JWKS 为 `<SUPABASE_URL>/auth/v1/jwks`）
- Fly token（`fly tokens create`）加入 GitHub Secrets：`FLY_API_TOKEN`

---

### Task 1: 初始化 monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `services/api/.gitkeep`（占位，下一任务填充）
- Create: `packages/shared/.gitkeep`

- [ ] **Step 1: 创建根 `package.json`**

```json
{
  "name": "dailogues",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test"
  }
}
```

- [ ] **Step 2: 创建 `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "services/*"
```

- [ ] **Step 3: 创建 `.gitignore`**

```gitignore
node_modules/
dist/
.env
.env.*
!.env.example
drizzle/meta/
```

> 说明：`drizzle/meta/` 是 drizzle-kit 生成的元数据，不提交；`drizzle/*.sql` 迁移文件要提交。

- [ ] **Step 4: 安装依赖并验证 workspace**

Run:
```bash
pnpm install
```
Expected: 生成 `pnpm-lock.yaml`，无报错。

- [ ] **Step 5: 提交**

```bash
git add package.json pnpm-workspace.yaml .gitignore pnpm-lock.yaml services/api/.gitkeep packages/shared/.gitkeep
git commit -m "chore: init pnpm monorepo workspace"
```

---

### Task 2: services/api 脚手架

**Files:**
- Create: `services/api/package.json`
- Create: `services/api/tsconfig.json`
- Create: `services/api/vitest.config.ts`
- Create: `services/api/tests/placeholder.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// services/api/tests/placeholder.test.ts
import { expect, it } from "vitest";

it("scaffold works", () => {
  expect(1 + 1).toBe(3);
});
```

- [ ] **Step 2: 创建 `services/api/package.json`**

```json
{
  "name": "@dailogues/api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "drizzle-orm": "^0.38.0",
    "hono": "^4.6.0",
    "jose": "^5.9.0",
    "postgres": "^3.4.5",
    "tsx": "^4.19.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "drizzle-kit": "^0.30.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: 创建 `services/api/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "drizzle.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 4: 创建 `services/api/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 5: 运行测试，验证红灯**

Run:
```bash
pnpm --filter @dailogues/api test
```
Expected: FAIL，`expect(1 + 1).toBe(3)` 断言失败。

- [ ] **Step 6: 修正测试为绿灯**

```ts
// services/api/tests/placeholder.test.ts
import { expect, it } from "vitest";

it("scaffold works", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 7: 验证绿灯并提交**

Run: `pnpm --filter @dailogues/api test` — Expected: PASS
```bash
git add services/api
git commit -m "chore(api): scaffold typescript + vitest"
```

---

### Task 3: 环境配置模块（zod 校验）

**Files:**
- Create: `services/api/src/config/env.ts`
- Test: `services/api/tests/env.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// services/api/tests/env.test.ts
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env";

describe("loadEnv", () => {
  it("parses a valid env", () => {
    const env = loadEnv({
      DATABASE_URL: "postgres://localhost:5432/dailogues",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_JWKS_URL: "https://example.supabase.co/auth/v1/jwks",
    });
    expect(env.PORT).toBe(8787);
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => loadEnv({ SUPABASE_URL: "https://x" })).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @dailogues/api test` — Expected: FAIL（`env` 模块不存在）

- [ ] **Step 3: 实现 `services/api/src/config/env.ts`**

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_JWKS_URL: z.string().url(),
  PORT: z.coerce.number().default(8787),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return schema.parse(source);
}
```

> 注意：模块内**不**执行 `loadEnv()`——环境值由 `index.ts` 启动时加载并注入，测试只使用 fake env。

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter @dailogues/api test` — Expected: PASS

- [ ] **Step 5: 创建 `services/api/.env.example`**

```bash
DATABASE_URL=postgres://postgres:password@db.example.supabase.co:5432/postgres
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_JWKS_URL=https://your-project.supabase.co/auth/v1/jwks
PORT=8787
```

- [ ] **Step 6: 提交**

```bash
git add services/api/src/config/env.ts services/api/tests/env.test.ts services/api/.env.example
git commit -m "feat(api): typed env config with zod validation"
```

---

### Task 4: Hono app 工厂 + health + 错误处理

**Files:**
- Create: `services/api/src/app.ts`
- Test: `services/api/tests/app.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// services/api/tests/app.test.ts
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";

function fakeEnv(): Env {
  return {
    DATABASE_URL: "postgres://localhost:5432/dailogues",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_JWKS_URL: "https://example.supabase.co/auth/v1/jwks",
    PORT: 8787,
  };
}

function makeApp() {
  return createApp({
    env: fakeEnv(),
    verifyToken: async (token: string) => {
      if (token !== "valid-token") throw new Error("invalid token");
      return { sub: "user-1" };
    },
  });
}

describe("health", () => {
  it("returns ok", async () => {
    const res = await makeApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("error handling", () => {
  it("returns json 404 for unknown routes", async () => {
    const res = await makeApp().request("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @dailogues/api test` — Expected: FAIL（`app` 模块不存在）

- [ ] **Step 3: 实现 `services/api/src/app.ts`**

```ts
import { Hono } from "hono";
import type { Env } from "./config/env";
import type { VerifyToken } from "./auth/verify";
import { createAuthMiddleware, type AuthEnv } from "./middleware/auth";

export type AppDeps = { env: Env; verifyToken: VerifyToken };

export function createApp(deps: AppDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("/api/*", createAuthMiddleware(deps.verifyToken));

  app.get("/api/me", (c) => c.json({ userId: c.get("userId") }));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
```

> `auth/verify` 与 `middleware/auth` 在 Task 5 创建；Task 4 结束前 `app.ts` 的 import 会编译报错，属预期——Task 5 完成后一起验证。

- [ ] **Step 4: 提交（含预期中的未完成 import，Task 5 完成后统一跑测试）**

```bash
git add services/api/src/app.ts services/api/tests/app.test.ts
git commit -m "feat(api): app factory with health and error handling"
```

---

### Task 5: JWT 验证器 + 认证中间件

**Files:**
- Create: `services/api/src/auth/verify.ts`
- Create: `services/api/src/middleware/auth.ts`
- Test: `services/api/tests/auth.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// services/api/tests/auth.test.ts
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";

function makeApp() {
  return createApp({
    env: {
      DATABASE_URL: "postgres://localhost:5432/dailogues",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_JWKS_URL: "https://example.supabase.co/auth/v1/jwks",
      PORT: 8787,
    } satisfies Env,
    verifyToken: async (token: string) => {
      if (token !== "valid-token") throw new Error("invalid token");
      return { sub: "user-1" };
    },
  });
}

describe("auth middleware", () => {
  it("rejects missing token with 401", async () => {
    const res = await makeApp().request("/api/me");
    expect(res.status).toBe(401);
  });

  it("rejects invalid token with 401", async () => {
    const res = await makeApp().request("/api/me", {
      headers: { Authorization: "Bearer bad-token" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts valid token and exposes userId", async () => {
    const res = await makeApp().request("/api/me", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-1" });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @dailogues/api test` — Expected: FAIL（`auth/verify` 不存在，`app.ts` import 报错）

- [ ] **Step 3: 实现 `services/api/src/auth/verify.ts`**

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

export type VerifyToken = (token: string) => Promise<{ sub: string }>;

export function createTokenVerifier(jwksUrl: string, issuer: string): VerifyToken {
  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  return async (token: string) => {
    const { payload } = await jwtVerify(token, jwks, { issuer });
    if (typeof payload.sub !== "string") throw new Error("JWT missing sub");
    return { sub: payload.sub };
  };
}
```

- [ ] **Step 4: 实现 `services/api/src/middleware/auth.ts`**

```ts
import { createMiddleware } from "hono/factory";
import type { VerifyToken } from "../auth/verify";

export type AuthEnv = { Variables: { userId: string } };

export function createAuthMiddleware(verify: VerifyToken) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) return c.json({ error: "unauthorized" }, 401);
    try {
      const { sub } = await verify(token);
      c.set("userId", sub);
      await next();
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
  });
}
```

- [ ] **Step 5: 运行全部测试，验证绿灯**

Run: `pnpm --filter @dailogues/api test`
Expected: PASS（app.test.ts + auth.test.ts + env.test.ts + placeholder）

- [ ] **Step 6: 类型检查**

Run: `pnpm --filter @dailogues/api typecheck` — Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add services/api/src services/api/tests
git commit -m "feat(api): supabase jwt verification and auth middleware"
```

---

### Task 6: Drizzle 数据模型（全表 schema）

**Files:**
- Create: `services/api/src/db/schema.ts`
- Create: `services/api/drizzle.config.ts`
- Create: `services/api/src/db/migrate.ts`
- Generate: `services/api/drizzle/0000_*.sql`（命令产物，提交）

- [ ] **Step 1: 实现 `services/api/src/db/schema.ts`**

```ts
import {
  boolean, integer, jsonb, pgTable, text, timestamp, uuid,
} from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  bio: text("bio"),
  plan: text("plan", { enum: ["free", "pro"] }).notNull().default("free"),
  creditBalance: integer("credit_balance").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const voiceSamples = pgTable("voice_samples", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  audioUrl: text("audio_url").notNull(),
  duration: integer("duration").notNull(),
  status: text("status", { enum: ["ready", "failed"] }).notNull().default("ready"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inviteCodes = pgTable("invite_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  createdBy: uuid("created_by").notNull().references(() => profiles.id),
  usedBy: uuid("used_by").references(() => profiles.id),
  usedAt: timestamp("used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  source: text("source", { enum: ["admin", "reward"] }).notNull(),
  issuedForEpisodeId: uuid("issued_for_episode_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const imports = pgTable("imports", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  sourceType: text("source_type", { enum: ["link", "file", "text"] }).notNull(),
  platform: text("platform", { enum: ["chatgpt", "claude", "kimi", "doubao", "tongyi", "gemini", "plain"] }).notNull(),
  rawContent: text("raw_content"),
  parsedDialogue: jsonb("parsed_dialogue"),
  status: text("status", { enum: ["parsed", "failed"] }).notNull().default("parsed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const episodes = pgTable("episodes", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  title: text("title"),
  description: text("description"),
  coverUrl: text("cover_url"),
  audioUrl: text("audio_url"),
  durationSeconds: integer("duration_seconds"),
  status: text("status", { enum: ["draft", "generating", "published", "failed"] }).notNull().default("draft"),
  qualityStatus: text("quality_status", { enum: ["pending", "passed", "rejected"] }).notNull().default("pending"),
  qualityReason: text("quality_reason"),
  language: text("language"),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export const scripts = pgTable("scripts", {
  id: uuid("id").defaultRandom().primaryKey(),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  segments: jsonb("segments").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const generationJobs = pgTable("generation_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["queued", "tts", "merge", "upload", "done", "failed"] }).notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  stripeSessionId: text("stripe_session_id").notNull().unique(),
  amount: integer("amount").notNull(),
  episodesGranted: integer("episodes_granted").notNull(),
  status: text("status", { enum: ["succeeded", "failed"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull(),
  plan: text("plan", { enum: ["pro"] }).notNull(),
  status: text("status", { enum: ["active", "past_due", "canceled"] }).notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
});
```

- [ ] **Step 2: 创建 `services/api/drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/dailogues",
  },
});
```

- [ ] **Step 3: 生成迁移文件**

Run:
```bash
pnpm --filter @dailogues/api db:generate
```
Expected: 生成 `services/api/drizzle/0000_*.sql`（含 9 张表），无报错。

- [ ] **Step 4: 创建 `services/api/src/db/migrate.ts`**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadEnv } from "../config/env";

const env = loadEnv();
const sql = postgres(env.DATABASE_URL, { max: 1 });
await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
await sql.end();
console.log("migrations applied");
```

- [ ] **Step 5: 类型检查 + 提交**

Run: `pnpm --filter @dailogues/api typecheck` — Expected: 无错误
```bash
git add services/api/src/db services/api/drizzle.config.ts services/api/drizzle
git commit -m "feat(api): drizzle schema for all tables + migration"
```

---

### Task 7: DB 连接层 + 环境门控集成测试

**Files:**
- Create: `services/api/src/db/client.ts`
- Test: `services/api/tests/db.test.ts`

- [ ] **Step 1: 写失败测试（无 DATABASE_URL 时自动跳过）**

```ts
// services/api/tests/db.test.ts
import { describe, expect, it } from "vitest";
import postgres from "postgres";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("database connection", () => {
  it("can SELECT 1", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      const rows = await sql`select 1 as one`;
      expect(rows[0].one).toBe(1);
    } finally {
      await sql.end();
    }
  });
});
```

- [ ] **Step 2: 运行测试，确认无 DATABASE_URL 时跳过**

Run: `pnpm --filter @dailogues/api test` — Expected: SKIP（环境无 DATABASE_URL）

- [ ] **Step 3: 实现 `services/api/src/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Env } from "../config/env";
import * as schema from "./schema";

export function createDb(env: Env) {
  const client = postgres(env.DATABASE_URL, { max: 1 });
  return { db: drizzle(client, { schema }), client };
}
```

- [ ] **Step 4: 类型检查 + 提交**

Run: `pnpm --filter @dailogues/api typecheck` — Expected: 无错误
```bash
git add services/api/src/db/client.ts services/api/tests/db.test.ts
git commit -m "feat(api): db client factory + gated integration test"
```

---

### Task 8: 启动入口（@hono/node-server）

**Files:**
- Create: `services/api/src/index.ts`

- [ ] **Step 1: 实现 `services/api/src/index.ts`**

```ts
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { createTokenVerifier } from "./auth/verify";

const env = loadEnv();
const app = createApp({
  env,
  verifyToken: createTokenVerifier(env.SUPABASE_JWKS_URL, `${env.SUPABASE_URL}/auth/v1`),
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api listening on :${info.port}`);
});
```

- [ ] **Step 2: 本地启动验证**

Run:
```bash
cd services/api && DATABASE_URL=postgres://localhost:5432/dailogues SUPABASE_URL=https://example.supabase.co SUPABASE_JWKS_URL=https://example.supabase.co/auth/v1/jwks pnpm dev
```
Expected: 输出 `api listening on :8787`。另开终端验证：
```bash
curl -s http://localhost:8787/health
```
Expected: `{"ok":true}`。Ctrl-C 停止。

- [ ] **Step 3: 提交**

```bash
git add services/api/src/index.ts
git commit -m "feat(api): server entrypoint"
```

---

### Task 9: Dockerfile + fly.toml + 本地构建验证

**Files:**
- Create: `infra/fly/Dockerfile`
- Create: `fly.toml`

- [ ] **Step 1: 创建 `infra/fly/Dockerfile`（构建上下文 = 仓库根目录）**

```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/api/package.json ./services/api/package.json
RUN pnpm install --filter @dailogues/api --frozen-lockfile

COPY services/api ./services/api
WORKDIR /app/services/api

EXPOSE 8787
CMD ["pnpm", "start"]
```

- [ ] **Step 2: 创建 `fly.toml`（仓库根目录）**

```toml
app = "dailogues-api"
primary_region = "nrt"

[build]
  dockerfile = "infra/fly/Dockerfile"

[http_service]
  internal_port = 8787
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```

- [ ] **Step 3: 本地构建镜像验证**

Run:
```bash
docker build -f infra/fly/Dockerfile -t dailogues-api .
```
Expected: 构建成功，镜像含 ffmpeg。验证：
```bash
docker run --rm -it dailogues-api ffmpeg -version | head -1
```
Expected: `ffmpeg version ...`

- [ ] **Step 4: 提交**

```bash
git add infra/fly/Dockerfile fly.toml
git commit -m "chore(infra): fly docker image with ffmpeg + fly.toml"
```

---

### Task 10: GitHub Actions CI/CD

**Files:**
- Create: `infra/github/workflows/ci.yml`
- Create: `infra/github/workflows/deploy.yml`

> 前置：仓库已推送到 GitHub；`FLY_API_TOKEN` 已加入仓库 Secrets。

- [ ] **Step 1: 创建 `infra/github/workflows/ci.yml`**

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck
      - run: pnpm -r test
```

- [ ] **Step 2: 创建 `infra/github/workflows/deploy.yml`**

```yaml
name: Deploy API
on:
  push:
    branches: [main]
    paths:
      - "services/api/**"
      - "infra/fly/**"
      - "package.json"
      - "pnpm-workspace.yaml"
      - "pnpm-lock.yaml"

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

- [ ] **Step 3: 推送并验证 CI 通过、main 分支触发部署**

Run:
```bash
git add infra/github/workflows
git commit -m "ci: add ci and fly deploy workflows"
git push origin main
```
Expected: GitHub Actions CI 全绿；部署 workflow 在 main 上触发，Fly 控制台可见 `dailogues-api` 应用启动。

- [ ] **Step 4: 线上验证**

Run:
```bash
curl -s https://api.dailogues.com/health
```
（Fly 应用自定义域 `api.dailogues.com` 需在 Fly 控制台或 `fly certs add api.dailogues.com` 配置）
Expected: `{"ok":true}`

---

### Task 11: 更新 AGENT.md 里程碑

**Files:**
- Modify: `AGENT.md`（里程碑清单）

- [ ] **Step 1: 勾选 M2，更新备注**

将 AGENT.md 里程碑中的
```markdown
- [ ] M2：统一后端骨架（Hono + Drizzle + 迁移 + CI/CD 部署 Fly）
```
改为
```markdown
- [x] M2：统一后端骨架（Hono + Drizzle + 迁移 + CI/CD 部署 Fly）
```

- [ ] **Step 2: 提交**

```bash
git add AGENT.md
git commit -m "docs: mark M2 complete"
```

---

## 自检记录（计划作者）

- **Spec 覆盖**：ARC §3.1（Hono/Drizzle/tsx/进程内队列后续计划）、§3.2（health 与 me 端点、auth 底座）、§4（9 张表全量）、§2（Fly 部署 + R2 后续）、§8（CI 中跑 typecheck+test）；认证 JWT（ARC §3.1/§3.2）已覆盖。生成管线/解析器/计费接口在后续计划实现（本计划仅骨架，不 stub 未实现端点——YAGNI）。
- **一致性**：`Env`/`VerifyToken`/`createApp`/`AuthEnv` 类型在 Task 3-5、8 之间一致；表字段与 ARC §4 一致（episodes 含 `quality_status`/`quality_reason`）。
- **占位符**：无 TBD/TODO；版本号均为范围约束，锁文件为准。
- **已知取舍**：Task 4 单独提交时 import 未完成（Task 5 补齐），已注明预期；db 集成测试在 CI 无 DATABASE_URL 时自动跳过（ARC §8 契约测试仍由 vitest 直测 Hono app 覆盖）。
