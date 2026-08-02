# 计划 4：生成管线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现统一后端的核心业务：接收扩展采集（imports）、双门审核（质量门 + 安全门）、DeepSeek 流式润色、Fish Audio 合成、ffmpeg 拼接、存储上传、进程内队列——把"一段对话"变成"一期音频节目"。

**Architecture:** 在计划 1 骨架上扩展。所有外部依赖（DeepSeek LLM、Fish Audio TTS、存储）通过可注入客户端抽象，测试用 mock；真实调用按 env 门控（`describe.skipIf` 模式，同 db.test.ts）。管线为进程内队列 + `generation_jobs` 表（启动时恢复 queued 任务），job 阶段 `queued → tts → merge → upload → done/failed`。TTS 采用**多说话人一次调用**（`<|speaker:N|>` 标签 + `reference_id` 数组，全部模型 id——主持人音色由 `POST /model` 快速创建 5-8s 免费，实测见 `docs/spikes/fish-audio.md`）；混合模式不支持时**按段 fallback**（主持人 msgpack 内联 + 嘉宾固定音色）。merge 用 ffmpeg 拼接 `intro.{lang}.mp3 + 主对话 + outro.{lang}.mp3`（资产缺失时降级只拼主对话）。

**Tech Stack:** Hono（SSE streaming helper）/ DeepSeek（OpenAI 兼容 `/chat/completions`，stream）+ 语言检测 / Fish Audio（`/v1/tts` 多说话人 + `/model` 音色创建）/ fluent-ffmpeg + `@ffmpeg-installer/ffmpeg`（免本机安装）/ 存储抽象（本地 fs + R2 S3，`@aws-sdk/client-s3`）/ Vitest（mock + 门控真实集成）/ 进程内队列（无 Redis）

**前置条件（手动，由用户提供）：**
- `DEEPSEEK_API_KEY`（DeepSeek 平台创建；api.deepseek.com 国内直连）
- `FISH_API_KEY`（已有，`scripts/spikes/.env`；api.fish.audio 本地需经代理 `FISH_PROXY_URL=socks5://127.0.0.1:1081`）
- R2 凭证（`R2_ACCOUNT_ID/ACCESS_KEY/SECRET/BUCKET`）——**仅部署/线上需要**；本地开发用 `STORAGE_DRIVER=fs`（`STORAGE_DIR=./data`）

**env 扩展**（`services/api/.env.local`，追加）：`DEEPSEEK_API_KEY`、`FISH_API_KEY`、`FISH_PROXY_URL`、`STORAGE_DRIVER=fs`、`STORAGE_DIR=./data`

---

### Task 1: 外部客户端抽象（LLM / TTS / Storage）+ env 扩展

**Files:**
- Modify: `services/api/src/config/env.ts`（追加字段）
- Create: `services/api/src/llm/client.ts`
- Create: `services/api/src/tts/client.ts`
- Create: `services/api/src/storage/index.ts`
- Test: `services/api/tests/clients.test.ts`

- [ ] **Step 1: 写失败测试** `services/api/tests/clients.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { createLlmClient, type LlmClient } from "../src/llm/client";
import { createTtsClient, type TtsClient } from "../src/tts/client";
import { createStorage, type AudioStorage } from "../src/storage";

function fakeFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("llm client", () => {
  it("calls OpenAI-compatible chat completions", async () => {
    const fetchMock = fakeFetch();
    const llm: LlmClient = createLlmClient({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const out = await llm.complete([{ role: "user", content: "hi" }]);
    expect(out).toBe('{"ok":true}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer sk-test" });
  });
});

describe("tts client", () => {
  it("builds multi-speaker request with speaker tags", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const tts: TtsClient = createTtsClient({
      apiKey: "fish-key",
      proxyUrl: undefined,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const buf = await tts.synthesizeMultiSpeaker({
      segments: [
        { speaker: 0, text: "你好" },
        { speaker: 1, text: "你好！" },
      ],
      referenceIds: ["host-model", "guest-model"],
    });
    expect(buf.length).toBe(3);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.text).toContain("<|speaker:0|>");
    expect(body.reference_id).toEqual(["host-model", "guest-model"]);
  });
});

describe("storage", () => {
  it("fs driver writes and reads", async () => {
    const storage: AudioStorage = createStorage({ driver: "fs", dir: "./data-test" });
    await storage.put("episodes/u1/e1.mp3", new Uint8Array([9, 9]));
    const buf = await storage.get("episodes/u1/e1.mp3");
    expect([...buf]).toEqual([9, 9]);
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: env.ts 追加字段**

```ts
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_JWKS_URL: z.string().url(),
  PORT: z.coerce.number().default(8787),
  DEEPSEEK_API_KEY: z.string().min(1).default(""),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com/v1"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  FISH_API_KEY: z.string().min(1).default(""),
  FISH_PROXY_URL: z.string().optional(),
  STORAGE_DRIVER: z.enum(["fs", "r2"]).default("fs"),
  STORAGE_DIR: z.string().default("./data"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY: z.string().optional(),
  R2_SECRET_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
});
```

> 默认空串使无 key 本地环境可启动；调用时若 key 为空返回明确错误（`llm/tts 未配置`），测试用 mock 注入。

- [ ] **Step 4: 实现 `services/api/src/llm/client.ts`**

```ts
export interface LlmMessage { role: "user" | "assistant" | "system"; content: string; }

