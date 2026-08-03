import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { createApp, type AppDeps } from "../src/app";
import { createAuth } from "../src/auth/better-auth";
import { createDb } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createActivateChannel } from "../src/routes/channel";
import { generateRoutes } from "../src/routes/generate";
import { episodesRoutes } from "../src/routes/episodes";

// 频道开通（授权码）全链路：注册 → 未开通 403 → 开通 → 可生成/发布
const hasDb = Boolean(process.env.DATABASE_URL);

function fakeRepo(): AppDeps["repo"] {
  return {
    imports: {
      findImportBySource: async () => null,
      insertImport: async () => ({ id: "imp-1" }),
      insertEpisode: async () => ({ id: "ep-1" }),
      createImport: async () => ({ importId: "imp-1", episodeId: "ep-1" }),
    },
    episodes: {
      listEpisodes: async () => [],
      getEpisode: async () => null,
      getEpisodeAudio: async () => null,
      saveScript: async (episodeId, version, segments) => ({ episodeId, version, segments }),
      getLatestScript: async () => ({ version: 1, segments: [{ speaker: "host", text: "hi" }] }),
      getImportedDialogue: async () => null,
      getPublishedDialogue: async () => null,
      getPolishCount: async () => 0,
      incrementPolishCount: async () => {},
      setPublished: async () => {},
      setEpisodeLanguage: async () => {},
      getEpisodeUserId: async () => null,
      getEpisodeLanguage: async () => null,
      getHostModelId: async () => null,
      getVoiceSampleKey: async () => null,
      saveVoiceSample: async () => {},
      getVoiceSample: async () => null,
      getChannelActivatedAt: async (userId) => channelState.get(userId) ?? null,
    },
    jobs: {
      getQuotaInfo: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
      consumeQuota: async () => {},
      createJob: async (episodeId) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
      getLatestJob: async () => null,
      getOwnedEpisode: async () => ({ id: "ep-1" }),
      listRecoverableJobs: async () => [],
      markJobProgress: async () => {},
      markJobDone: async () => {},
      updateEpisodeAudio: async () => {},
      markJobFailed: async () => {},
    },
  };
}

function fakePolish(): AppDeps["polish"] {
  return {
    getDialogueMessages: async () => [],
    qualityCheck: async () => ({ pass: true, language: "zh" }),
    savePolished: async (_e, _l, segments) => ({ version: 1, segments }),
    getPolishCount: async () => 0,
    getPolishLimit: async () => 5,
    llm: { complete: async () => "", stream: async () => "" },
  };
}

function fakeGenerate(active: boolean): AppDeps["generate"] {
  return {
    getOwnedEpisode: async () => ({ id: "ep-1" }),
    getLatestScript: async () => ({ version: 1, segments: [{ speaker: "host", text: "hi" }] }),
    safetyCheck: async () => ({ pass: true }),
    getChannelActive: async () => active,
    getQuota: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
    consumeQuota: async () => {},
    createJob: async (episodeId) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
    enqueueJob: async () => {},
  };
}

function fakeJob(): AppDeps["job"] {
  return {
    getOwnedEpisode: async () => ({ id: "ep-1" }),
    getLatestJob: async () => null,
  };
}

function fakeVoice(): AppDeps["voice"] {
  return {
    saveVoiceSample: async () => {},
    tts: null,
    storage: { put: async () => {}, get: async () => new Uint8Array() },
  };
}

// 频道状态共享：fakeRepo 的 getChannelActivatedAt 从这里读
const channelState = new Map<string, Date>();

