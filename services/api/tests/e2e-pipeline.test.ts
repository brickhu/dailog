/**
 * 真实 E2E（门控）：本地 PG + 真实 DeepSeek（质量门 / 流式润色 / 安全门）+ 真实 Fish Audio TTS
 * （经本地 socks5 代理）+ 真实 ffmpeg（含真实 intro/outro 资产）+ fs 存储（测试专属临时目录）。
 * 覆盖全链：imports → polish(SSE) → generate(配额/安全门) → 队列 runner(tts → merge → upload) → done。
 *
 * 门控：DEEPSEEK_API_KEY / FISH_API_KEY / DATABASE_URL 任一缺失 → 整组 SKIP
 * （E2E 提交即含，CI 或无 key 本地安全跳过）。FISH_PROXY_URL 为本地出网必需
 * （缺失时 beforeAll 报错提示；空字符串 = 直连，仅限网络可达 Fish 的环境）。
 *
 * 本地运行（FISH_API_KEY 在 scripts/spikes/.env；DEEPSEEK_API_KEY 由用户提供；
 * 需先启动本地 socks5 代理，如 clash 1081 端口）：
 *
 *   DEEPSEEK_API_KEY=sk-... FISH_API_KEY=... FISH_PROXY_URL=socks5://127.0.0.1:1081 \
 *   DATABASE_URL=postgres://dailogues:dailogues@localhost:5432/dailogues \
 *   pnpm --filter @dailogues/api test
 *
 * 注意：真实调用 DeepSeek 与 Fish Audio，产生少量费用（免费首期不扣 credit）；
 * 测试数据与临时音频目录在 afterAll 清理（profile 级联删除 imports/episodes/scripts/generation_jobs）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth/better-auth";
import { loadEnv } from "../src/config/env";
import { createDb } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createRepo } from "../src/repo";
import { createLlmClient } from "../src/llm/client";
import { parseJsonLoose, qualityCheckPrompt, safetyCheckPrompt } from "../src/llm/prompts";
import { createTtsClient } from "../src/tts/client";
import { createStorage } from "../src/storage";
import { createLocalAssetStore } from "../src/pipeline/assets";
import { createProxyFetch } from "../src/net/proxy";
import { createPipelineRunner } from "../src/pipeline/runner";
import { createJobQueue } from "../src/pipeline/queue";
import type { PolishDeps } from "../src/routes/polish";
import type { GenerateDeps } from "../src/routes/generate";
import type { JobDeps } from "../src/routes/job";
import type { VoiceDeps } from "../src/routes/voice";
import { createActivateChannel, type ChannelDeps } from "../src/routes/channel";
import { createFavoritesRepo } from "../src/routes/favorites";

// 门控（skip 条件）：三个必需环境变量任一缺失 → SKIP
const hasE2eEnv = Boolean(
  process.env.DEEPSEEK_API_KEY && process.env.FISH_API_KEY && process.env.DATABASE_URL,
);

// 仓库根的真实片头/片尾资产（assets/audio/，Task 11 生成；merge 阶段按语言读取）
const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const ASSETS_DIR = join(ROOT, "assets", "audio");

// 真实 better-auth 注册用户（M5）：beforeAll 造邀请码注册，token 供后续请求
let AUTH_TOKEN = "";
let USER_ID = "";
const ADMIN_USER_ID = `e2e-admin-${randomUUID().slice(0, 8)}`;
const INVITE_CODE = `e2e-code-${randomUUID().slice(0, 8)}`;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe.skipIf(!hasE2eEnv)("e2e generation pipeline (real LLM + TTS + PG + ffmpeg)", () => {
  let storageDir: string;
  let dbClient: ReturnType<typeof createDb>;
  let repo: ReturnType<typeof createRepo>;
  let app: ReturnType<typeof createApp>;
  let episodeId: string;

  beforeAll(async () => {
    expect(process.env.FISH_PROXY_URL,
      "本地出网需 FISH_PROXY_URL（如 socks5://127.0.0.1:1081）；仅当网络可直接访问 api.fish.audio 时留空字符串直连",
    ).toBeDefined();

    storageDir = await mkdtemp(join(tmpdir(), "dailogues-e2e-"));
    const env = loadEnv({
      ...process.env,
      // 认证：真实 better-auth（本地 PG 注册），BETTER_AUTH_SECRET 用 e2e 专属值
      BETTER_AUTH_SECRET: "e2e-secret-not-for-prod",
      STORAGE_DRIVER: "fs",
      STORAGE_DIR: storageDir, // 测试专属临时目录，afterAll 清理
      ASSETS_DIR,
    });

    dbClient = createDb(env);
    repo = createRepo(dbClient.db);

    // 造邀请码（admin user + 码），供真实注册
    await dbClient.db.insert(schema.authUsers).values({
      id: ADMIN_USER_ID,
      name: "E2E Admin",
      email: `e2e-admin-${randomUUID().slice(0, 8)}@test.local`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await dbClient.db.insert(schema.inviteCodes).values({
      code: INVITE_CODE,
      createdBy: ADMIN_USER_ID,
      source: "admin",
      expiresAt: null,
    });

    const llm = createLlmClient({
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL,
      model: env.DEEPSEEK_MODEL,
    });
    const tts = createTtsClient({ apiKey: env.FISH_API_KEY, fetchImpl: createProxyFetch(env.FISH_PROXY_URL) });
    const storage = createStorage({ driver: "fs", dir: storageDir });

    // 进程内串行队列 + 全链 runner（组装方式对齐 src/index.ts；无音色样本/嘉宾固定 id → 零样本按段 fallback）
    const queue = createJobQueue(createPipelineRunner({
      repo: {
        getEpisodeUserId: repo.episodes.getEpisodeUserId,
        getEpisodeLanguage: repo.episodes.getEpisodeLanguage,
        getLatestScript: repo.episodes.getLatestScript,
        getHostModelId: repo.episodes.getHostModelId,
        getVoiceSampleKey: repo.episodes.getVoiceSampleKey,
        getGuestModelId: async () => null, // 嘉宾固定音色 id 未提供（Task 10 音色体系），走零样本/默认音色 fallback
        markJobProgress: repo.jobs.markJobProgress,
        markJobDone: repo.jobs.markJobDone,
        updateEpisodeAudio: repo.jobs.updateEpisodeAudio,
      },
      tts,
      storage,
      assets: createLocalAssetStore(ASSETS_DIR),
      ffmpegPath: ffmpegInstaller.path,
    }), { concurrency: 1, maxAttempts: 2, backoffMs: 1000 });

    const polish: PolishDeps = {
      getDialogueMessages: (id, userId) => repo.episodes.getImportedDialogue(id, userId),
      qualityCheck: async (messages) =>
        parseJsonLoose(await llm.complete(qualityCheckPrompt(messages))) as { pass: boolean; reason?: string; language?: "zh" | "en" },
      savePolished: async (id, language, segments) => {
        const latest = await repo.episodes.getLatestScript(id);
        await repo.episodes.setEpisodeLanguage(id, language);
        return repo.episodes.saveScript(id, (latest?.version ?? 0) + 1, segments);
      },
      getPolishCount: (id) => repo.episodes.getPolishCount(id),
      getPolishLimit: async () => 5,
      llm,
    };

    const generate: GenerateDeps = {
      getOwnedEpisode: (id, userId) => repo.jobs.getOwnedEpisode(id, userId),
      getLatestScript: (id) => repo.episodes.getLatestScript(id),
      safetyCheck: async (segments) =>
        parseJsonLoose(await llm.complete(safetyCheckPrompt(segments))) as { pass: boolean; reason?: string },
      getChannelActive: async (userId) => (await repo.episodes.getChannelActivatedAt(userId)) !== null,
      getQuota: (userId) => repo.jobs.getQuotaInfo(userId),
      consumeQuota: (userId, credit) => repo.jobs.consumeQuota(userId, credit),
      createJob: (id) => repo.jobs.createJob(id),
      enqueueJob: async (job) => {
        void queue.enqueue({ id: job.id, episodeId: job.episodeId }, () => {}).then((result) => {
          if (result.status === "failed") {
            void repo.jobs.markJobFailed(job.id, result.error ?? "unknown");
          }
        });
      },
    };

    const job: JobDeps = {
      getOwnedEpisode: (episodeId, userId) => repo.jobs.getOwnedEpisode(episodeId, userId),
      getLatestJob: (id) => repo.jobs.getLatestJob(id),
    };
    const voice: VoiceDeps = { saveVoiceSample: (row) => repo.episodes.saveVoiceSample(row), tts, storage };
    const channel: ChannelDeps = { activateChannel: createActivateChannel(dbClient.db) };
    const favorites = createFavoritesRepo(dbClient.db);

    // 真实 better-auth：注册测试用户，token 供全流程请求（认证与生产路径一致）
    const auth = createAuth({ db: dbClient.db, secret: env.BETTER_AUTH_SECRET, env });
    app = createApp({
      env,
      auth,
      channel,
      favorites,
      repo,
      polish,
      generate,
      job,
      voice,
    });
    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `e2e-${randomUUID().slice(0, 8)}@test.local`,
        password: "password123",
        name: "E2E User",
        inviteCode: INVITE_CODE,
      }),
    });
    if (signUp.status !== 200) {
      throw new Error(`e2e sign-up failed: ${signUp.status} ${await signUp.text()}`);
    }
    const { token, user } = (await signUp.json()) as { token: string; user: { id: string } };
    // 开通频道（授权码）：e2e 生成管线需要频道已开通
    const activate = await app.request("/api/me/channel/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ inviteCode: INVITE_CODE }),
    });
    if (activate.status !== 200) {
      throw new Error(`e2e channel activation failed: ${activate.status} ${await activate.text()}`);
    }
    AUTH_TOKEN = token;
    USER_ID = user.id;
  });

  afterAll(async () => {
    if (dbClient) {
      try {
        // 级联清理：user 删除 → profiles/sessions/accounts/imports/episodes/scripts/jobs
        if (USER_ID) await dbClient.db.delete(schema.authUsers).where(eq(schema.authUsers.id, USER_ID));
        await dbClient.db.delete(schema.inviteCodes).where(eq(schema.inviteCodes.code, INVITE_CODE));
        await dbClient.db.delete(schema.authUsers).where(eq(schema.authUsers.id, ADMIN_USER_ID));
      } catch { /* 表未就绪等情况忽略 */ }
      await dbClient.client.end().catch(() => {});
    }
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("import → polish(SSE done) → generate(202) → job done → audio file in storage", async () => {
    // 1. 导入有实质内容的对话（6 轮，质量门不拒）
    const importRes = await app.request("/api/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${AUTH_TOKEN}` },
      body: JSON.stringify({
        platform: "claude",
        conversationId: `e2e-${randomUUID()}`,
        title: "E2E 测试对话",
        url: "https://claude.ai/chat/e2e",
        messages: [
          { role: "user", content: "我最近想开始练习英语口语，但总是不敢开口，你有什么建议吗？" },
          { role: "assistant", content: "这是很多学习者都会遇到的瓶颈。建议先降低标准：每天只练十分钟，自言自语复述当天发生的事，不在乎语法错误，重点是形成开口的习惯。" },
          { role: "user", content: "自言自语听起来有点奇怪，有没有更自然的方式？" },
          { role: "assistant", content: "可以找语言伙伴或者用 AI 对话练习；另一个有效方法是模仿跟读：选一段喜欢的演讲，先听再跟读，逐句模仿语音语调，能同时改善发音和语感。" },
          { role: "user", content: "那词汇量不够怎么办，聊天时总是卡壳？" },
          { role: "assistant", content: "卡壳其实是正常的。建议围绕自己熟悉的主题多聊，把高频表达练熟，同时每天积累几个实用短语，而不是孤立地背单词。" },
        ],
      }),
    });
    expect(importRes.status).toBe(201);
    episodeId = ((await importRes.json()) as { episodeId: string }).episodeId;
    expect(episodeId).toBeTruthy();

    // 2. 润色：真实 DeepSeek 流式 → SSE 含 done（无 error），脚本落库 version >= 1
    const polishRes = await app.request(`/api/episodes/${episodeId}/polish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(polishRes.status).toBe(200);
    const sseText = await polishRes.text();
    expect(sseText).toContain("event: done");
    expect(sseText).not.toContain("event: error");
    const script = await repo.episodes.getLatestScript(episodeId);
    expect(script).not.toBeNull();
    expect(script!.version).toBeGreaterThanOrEqual(1);
    expect(script!.segments.length).toBeGreaterThan(0);

    // 3. 生成：真实安全门 + 配额（free 首期 0 credit）→ 202 + jobId
    const genRes = await app.request(`/api/episodes/${episodeId}/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(genRes.status).toBe(202);
    const { jobId } = (await genRes.json()) as { jobId: string };
    expect(jobId).toBeTruthy();

    // 4. 轮询 job 直到 done/failed（上限 120s，间隔 1s）
    let job: { status: string; error: string | null } | null = null;
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      const jobRes = await app.request(`/api/episodes/${episodeId}/job`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(jobRes.status).toBe(200);
      job = (await jobRes.json()) as { status: string; error: string | null };
      if (job.status === "done" || job.status === "failed") break;
      await sleep(1000);
    }
    expect(job?.status).toBe("done");

    // 5. 产物断言：episode.audio_url 已更新 + 存储文件存在且 > 1KB（真实 TTS + ffmpeg 拼接产物）
    const rows = await dbClient.db
      .select({ audioUrl: schema.episodes.audioUrl, durationSeconds: schema.episodes.durationSeconds })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, episodeId));
    expect(rows[0]?.audioUrl).toMatch(/^audio\/episodes\//);
    expect(rows[0]?.durationSeconds ?? 0).toBeGreaterThan(0); // ffmpeg Duration 探测成功
    const audio = await readFile(join(storageDir, rows[0]!.audioUrl!));
    expect(audio.length).toBeGreaterThan(1024);
  }, 300_000);
});