export interface LlmClient {
  /** 非流式补全，返回 content 文本 */
  complete(messages: LlmMessage[]): Promise<string>;
  /** 流式补全，逐 delta 回调（SSE） */
  stream(messages: LlmMessage[], onDelta: (delta: string) => void): Promise<string>;
}

export interface LlmOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export function createLlmClient(opts: LlmOptions): LlmClient {
  const f = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl}/chat/completions`;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` };

  async function complete(messages: LlmMessage[]): Promise<string> {
    const res = await f(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: opts.model, messages, stream: false }),
    });
    if (!res.ok) throw new Error(`llm http_${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content ?? "";
  }

  async function stream(messages: LlmMessage[], onDelta: (delta: string) => void): Promise<string> {
    const res = await f(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: opts.model, messages, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`llm http_${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as { choices: { delta: { content?: string } }[] };
          const delta = json.choices[0]?.delta?.content ?? "";
          if (delta) { full += delta; onDelta(delta); }
        } catch { /* 忽略无法解析的 chunk */ }
      }
    }
    return full;
  }

  return { complete, stream };
}
```

- [ ] **Step 5: 实现 `services/api/src/tts/client.ts`**（多说话人 + 零样本按段 + 音色创建）

```ts
export interface TtsSegment { speaker: number; text: string; }

export interface TtsClient {
  /** 多说话人一次调用（全 reference_id 模型 id） */
  synthesizeMultiSpeaker(args: {
    segments: TtsSegment[];
    referenceIds: string[]; // 下标对应 speaker 序号
  }): Promise<Uint8Array>;
  /** 按段零样本（主持人内联参考音频 msgpack）/ 固定音色 */
  synthesizeSingle(args: {
    text: string;
    referenceAudio?: Uint8Array; // msgpack references 内联
    referenceId?: string;
  }): Promise<Uint8Array>;
  /** 创建/训练音色模型（fast 5-8s，免费） */
  createVoiceModel(args: { audio: Uint8Array; name: string }): Promise<{ id: string }>;
}

export interface TtsOptions {
  apiKey: string;
  proxyUrl?: string; // socks5://host:port，本地代理
  fetchImpl?: typeof fetch;
}