describe.skipIf(!hasDb)("channel activation (授权码开通频道, real local PG)", () => {
  let dbClient: ReturnType<typeof createDb>;
  let app: ReturnType<typeof createApp>;
  let adminUserId: string;
  let testCode: string;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    dbClient = createDb({ DATABASE_URL: process.env.DATABASE_URL! } as never);
    const admin = await dbClient.db
      .insert(schema.authUsers)
      .values({
        id: `ch-admin-${randomUUID()}`,
        name: "Admin",
        email: `ch-admin-${randomUUID().slice(0, 8)}@test.local`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: schema.authUsers.id });
    adminUserId = admin[0].id;
    testCode = `ch-code-${randomUUID().slice(0, 8)}`;
    await dbClient.db.insert(schema.inviteCodes).values({
      code: testCode, createdBy: adminUserId, source: "admin", expiresAt: null,
    });

    const auth = createAuth({ db: dbClient.db, secret: "test-secret" });
    app = createApp({
      env: {
        DATABASE_URL: process.env.DATABASE_URL!,
        BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: "http://localhost:8787",
        PORT: 8787,
        DEEPSEEK_API_KEY: "",
        DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
        DEEPSEEK_MODEL: "deepseek-chat",
        FISH_API_KEY: "",
        STORAGE_DRIVER: "fs",
        STORAGE_DIR: "./data",
        ASSETS_DIR: "assets/audio",
        APP_ORIGINS: "",
        POLISH_MAX_VERSIONS: 5,
      },
      auth,
      repo: fakeRepo(),
      polish: fakePolish(),
      generate: fakeGenerate(true),
      job: fakeJob(),
      voice: fakeVoice(),
      channel: { activateChannel: createActivateChannel(dbClient.db) },
      favorites: {
        getPublishableEpisode: async () => null,
        toggleFavorite: async () => ({ favorited: true }),
        toggleLike: async () => ({ liked: true }),
        listFavorites: async () => [],
      },
    });

    // 注册一个用户（开放注册）
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `ch-user-${randomUUID().slice(0, 8)}@test.local`, password: "password123", name: "频道用户" }),
    });
    const body = (await res.json()) as { token: string; user: { id: string } };
    token = body.token;
    userId = body.user.id;
  });

  afterAll(async () => {
    if (dbClient) {
      await dbClient.db.delete(schema.inviteCodes).where(like(schema.inviteCodes.code, "ch-%"));
      await dbClient.db.delete(schema.authUsers).where(like(schema.authUsers.email, "ch-%@test.local"));
      await dbClient.client.end().catch(() => {});
    }
  });

  it("rejects activation with unknown code", async () => {
    const res = await app.request("/api/me/channel/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ inviteCode: "no-such-code" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_invite_code" });
  });

  it("rejects activation without code", async () => {
    const res = await app.request("/api/me/channel/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("activates channel with valid code → invite marked used + channelActive true", async () => {
    const res = await app.request("/api/me/channel/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ inviteCode: testCode }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // 授权码已标记
    const codes = await dbClient.db
      .select({ usedBy: schema.inviteCodes.usedBy })
      .from(schema.inviteCodes)
      .where(eq(schema.inviteCodes.code, testCode));
    expect(codes[0]?.usedBy).toBe(userId);

    // DB 频道开通时间已写
    const prof = await dbClient.db
      .select({ channelActivatedAt: schema.profiles.channelActivatedAt })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, userId));
    expect(prof[0]?.channelActivatedAt).toBeTruthy();
  });

  it("rejects second use of same code", async () => {
    const res = await app.request("/api/me/channel/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ inviteCode: testCode }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_invite_code" });
  });
});

describe("channel gates (generate/publish 403 when not active)", () => {
  it("generate returns 403 channel_not_active when channel inactive", async () => {
    const app = generateRoutes(fakeGenerate(false));
    const res = await app.request("/api/episodes/ep-1/generate", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "channel_not_active" });
  });

  it("publish returns 403 channel_not_active when channel inactive", async () => {
    const repo = fakeRepo();
    const inactive: AppDeps["repo"]["episodes"] = {
      ...repo.episodes,
      getEpisode: async () => ({ id: "ep-1", userId: "u-1", title: "t", status: "draft" }),
      getChannelActivatedAt: async () => null,
    };
    const app = episodesRoutes(inactive, () => "u-1");
    const res = await app.request("/episodes/ep-1/publish", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "channel_not_active" });
  });
});
