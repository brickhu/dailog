import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { createApp, type AppDeps } from "../src/app";
import { createAuth } from "../src/auth/better-auth";
import { createDb } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createActivateChannel } from "../src/routes/channel";
import { episodesRoutes } from "../src/routes/episodes";

// 频道开通（授权码）全链路：注册 → 未开通 403 → 开通 → 可生成/发布
const hasDb = Boolean(process.env.DATABASE_URL);

function fakeImportDeps(): AppDeps["importDeps"] {
  return {
    getSnapshotByUrl: async () => null,
    createSnapshot: async (row) => ({ id: "snap-1", platform: row.platform, sourceTitle: row.sourceTitle, sourceConversationId: row.sourceConversationId, parsedDialogue: row.parsedDialogue, quality: null, status: "ok", retryAfter: null, lastError: null }),
    updateSnapshotContent: async () => {},
    markSnapshotUnreachable: async () => {},
    markSnapshotParseFailed: async () => {},
    findPolishByUserSnapshot: async () => null,
      parseShareHtml: async () => null,
      listTraceableSnapshots: async () => [],
      setSnapshotSourceTrace: async () => {},
      findPublishedEpisodeBySnapshot: async () => null,
    getPlatformRules: async () => [
      { id: "claude", label: "Claude", sharePattern: "^https?:\\/\\/(www\\.)?claude\\.ai\\/share\\/[0-9a-f-]{36}" },
      { id: "deepseek", label: "DeepSeek", sharePattern: "^https?:\\/\\/chat\\.deepseek\\.com\\/share\\/[A-Za-z0-9]+" },
      { id: "chatgpt", label: "ChatGPT", sharePattern: "^https?:\\/\\/(www\\.)?chatgpt\\.com\\/share\\/[A-Za-z0-9-]+" },
      { id: "kimi", label: "Kimi", sharePattern: "^https?:\\/\\/(www\\.)?kimi\\.com\\/share\\/[0-9a-f-]{36}" },
    ],
  };
}
function fakePolishesDeps(): AppDeps["polishesDeps"] {
  return {
    getChannelActivatedAt: async () => new Date(),
    findPolishByUserSnapshot: async () => null,

    createPolish: async () => ({ id: "polish-1" }),
    getPolishDetail: async () => null,
      listByUser: async () => [],
  };
}
function fakeTranscriptsDeps(): AppDeps["transcriptsDeps"] {
  return {
    getDialogueForPolish: async () => null,
    getTranscriptCount: async () => 0,
    getPolishLimit: async () => 5,
          guestsByPlatform: {},
createTranscript: async () => ({ id: "transcript-1" }),
    getOwnedTranscript: async () => null,
    updateTranscriptSegments: async () => {},
    llm: { complete: async () => "", stream: async () => "" },
  };
}
function fakeEpisodesDeps(): AppDeps["episodesDeps"] {
  return {
    listByUser: async () => [],
    getOwned: async () => null,
    getEpisodeAudio: async () => null,
    getOwnedTranscript: async () => null,
    getEpisodeByTranscript: async () => null,
    createEpisode: async () => ({ id: "ep-1" }),
    safetyCheck: async () => ({ pass: true }),
    getChannelActive: async () => true,
    getQuota: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
    consumeQuota: async () => {},
    createJob: async (episodeId: string) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
    getLatestJob: async () => null,
    enqueueJob: async () => {},
    setPublished: async () => {},
    getChannelActivatedAt: async () => new Date(),
    getHostModelId: async () => null,
    getVoiceSampleKey: async () => null,
    getVoiceSample: async () => null,
    getVoiceSampleByLanguage: async () => null,
    markUsed: async () => {},
    saveVoiceSample: async () => {},
  };
}