export function createTtsClient(opts: TtsOptions): TtsClient {
  const f = opts.fetchImpl ?? fetch;
  const base = "https://api.fish.audio";
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` };

  // NOTE: 代理场景（本地 socks5）由调用方注入已包装的 fetchImpl；
  //       服务端生产环境直连无需代理。见 Task 9 的 fetchWithProxy 说明。

  async function synthesizeMultiSpeaker(args: {
    segments: TtsSegment[];
    referenceIds: string[];
  }): Promise<Uint8Array> {
    const text = args.segments
      .map((s) => `<|speaker:${s.speaker}|>${s.text}`)
      .join("");
    const res = await f(`${base}/v1/tts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, reference_id: args.referenceIds, format: "mp3" }),
    });
    if (!res.ok) throw new Error(`tts http_${res.status}: ${(await res.text()).slice(0, 200)}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function synthesizeSingle(args: {
    text: string;
    referenceAudio?: Uint8Array;
    referenceId?: string;
  }): Promise<Uint8Array> {
    const body = args.referenceAudio
      ? // 零样本内联：msgpack references（JSON 无 base64 字段，实测见 fish-audio.md）
        buildMsgpackReferences(args.referenceAudio, args.text)
      : JSON.stringify({ text: args.text, reference_id: args.referenceId, format: "mp3" });
    const res = await f(`${base}/v1/tts`, {
      method: "POST",
      headers: args.referenceAudio
        ? { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/msgpack" }
        : headers,
      body,
    });
    if (!res.ok) throw new Error(`tts http_${res.status}: ${(await res.text()).slice(0, 200)}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function createVoiceModel(args: { audio: Uint8Array; name: string }): Promise<{ id: string }> {
    const form = new FormData();
    form.append("name", args.name);
    form.append("file", new Blob([args.audio]), "voice.wav");
    const res = await f(`${base}/model`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`voice model http_${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { id: string };
    return { id: data.id };
  }

  return { synthesizeMultiSpeaker, synthesizeSingle, createVoiceModel };
}

/** msgpack 最小编码：{ references: [{ audio, text }] }（字段名以 fish-audio.md 实测为准，实现时按文档校准） */
function buildMsgpackReferences(audio: Uint8Array, text: string): Uint8Array {
  // TODO(spike 校准): 依据 docs/spikes/fish-audio.md 的 msgpack 结构实现；
  // 若本任务无法从文档确认，保持 JSON 路径（referenceId 方式）为主，msgpack 标记为待校准并报告。
  throw new Error("msgpack references 未实现：按 fish-audio.md 校准后实现（本任务先走 referenceId 路径）");
}
```

> ⚠️ 诚实约束：msgpack 内联路径的精确字节结构需要从 `docs/spikes/fish-audio.md` 提取（spike 脚本 `fish-audio.mjs` 里有可参考实现）。实现者应阅读该文件与脚本，能确认则实现完整编码；不能确认则**本任务以 referenceId 路径为主**（音色创建 + 多说话人一次调用），msgpack 标记"待校准"，在 Task 7/9 中按需补全。

- [ ] **Step 6: 实现 `services/api/src/storage/index.ts`**

```ts
export interface AudioStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

export interface StorageOptions {
  driver: "fs" | "r2";
  dir?: string;                 // fs driver 根目录
  r2?: { accountId: string; accessKey: string; secretKey: string; bucket: string };
}

export function createStorage(opts: StorageOptions): AudioStorage {
  if (opts.driver === "r2") {
    if (!opts.r2) throw new Error("r2 storage 缺少配置");
    return createR2Storage(opts.r2);
  }
  return createFsStorage(opts.dir ?? "./data");
}

function createFsStorage(dir: string): AudioStorage {
  return {
    async put(key, data) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const p = join(dir, key);
      await mkdir(join(p, ".."), { recursive: true });
      await writeFile(p, data);
    },
    async get(key) {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      return new Uint8Array(await readFile(join(dir, key)));
    },
  };
}

function createR2Storage(r2: { accountId: string; accessKey: string; secretKey: string; bucket: string }): AudioStorage {
  // @aws-sdk/client-s3 + endpoint https://{accountId}.r2.cloudflarestorage.com
  // 本地测试不覆盖 R2（部署环境验证）；此处保持轻量实现，部署时联调。
  return {
    async put(key, data) {
      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({
        region: "auto",
        endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: r2.accessKey, secretAccessKey: r2.secretKey },
      });
      await client.send(new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: data }));
    },
    async get(key) {
      const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({
        region: "auto",
        endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: r2.accessKey, secretAccessKey: r2.secretKey },
      });
      const out = await client.send(new GetObjectCommand({ Bucket: r2.bucket, Key: key }));
      return new Uint8Array(await out.Body!.transformToByteArray());
    },
  };
}
```

- [ ] **Step 7: 安装新依赖**

```bash
cd /Users/free/Projects/dailogues && npx --yes pnpm@9.15.0 --filter @dailogues/api add @aws-sdk/client-s3 @ffmpeg-installer/ffmpeg fluent-ffmpeg
npx --yes pnpm@9.15.0 --filter @dailogues/api add -D @types/fluent-ffmpeg socks-proxy-agent undici
```

- [ ] **Step 8: 测试通过（红→绿）+ typecheck + 提交**

```bash
npx --yes pnpm@9.15.0 --filter @dailogues/api test && npx --yes pnpm@9.15.0 --filter @dailogues/api typecheck
git add services/api/src services/api/tests services/api/package.json pnpm-lock.yaml services/api/.env.example
git commit -m "feat(api): llm/tts/storage clients + env extension"
```

---

### Task 2: imports 路由（幂等接收扩展回传）

**Files:**
- Create: `services/api/src/routes/imports.ts`
- Modify: `services/api/src/app.ts`（挂载路由）
- Test: `services/api/tests/imports.test.ts`

- [ ] **Step 1: 写失败测试** `services/api/tests/imports.test.ts`（用临时 SQLite 或注入 fake db——沿用计划 1 的依赖注入模式：`createApp(deps)` 增加 `db`；测试用内存 fake）

设计说明：`createApp` 的 deps 增加 `db: { insertImport, findImportBySource, insertEpisode }` 等仓储函数（实现用 drizzle 查 Supabase/本地 PG）。本任务先定义仓储接口 + fake 实现测试路由逻辑，真实 drizzle 仓储在 Task 3 落地。

```ts
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { importsRoutes } from "../src/routes/imports";

function makeApp(overrides: Partial<Record<string, unknown>> = {}) {
  const app = new Hono();
  app.route("/api", importsRoutes({
    authUserId: () => "user-1",
    findImportBySource: async () => null,
    insertImport: async (row: unknown) => ({ id: "imp-1", ...(row as object) }),
    insertEpisode: async (row: unknown) => ({ id: "ep-1", ...(row as object) }),
    ...overrides,
  }));
  return app;
}

const dialogue = {
  platform: "claude",
  conversationId: "c-123",
  title: "测试对话",
  url: "https://claude.ai/chat/c-123",
  messages: [
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好！" },
  ],
};

describe("POST /api/imports", () => {
  it("inserts import + draft episode", async () => {
    const res = await makeApp().request("/api/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dialogue),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.episodeId).toBe("ep-1");
  });

  it("returns 409 when already imported", async () => {
    const app = makeApp({
      findImportBySource: async () => ({ id: "imp-0" }),
    });
    const res = await app.request("/api/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dialogue),
    });
    expect(res.status).toBe(409);
  });

  it("rejects invalid dialogue", async () => {
    const res = await makeApp().request("/api/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...dialogue, messages: [] }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现 `services/api/src/routes/imports.ts`**

```ts
import { Hono } from "hono";
import { isCollectedDialogue } from "../../../extension-shared-协议占位"; // 见 Step 4 说明
```

> 采集协议类型在 `apps/extension/src/shared.ts`。跨包共享：将 `apps/extension/src/shared.ts` 的协议类型抽到 `packages/shared/src/dialogue.ts`（monorepo 共享包），扩展与后端都从 `@dailogues/shared` 导入；或后端本地复制最小校验函数（`isCollectedDialogue` 约 30 行，YAGNI 优先本地复制，避免重构扩展包）。**决策：后端本地复制**（`services/api/src/dialogue.ts`），扩展包不动；若未来需要双写一致性再抽共享包。

- [ ] **Step 4: 后端本地协议** `services/api/src/dialogue.ts`（复制扩展版类型与守卫，保持字段一致）

```ts
export type Platform = "claude" | "deepseek" | "chatgpt" | "gemini" | "kimi" | "doubao" | "tongyi" | "plain";
export interface DialogueMessage { role: "user" | "assistant"; content: string; }
export interface CollectedDialogue { platform: Platform; conversationId: string; title: string; url: string; messages: DialogueMessage[]; }
export function isCollectedDialogue(value: unknown): value is CollectedDialogue { /* 同扩展版逻辑 */ }
```

- [ ] **Step 5: 实现路由（仓储接口 + 路由）**

```ts
// services/api/src/routes/imports.ts
import { Hono } from "hono";
import { isCollectedDialogue, type CollectedDialogue } from "../dialogue";

export interface ImportsRepo {
  findImportBySource(userId: string, platform: string, conversationId: string): Promise<{ id: string } | null>;
  insertImport(row: {
    userId: string; platform: string; sourceTitle: string; sourceConversationId: string;
    sourceUrl: string; parsedDialogue: CollectedDialogue;
  }): Promise<{ id: string }>;
  insertEpisode(row: {
    userId: string; title: string; status: "draft"; language: string | null;
  }): Promise<{ id: string }>;
}

export function importsRoutes(repo: ImportsRepo) {
  const app = new Hono();
  app.post("/imports", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!isCollectedDialogue(body)) return c.json({ error: "invalid_dialogue" }, 400);
    const userId = c.get("userId") as string;
    const existing = await repo.findImportBySource(userId, body.platform, body.conversationId);
    if (existing) return c.json({ error: "already_imported", importId: existing.id }, 409);
    const imp = await repo.insertImport({
      userId, platform: body.platform, sourceTitle: body.title,
      sourceConversationId: body.conversationId, sourceUrl: body.url, parsedDialogue: body,
    });
    const ep = await repo.insertEpisode({
      userId, title: body.title, status: "draft", language: null,
    });
    return c.json({ importId: imp.id, episodeId: ep.id }, 201);
  });
  return app;
}
```

- [ ] **Step 6: app.ts 挂载（deps 增加 repo 参数，auth 中间件已覆盖 /api/*）**

```ts
// app.ts 修改要点：
// createApp(deps) 增加 deps.importsRepo: ImportsRepo（Task 3 提供 drizzle 实现）
// app.route("/api", importsRoutes(deps.importsRepo));
```

- [ ] **Step 7: 测试通过 + typecheck + 提交**

```bash
git add services/api/src services/api/tests
git commit -m "feat(api): imports route (idempotent collect receive)"
```

---

### Task 3: drizzle 仓储实现 + episodes/scripts 路由

**Files:**
- Create: `services/api/src/repo/index.ts`（drizzle 仓储：imports/episodes/scripts 查询）
- Create: `services/api/src/routes/episodes.ts`（列表/获取/保存脚本/发布）
- Modify: `services/api/src/app.ts`（注入真实仓储）
- Test: `services/api/tests/repo.test.ts`（本地 PG 门控）+ `services/api/tests/episodes.test.ts`（fake 仓储）

- [ ] **Step 1: 写失败测试** `services/api/tests/episodes.test.ts`（fake 仓储，同 imports 模式：列表/获取/保存脚本版本递增/发布）

```ts
import { describe, expect, it } from "vitest";
import { episodesRoutes, type EpisodesRepo } from "../src/routes/episodes";

function fakeRepo(): EpisodesRepo {
  const episodes = new Map<string, Record<string, unknown>>();
  return {
    listEpisodes: async (userId) => [...episodes.values()].filter((e) => e.userId === userId),
    getEpisode: async (id) => episodes.get(id) ?? null,
    saveScript: async (episodeId, version, segments) => ({ episodeId, version, segments }),
    getLatestScript: async () => null,
    setPublished: async (id) => { episodes.get(id)!.status = "published"; },
  };
}

describe("episodes routes", () => {
  it("lists episodes for current user", async () => { /* 断言 200 + 数组 */ });
  it("saves script with incremented version", async () => { /* 断言 200 + version */ });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现 `services/api/src/routes/episodes.ts`**（路由：GET /episodes、GET /episodes/:id、PUT /episodes/:id/script（body: segments[]，version = 最新+1）、POST /episodes/:id/publish（is_public=true + published_at，邀请码发放 plan 7 接入点留注释））

- [ ] **Step 4: 实现 drizzle 仓储 `services/api/src/repo/index.ts`**

```ts
// 用 drizzle-orm 查询本地 PG/Supabase；表定义来自 src/db/schema.ts
// exports: createRepo(db) → { imports: ImportsRepo, episodes: EpisodesRepo }
// 唯一约束冲突捕获（imports 幂等：unique (user_id, platform, source_conversation_id)）
```

- [ ] **Step 5: app.ts 注入真实仓储**（`createApp(deps)` deps 增加 `repo`；测试仍传 fake）

- [ ] **Step 6: 本地 PG 集成测试** `services/api/tests/repo.test.ts`（`describe.skipIf(!DATABASE_URL)`：真实插入 imports + episodes + 幂等冲突 409 路径）

- [ ] **Step 7: 全部测试通过 + typecheck + 提交**

```bash
git add services/api/src services/api/tests
git commit -m "feat(api): drizzle repo + episodes/scripts routes"
```

---

### Task 4: polish 路由（质量门 + 语言检测 + SSE 流式润色）

**Files:**
- Create: `services/api/src/routes/polish.ts`
- Create: `services/api/src/llm/prompts.ts`（审核/语言检测/润色 prompt 与 JSON 解析）
- Modify: `services/api/src/app.ts`
- Test: `services/api/tests/polish.test.ts`（mock LLM）

- [ ] **Step 1: 写失败测试** `services/api/tests/polish.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { polishRoutes, type PolishDeps } from "../src/routes/polish";

function makePolish(deps: Partial<PolishDeps> = {}) {
  return polishRoutes({
    getScriptSegments: async () => [
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好！" },
    ],
    qualityCheck: async () => ({ pass: true, language: "zh" }),
    savePolished: async (_ep, _lang, segments) => ({ version: 2, segments }),
    llm: { complete: async () => "", stream: async () => "" },
    ...deps,
  });
}

describe("POST /api/episodes/:id/polish", () => {
  it("returns 422 when quality check rejects", async () => {
    const app = makePolish({ qualityCheck: async () => ({ pass: false, reason: "too_short" }) });
    const res = await app.request("/api/episodes/ep-1/polish", { method: "POST" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "quality_rejected", reason: "too_short" });
  });

  it("streams SSE and saves polished script", async () => {
    const savePolished = vi.fn(async () => ({ version: 2, segments: [] }));
    const app = makePolish({
      savePolished,
      llm: {
        complete: async () => "",
        stream: async (_msgs, onDelta) => {
          onDelta('[{"speaker":"host","text":"你好"}');
          onDelta(',{"speaker":"guest","text":"你好！"}]');
          return '[{"speaker":"host","text":"你好"},{"speaker":"guest","text":"你好！"}]';
        },
      },
    });
    const res = await app.request("/api/episodes/ep-1/polish", { method: "POST" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: segment");
    expect(savePolished).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现 `services/api/src/llm/prompts.ts`**

```ts
// qualityCheckPrompt(messages): 输出 JSON { pass: boolean, reason?: string, language: "zh"|"en" }
//   拒绝标准（PRD §4.4）：<3 轮 / 纯寒暄无主题 / 信息量不足 / 违规内容
// polishPrompt(messages, language): 输出 JSON 数组 [{ speaker: "host"|"guest", text }]
//   要求：语言跟随对话；压缩到 5-10 分钟（1200-3000 字）；理顺口语；保留原意
// safetyCheckPrompt(segments): 输出 JSON { pass: boolean, reason?: string }
//   标准（安全门）：色情/违法/仇恨/诈骗等违规内容
// parseJsonLoose(text): 从 LLM 输出中容错提取 JSON（去 ```json 围栏、截取首个 [ 或 { 到匹配结束）
```

- [ ] **Step 4: 实现 `services/api/src/routes/polish.ts`**（SSE 用 Hono `streamSSE`；流程：取脚本 → 质量门（复用质量审核逻辑，返回 422 + reason，language 一并返回）→ LLM 流式润色（逐 delta 转发 `event: segment`）→ 收齐后解析 JSON 存 scripts 新版本 → `event: done` 带 version）

- [ ] **Step 5: app.ts 挂载 + 测试通过 + typecheck + 提交**

```bash
git add services/api/src services/api/tests
git commit -m "feat(api): polish route (quality gate + lang detect + SSE polish)"
```

---

### Task 5: generate 路由（安全门 + 配额 + 建 job）+ job 路由

**Files:**
- Create: `services/api/src/routes/generate.ts`
- Create: `services/api/src/routes/job.ts`
- Create: `services/api/src/quota.ts`（配额判定与扣减）
- Modify: `services/api/src/app.ts`
- Test: `services/api/tests/generate.test.ts` + `services/api/tests/quota.test.ts`

- [ ] **Step 1: 写失败测试** `services/api/tests/quota.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { canGenerate, type QuotaInfo } from "../src/quota";

describe("canGenerate", () => {
  it("free user with 0 generated episodes passes", () => {
    expect(canGenerate({ plan: "free", generatedCount: 0, creditBalance: 0 }).ok).toBe(true);
  });
  it("free user with >=1 generated episode blocked", () => {
    const r = canGenerate({ plan: "free", generatedCount: 1, creditBalance: 0 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("quota_free_used");
  });
  it("credit user consumes one credit", () => {
    const r = canGenerate({ plan: "free", generatedCount: 1, creditBalance: 2 });
    expect(r.ok).toBe(true);
    expect(r.consumeCredit).toBe(1);
  });
  it("pro user unlimited", () => {
    expect(canGenerate({ plan: "pro", generatedCount: 99, creditBalance: 0 }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: 实现 `services/api/src/quota.ts`**

```ts
export interface QuotaInfo {
  plan: "free" | "pro";
  generatedCount: number; // 已完成生成（job done）的期数
  creditBalance: number;
}
export function canGenerate(q: QuotaInfo): { ok: true; consumeCredit: number } | { ok: false; reason: string } {
  if (q.plan === "pro") return { ok: true, consumeCredit: 0 };
  if (q.generatedCount >= 1 && q.creditBalance <= 0) return { ok: false, reason: "quota_free_used" };
  return { ok: true, consumeCredit: 1 };
}
```

- [ ] **Step 3: 写失败测试** `services/api/tests/generate.test.ts`（mock deps：安全门通过→配额通过→建 job→返回 202 + jobId；安全门拒绝→422 不建 job；配额不足→403）

- [ ] **Step 4: 实现 `services/api/src/routes/generate.ts`**（流程：取最新脚本 → 安全门（DeepSeek `safetyCheckPrompt`，拒绝 422 + reason，**不建 job 不扣配额**）→ 配额（`canGenerate`，不足 403 + 订阅引导）→ 扣减（credit -1 / 计数）→ `createJob(queued)` → 入队 → 202 + jobId）

- [ ] **Step 5: 实现 `services/api/src/routes/job.ts`**（GET /api/episodes/:id/job → 最新 job { status, progress, error }；404 若无 job）

- [ ] **Step 6: 测试通过 + typecheck + 提交**

```bash
git add services/api/src services/api/tests
git commit -m "feat(api): generate route (safety gate + quota + job) + job route"
```

---

### Task 6: 进程内队列 + 启动恢复

**Files:**
- Create: `services/api/src/pipeline/queue.ts`
- Create: `services/api/src/pipeline/runner.ts`（骨架：消费 job，执行各阶段回调，更新 progress/status，失败重试 2 次指数退避）
- Test: `services/api/tests/queue.test.ts`

- [ ] **Step 1: 写失败测试** `services/api/tests/queue.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { createJobQueue, type JobHandler } from "../src/pipeline/queue";

describe("createJobQueue", () => {
  it("processes jobs serially with progress", async () => {
    const handler: JobHandler = vi.fn(async (job, update) => {
      await update(50);
      await update(100);
      return { status: "done" };
    });
    const queue = createJobQueue(handler, { concurrency: 1 });
    const updates: number[] = [];
    const done = queue.enqueue({ id: "j1", episodeId: "e1" }, (p) => updates.push(p));
    await done;
    expect(updates).toEqual([50, 100]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("retries on failure up to maxAttempts with backoff", async () => {
    const handler: JobHandler = vi.fn(async () => { throw new Error("boom"); });
    const queue = createJobQueue(handler, { concurrency: 1, maxAttempts: 3, backoffMs: 5 });
    const result = await queue.enqueue({ id: "j2", episodeId: "e2" }, () => {});
    expect(handler).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("boom");
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现 `services/api/src/pipeline/queue.ts`**

```ts
export interface QueueJob { id: string; episodeId: string; }
export type JobUpdate = (progress: number) => Promise<void>;
export type JobHandler = (job: QueueJob, update: JobUpdate) => Promise<{ status: "done" | "failed"; error?: string }>;

export interface QueueOptions { concurrency: number; maxAttempts: number; backoffMs: number; }

/** 进程内串行队列：重试 + 指数退避；MVP 单实例（ARC §3.1） */
export function createJobQueue(handler: JobHandler, opts: QueueOptions) {
  const pending: Array<{ job: QueueJob; onProgress: (p: number) => void; resolve: (r: { status: string; error?: string }) => void }> = [];
  let running = false;

  async function pump() {
    if (running || pending.length === 0) return;
    running = true;
    const { job, onProgress, resolve } = pending.shift()!;
    try {
      let lastError: unknown;
      for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        try {
          const r = await handler(job, async (p) => { onProgress(p); });
          resolve(r);
          return;
        } catch (e) {
          lastError = e;
          if (attempt < opts.maxAttempts) await new Promise((r) => setTimeout(r, opts.backoffMs * 2 ** (attempt - 1)));
        }
      }
      resolve({ status: "failed", error: String(lastError instanceof Error ? lastError.message : lastError) });
    } finally {
      running = false;
      void pump();
    }
  }

  return {
    enqueue(job: QueueJob, onProgress: (p: number) => void): Promise<{ status: string; error?: string }> {
      return new Promise((resolve) => { pending.push({ job, onProgress, resolve }); void pump(); });
    },
  };
}
```

- [ ] **Step 4: 实现 runner 骨架 `services/api/src/pipeline/runner.ts`**

```ts
// createPipelineRunner(deps: { repo, tts, storage, ffmpeg, assets }) → JobHandler
// 阶段：tts(30%) → merge(70%) → upload(90%) → done(100)
// 每阶段更新 generation_jobs.progress + status；异常抛出让队列重试
// 本任务先实现骨架（阶段回调组装），真实 tts/merge/upload 在 Task 7-9
```

- [ ] **Step 5: 启动恢复逻辑**（`src/index.ts` 或 `src/pipeline/bootstrap.ts`：启动时查 `generation_jobs where status in (queued, tts, merge, upload)` → 重新入队）

- [ ] **Step 6: 测试通过 + typecheck + 提交**

```bash
git add services/api/src services/api/tests
git commit -m "feat(api): in-process job queue with retry + boot recovery"
```

---

### Task 7: TTS 集成（音色创建 + 多说话人 + fallback）

**Files:**
- Create: `services/api/src/pipeline/tts.ts`
- Modify: `services/api/src/pipeline/runner.ts`
- Test: `services/api/tests/pipeline-tts.test.ts`（mock TtsClient）

- [ ] **Step 1: 写失败测试** `services/api/tests/pipeline-tts.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { synthesizeEpisode, type TtsDeps } from "../src/pipeline/tts";

const segments = [
  { speaker: "host", text: "你好" },
  { speaker: "guest", text: "你好！" },
  { speaker: "host", text: "再见" },
];

describe("synthesizeEpisode", () => {
  it("uses multi-speaker single call when host model id exists", async () => {
    const multi = vi.fn(async () => new Uint8Array([1]));
    const deps: TtsDeps = {
      tts: { synthesizeMultiSpeaker: multi, synthesizeSingle: vi.fn(), createVoiceModel: vi.fn() } as never,
      hostModelId: "host-model",
      guestModelId: "guest-model",
    };
    const out = await synthesizeEpisode({ segments, deps });
    expect(out).toEqual(new Uint8Array([1]));
    expect(multi).toHaveBeenCalledWith({
      segments: [
        { speaker: 0, text: "你好" },
        { speaker: 1, text: "你好！" },
        { speaker: 0, text: "再见" },
      ],
      referenceIds: ["host-model", "guest-model"],
    });
  });

  it("falls back to per-segment calls without host model id", async () => {
    const single = vi.fn(async () => new Uint8Array([2]));
    const deps: TtsDeps = {
      tts: { synthesizeSingle: single, synthesizeMultiSpeaker: vi.fn(), createVoiceModel: vi.fn() } as never,
      hostModelId: null,
      guestModelId: "guest-model",
    };
    const out = await synthesizeEpisode({ segments, deps });
    expect(single).toHaveBeenCalledTimes(3);
    expect(out.length).toBe(3);
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现 `services/api/src/pipeline/tts.ts`**

```ts
// synthesizeEpisode({ segments: [{speaker: host|guest, text}], deps: { tts, hostModelId, guestModelId } })
// 1) hostModelId 存在 → 多说话人一次调用（speaker 序号映射 host=0/guest=1）
// 2) 否则 → 逐段 synthesizeSingle（host 段带 referenceAudio（从 voice_samples 取音频），guest 段带 referenceId）
//    返回各段音频，由 merge 按序拼接（段间 300ms）
// 返回 { mainAudio: Uint8Array }（多说话人单文件）或 { segmentAudios: Uint8Array[] }（fallback 拼接用）
```

- [ ] **Step 4: runner 接入 + 测试通过 + typecheck + 提交**

```bash
git add services/api/src services/api/tests
git commit -m "feat(api): tts pipeline (multi-speaker + per-segment fallback)"
```

---

### Task 8: ffmpeg merge（intro/main/outro 拼接）

**Files:**
- Create: `services/api/src/pipeline/merge.ts`
- Create: `services/api/src/pipeline/assets.ts`（资产查找：intro.{lang}.mp3 / outro.{lang}.mp3，缺失降级）
- Test: `services/api/tests/pipeline-merge.test.ts`

- [ ] **Step 1: 写失败测试** `services/api/tests/pipeline-merge.test.ts`（生成 0.5s 静音 wav fixture 做输入，断言输出存在、时长 ≈ 输入和；资产缺失时仅主对话）

```ts
import { describe, expect, it } from "vitest";
import { mergeEpisodeAudio, type MergeDeps } from "../src/pipeline/merge";

describe("mergeEpisodeAudio", () => {
  it("concats main with intro/outro when assets exist", async () => {
    const deps: MergeDeps = {
      ffmpeg: getFfmpeg(), // @ffmpeg-installer/ffmpeg 路径
      assets: { get: async (key) => (key.includes("intro") || key.includes("outro") ? new Uint8Array([0]) : null) },
    };
    const out = await mergeEpisodeAudio({
      language: "zh",
      mainAudio: new Uint8Array([0]),
      deps,
    });
    expect(out.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 实现 `services/api/src/pipeline/merge.ts`**

```ts
// mergeEpisodeAudio({ language, mainAudio, deps: { ffmpegPath, assets } })
// 1) assets.get(`assets/intro.${language}.mp3`) / outro 同；缺失 → null（降级只拼主对话）
// 2) 临时目录写 intro/main/outro 文件 → fluent-ffmpeg concat（filter_complex concat, 段间 300ms apad？简化：直接 concat demuxer）
// 3) 输出单 mp3 → Uint8Array；清理临时文件
// 简化实现：用 concat demuxer（文件列表）+ 静音填充由资产自带间隔；MVP 不做段间 300ms（fallback 拼接场景在 Task 7 说明）
```

- [ ] **Step 3: 实现 `services/api/src/pipeline/assets.ts`**（从本地 `assets/audio/` 目录读取；Task 11 生成真实资产；测试注入 fake）

- [ ] **Step 4: runner 接入 + 测试通过 + typecheck + 提交**

```bash
git add services/api/src services/api/tests
git commit -m "feat(api): ffmpeg merge with intro/outro assets"
```

---

### Task 9: runner 全链 + 代理 fetch + R2 上传接线

**Files:**
- Modify: `services/api/src/pipeline/runner.ts`（完整实现）
- Create: `services/api/src/net/proxy.ts`（socks 代理 fetch 包装，本地 Fish 用）
- Test: `services/api/tests/pipeline-runner.test.ts`（mock 全链：tts/merge/storage/repo）

- [ ] **Step 1: 写失败测试** `services/api/tests/pipeline-runner.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { createPipelineRunner } from "../src/pipeline/runner";

describe("createPipelineRunner", () => {
  it("runs tts → merge → upload and marks done", async () => {
    const repo = {
      getEpisodeForJob: vi.fn(async () => ({ id: "e1", language: "zh" })),
      getScriptSegments: vi.fn(async () => [{ speaker: "host", text: "hi" }]),
      getVoiceSampleAudio: vi.fn(async () => null),
      getHostModelId: vi.fn(async () => "host-m"),
      getGuestModelId: vi.fn(async () => "guest-m"),
      markJobDone: vi.fn(async () => {}),
      updateEpisodeAudio: vi.fn(async () => {}),
    };
    const tts = { synthesizeMultiSpeaker: vi.fn(async () => new Uint8Array([1])) };
    const storage = { put: vi.fn(async () => {}), get: vi.fn() };
    const assets = { get: vi.fn(async () => null) };

    const runner = createPipelineRunner({
      repo: repo as never, tts: tts as never, storage: storage as never,
      assets: assets as never, ffmpegPath: "ffmpeg", progress: async () => {},
    });

    const result = await runner({ id: "j1", episodeId: "e1" }, async () => {});
    expect(result.status).toBe("done");
    expect(repo.markJobDone).toHaveBeenCalled();
    expect(repo.updateEpisodeAudio).toHaveBeenCalled();
    expect(storage.put).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现 `services/api/src/net/proxy.ts`**

```ts
// createProxyFetch(proxyUrl?: string): typeof fetch
// 无代理 → 原样 fetch；socks5:// 代理 → undici ProxyAgent + socks-proxy-agent（本地开发 Fish 用）
// 生产（Railway）无代理直连。若 socks-proxy-agent 集成 undici 有坑，用 https-proxy-agent + http 代理替代并记录。
```

- [ ] **Step 4: 完整 runner（阶段进度：tts=30, merge=70, upload=90, done=100；失败冒泡给队列重试）**

- [ ] **Step 5: index.ts/bootstrap 组装**（env → clients（llm/tts/storage/repo/assets）→ queue(handler=runner) → app；启动恢复 queued jobs）

- [ ] **Step 6: 测试通过 + typecheck + 提交**

```bash
git add services/api/src services/api/tests
git commit -m "feat(api): pipeline runner full chain + proxy fetch + boot wiring"
```

---

### Task 10: voice-sample 路由（录音上传 + 音色创建）

**Files:**
- Create: `services/api/src/routes/voice.ts`
- Modify: `services/api/src/app.ts`
- Test: `services/api/tests/voice.test.ts`（mock storage + tts.createVoiceModel）

- [ ] **Step 1: 写失败测试** `services/api/tests/voice.test.ts`

```ts
// POST /api/me/voice-sample (multipart: file) → 存 storage(audio/voices/{userId}.wav)
// → tts.createVoiceModel({audio, name: userId}) → voice_samples upsert（reference_id + audio_url）
// → 200 { referenceId }；文件缺失/类型错误 → 400；无 FISH_API_KEY → 503 tts_not_configured
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现路由 + 仓储（voice_samples upsert）**

- [ ] **Step 4: 测试通过 + typecheck + 提交**

```bash
git add services/api/src services/api/tests
git commit -m "feat(api): voice-sample route (upload + voice model creation)"
```

---

### Task 11: 固定片头片尾资产（intro/outro zh/en）

**Files:**
- Create: `scripts/spikes/gen-assets.mjs`（复用 fish-audio.mjs 的 socks/msgpack 设施或简化：单说话人固定音色合成 4 段）
- Create: `assets/audio/intro.zh.mp3`、`outro.zh.mp3`、`intro.en.mp3`、`outro.en.mp3`（产物提交）

- [ ] **Step 1: 写生成脚本**（用 Fish `synthesizeSingle`（固定音色 referenceId，无需克隆）；文案：

中文 intro: "欢迎收听 dailogues，在这里，你和 AI 的对话，成为你自己的节目。"
中文 outro: "感谢收听。下一期，我们继续聊。"
英文 intro: "Welcome to Dailogues, where your conversations with AI become your own show."
英文 outro: "Thanks for listening. See you next episode."

- [ ] **Step 2: 运行生成**（`FISH_API_KEY` 从 `scripts/spikes/.env` 读取；走代理）→ 4 个 mp3 落 `assets/audio/`（人工试听确认音色自然）

- [ ] **Step 3: 提交**

```bash
git add scripts/spikes/gen-assets.mjs assets/audio
git commit -m "assets: intro/outro audio (zh/en)"
```

---

### Task 12: 真实 E2E（门控）+ 文档回写

**Files:**
- Create: `services/api/tests/e2e-pipeline.test.ts`（`describe.skipIf(!DEEPSEEK_API_KEY || !FISH_API_KEY)`）
- Modify: `AGENT.md`（M4 状态）、`PRD.md`（如有出入）

- [ ] **Step 1: 门控 E2E**：注入真实 deps（env keys + 本地 PG + fs storage）→ 构造 import → polish（真实 DeepSeek）→ generate → 轮询 job → 断言 audio 文件生成于 `STORAGE_DIR` 且 >1KB；片头片尾拼接后时长合理（ffprobe 可选）

- [ ] **Step 2: 文档回写**：AGENT M4 `[x]`（含真实扣费核对注记沿用 M1）；管线/路由与实测对齐（如有偏差修正 ARC §3.2/§3.3）

- [ ] **Step 3: 提交**

```bash
git add services/api/tests AGENT.md PRD.md ARC.md
git commit -m "docs: M4 完成回写（生成管线全链）"
```

---

## 自检记录（计划作者）

- **Spec 覆盖**：ARC §3.2（imports/polish/generate/job/voice 五路由）、§3.3（管线阶段 + 安全门 + 配额）、§3.4（配额规则）、§3.5（采集协议接收）、§4（表结构）、PRD §4.4/§4.5（双门 + 生成流程）、§4.2（录音样本 → 音色创建）全部落为任务。
- **诚实性**：TTS msgpack 内联路径标注"按 fish-audio.md 校准"，无法确认时以 referenceId 路径为主（多说话人一次调用是主路径，实际也是产品最优路径）；R2 驱动本地不测（部署联调）；片头片尾资产需人工试听。
- **一致性**：`dialogue.ts` 后端复制扩展协议（YAGNI 决策已注明）；quota 语义与 ARC §3.4 一致；job 阶段与 schema `generation_jobs.status` 枚举一致。
- **已知依赖**：`DEEPSEEK_API_KEY`（用户提供）；本地 Fish 走 socks 代理；真实 E2E 门控双 key；`@ffmpeg-installer/ffmpeg` 避免本机安装。
- **范围**：邀请码发放（publish 时）留 plan 7；R2 部署联调留部署阶段；不做片头片尾模板化（固定资产已定）。
