import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { createApp, type AppDeps, type AuthLike } from "../src/app";
import { createAuth } from "../src/auth/better-auth";
import { createDb } from "../src/db/client";
import * as schema from "../src/db/schema";

// 认证全链路测试：真实 better-auth + 本地 PG（门控；无 DATABASE_URL 时跳过）
const hasDb = Boolean(process.env.DATABASE_URL);

function fakeImportDeps(): AppDeps["importDeps"] {
  return {
    getSnapshotByUrl: async () => null,
    createSnapshot: async (row) => ({ id: "snap-1", platform: row.platform, sourceTitle: row.sourceTitle, sourceConversationId: row.sourceConversationId, parsedDialogue: row.parsedDialogue, quality: null, status: "ok", retryAfter: null, lastError: null }),
    updateSnapshotContent: async () => {},
    markSnapshotUnreachable: async () => {},
    markSnapshotParseFailed: async () => {},
    findPolishByUserSnapshot: async () => null,
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
    },
    polishes: {
      findByUserSnapshot: async () => null,

      create: async () => ({ id: "polish-1" }),
      createSubmission: async () => ({ id: "sub-1" }),
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
      getPublishedDialogue: async () => null,
      setPublished: async () => {},
      getById: async () => null,
      publish: async () => ({ number: 1 }),
      updatePublished: async () => {},
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

describe.skipIf(!hasDb)("auth (better-auth, real local PG)", () => {
  let dbClient: ReturnType<typeof createDb>;
  let app: ReturnType<typeof createApp>;
  let adminUserId: string;

  const email = () => `auth-${randomUUID().slice(0, 8)}@test.local`;
  const INVALID_CODE = "no-such-code-xyz";
  /** 每个用例独立邀请码（避免用例间 used 状态污染） */
  const freshCode = () => `auth-code-${randomUUID().slice(0, 8)}`;
  const insertInvite = async (code: string, expiresAt: Date | null = null) => {
    await dbClient!.db.insert(schema.inviteCodes).values({
      code, createdBy: adminUserId, source: "admin", expiresAt,
    });
  };

  beforeAll(async () => {
    dbClient = createDb({ DATABASE_URL: process.env.DATABASE_URL! } as never);
    // admin user（invite_codes.created_by 引用 user.id）
    const admin = await dbClient.db
      .insert(schema.authUsers)
      .values({
        id: `admin-${randomUUID()}`,
        name: "Admin",
        email: `auth-admin-${randomUUID().slice(0, 8)}@test.local`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: schema.authUsers.id });
    adminUserId = admin[0].id;

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
    channel: { activateChannel: async () => ({ ok: true }) },
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
  });

  afterAll(async () => {
    if (dbClient) {
      // 清理顺序：先删邀请码（used_by 引用 user，无 cascade），再删测试用户（级联 profiles/sessions/accounts）
      await dbClient.db
        .delete(schema.inviteCodes)
        .where(like(schema.inviteCodes.code, "auth-%"));
      await dbClient.db
        .delete(schema.authUsers)
        .where(like(schema.authUsers.email, "auth-%@test.local"));
      await dbClient.client.end().catch(() => {});
    }
  });

  it("signs up without invite code → token + profile row（注册开放，码仅用于开通频道）", async () => {
    const mail = email();
    const res = await app.request("/v1/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: mail, password: "password123", name: "新用户" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { token?: string; user?: { id: string } };
    expect(typeof json.token).toBe("string");
    expect(json.user?.id).toBeTruthy();

    // profile 行已创建（after hook）
    const profiles = await dbClient.db
      .select({ id: schema.profiles.id, channelActivatedAt: schema.profiles.channelActivatedAt })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, json.user!.id));
    expect(profiles.length).toBe(1);
    expect(profiles[0]?.channelActivatedAt).toBeNull(); // 频道未开通

    // 带 token 访问受保护接口
    const me = await app.request("/v1/me", {
      headers: { Authorization: `Bearer ${json.token}` },
    });
    expect(me.status).toBe(200);
    expect((await me.json()) as { userId: string; channelActive: boolean }).toEqual({
      userId: json.user!.id,
      channelActive: false,
    });
  });

  it("signs in and get-session restores via bearer token", async () => {
    const mail = email();
    await app.request("/v1/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: mail, password: "password123", name: "登录用户" }),
    });
    const signIn = await app.request("/v1/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: mail, password: "password123" }),
    });
    expect(signIn.status).toBe(200);
    const { token, user } = (await signIn.json()) as { token: string; user: { id: string } };

    const session = await app.request("/v1/auth/get-session", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(session.status).toBe(200);
    const body = (await session.json()) as { user?: { id: string } };
    expect(body.user?.id).toBe(user.id);
  });

  it("rejects invalid bearer token with 401", async () => {
    const res = await app.request("/v1/me", {
      headers: { Authorization: "Bearer garbage-token" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects missing token with 401", async () => {
    const res = await app.request("/v1/me");
    expect(res.status).toBe(401);
  });
});