function fakeRepo(): AppDeps["repo"] {
  return {
        notifications: {
          create: async () => {},
          listByUser: async () => [],
          unreadCount: async () => 0,
          markAllRead: async () => {},
          getEmailByUserId: async () => null,
        },
        guests: {
      getByPlatform: async () => null,
      list: async () => [],
      voiceSampleByLanguage: async () => null,
      voiceSampleAny: async () => null,
      upsertVoiceSample: async () => {},
      listVoiceSamples: async () => [],
    },
    snapshots: {
      getByUrl: async () => null,
      getById: async () => null,
      create: async () => ({ id: "snap-1" }),
      updateContent: async () => {},
      updateQuality: async () => {},
      markUnreachable: async () => {},
            markParseFailed: async () => {},
      listTraceable: async () => [],
      setSourceTrace: async () => {},
    },
    polishes: {
      findByUserSnapshot: async () => null,

      create: async () => ({ id: "polish-1" }),
      createSubmission: async () => ({ id: "sub-1" }),
      countPendingByUser: async () => 0,
      listSubmissionsByUser: async () => [],
      listQueue: async () => [],
      getById: async () => null,
      setStatus: async () => {},
      getOwned: async () => null,
      getPolishDetail: async () => null,
      listByUser: async () => [],
    },
    transcripts: {
      create: async () => ({ id: "transcript-1" }),
      listByPolish: async () => [],
      getOwned: async () => null,
      updateSegments: async () => {},
      markUsed: async () => {},
      getById: async () => null,
    },
    episodes: {
      create: async () => ({ id: "ep-1" }),
      listByUser: async () => [],
      getOwned: async () => null,
      getEpisodeAudio: async () => null,
      getByTranscript: async () => null,
      listByPolish: async () => [],
      getEpisodeScript: async () => null,
      getEpisodeGuest: async () => null,
      getPublicAudioKey: async () => null,
      getPublicCoverKey: async () => null,
      getPublishedDialogue: async () => null,
      setPublished: async () => {},
      getById: async () => null,
      publish: async () => ({ number: 1 }),
      updatePublished: async () => {},
      listPublished: async () => [],
      findPublishedEpisodeBySnapshot: async () => null,
      getEpisodeUserId: async () => null,
      getEpisodeLanguage: async () => null,
      getHostModelId: async () => null,
      getVoiceSampleKey: async () => null,
      getVoiceSample: async () => null,
      getVoiceSampleByLanguage: async () => null,
      saveVoiceSample: async () => {},
      insertTrack: async () => {},
      getChannelActivatedAt: async () => new Date(),
      getProfile: async () => null,
      updateUserNickname: async () => {},
      updatePersona: async () => {},
      updateChannel: async () => ({ ok: true } as const),
      isUsernameTaken: async () => false,
      syncAdminRoles: async () => 0,
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

      markJobFailed: async () => {},
    },
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
        storage: { put: async () => {}, get: async () => new Uint8Array(), delete: async () => {} },
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

    const testEnv = {
      DATABASE_URL: process.env.DATABASE_URL!,
      BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: "http://localhost:8787",
      PORT: 8787,
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
      DEEPSEEK_MODEL: "deepseek-chat",
      FISH_API_KEY: "",
      STORAGE_DRIVER: "fs" as const,
      STORAGE_DIR: "./data",
      ASSETS_DIR: "assets/audio",
      APP_ORIGINS: "",
      POLISH_MAX_VERSIONS: 5,
      RESEND_API_KEY: "",
      EMAIL_FROM: "dailog <no-reply@dailog.fm>",
      ADMIN_EMAILS: "",
      PEXELS_API_KEY: "",
    SITE_BASE_URL: "https://site.dailog.fm",

    };

    const auth = createAuth({ db: dbClient.db, secret: "test-secret", env: testEnv });
    app = createApp({
      env: testEnv,
      auth,
      repo: fakeRepo(),
    importDeps: fakeImportDeps(),
    polishesDeps: fakePolishesDeps(),
    transcriptsDeps: fakeTranscriptsDeps(),
    episodesDeps: fakeEpisodesDeps(),
      job: fakeJob(),
      voice: fakeVoice(),
      channel: { activateChannel: createActivateChannel(dbClient.db) },
      favorites: {
        getPublishableEpisode: async () => null,
        toggleFavorite: async () => ({ favorited: true }),
        toggleLike: async () => ({ liked: true }),
        listFavorites: async () => [],
      },
      admin: {
        isAdmin: async () => false,
        createInviteCode: async () => ({ ok: true, code: "fake", expiresAt: null }),
        storage: { put: async () => {} },
        upsertGuestVoiceSample: async () => {},
        listGuestVoiceSamples: async () => [],
        listGuests: async () => [],
      },
    });

    // 注册一个用户（开放注册）
    const res = await app.request("/v1/auth/sign-up/email", {
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
    const res = await app.request("/v1/me/channel/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ inviteCode: "no-such-code" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_invite_code" });
  });

  it("rejects activation without code", async () => {
    const res = await app.request("/v1/me/channel/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("activates channel with valid code → invite marked used + channelActive true", async () => {
    const res = await app.request("/v1/me/channel/activate", {
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
    const res = await app.request("/v1/me/channel/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ inviteCode: testCode }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_invite_code" });
  });
});

describe("channel gates (generate/publish 403 when not active)", () => {
  it("episodes/new returns 403 channel_not_active when channel inactive", async () => {
    const deps = fakeEpisodesDeps();
    deps.getOwnedTranscript = async () => ({ id: "t-1", polishId: "p-1", segments: [{ speaker: "host", text: "h" }], topic: null, language: null, guestId: null, snapshotId: null });
    deps.getChannelActive = async () => false;
    const app = episodesRoutes(deps, () => "u-1");
    const res = await app.request("/episodes/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcriptId: "t-1" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "channel_not_active" });
  });

  it("publish returns 403 channel_not_active when channel inactive", async () => {
    const deps = fakeEpisodesDeps();
    deps.getOwned = async () => ({
      id: "ep-1", transcriptId: "t-1", polishId: "p-1", title: "t", description: null, status: "generating",
      durationSeconds: null, topic: null, tags: null, coverUrl: null, createdAt: new Date(), publishedAt: null,
    });
    deps.getChannelActivatedAt = async () => null;
    const app = episodesRoutes(deps, () => "u-1");
    const res = await app.request("/episodes/ep-1/publish", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "channel_not_active" });
  });
});
