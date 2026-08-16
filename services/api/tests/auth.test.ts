import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { createApp, type AppDeps, type AuthLike } from "../src/app";
import { createAuth } from "../src/auth/better-auth";
import { createDb } from "../src/db/client";
import * as schema from "../src/db/schema";

// 认证全链路测试：真实 better-auth + 本地 PG（门控；无 DATABASE_URL 时跳过）
const hasDb = Boolean(process.env.DATABASE_URL);

function fakeRepo(): AppDeps["repo"] {
  return {
    notifications: {
      create: async () => {},
      listByUser: async () => [],
      unreadCount: async () => 0,
      markAllRead: async () => {},
      getEmailByUserId: async () => null,
      existsAfter: async () => false,
      existsByLink: async () => false,
    },
    guests: {
      getByPlatform: async () => null,
      getById: async () => null,
      list: async () => [],
      voiceSampleByLanguage: async () => null,
      voiceSampleAny: async () => null,
      upsertVoiceSample: async () => {},
      update: async () => {},
      listVoiceSamples: async () => [],
    },
    submissions: {
      create: async () => ({ id: "sub-1" }),
      findByUrl: async () => null,
      findById: async () => null,
      countPendingByUser: async () => 0,
      hasReadyVoiceSample: async () => true,
      listByUser: async () => [],
      getPublicById: async () => null,
      getByUser: async () => null,
      listQueue: async () => [],
      getDetail: async () => null,
      reject: async () => {},
      markPublished: async () => {},
    },
    episodes: {
      createPublished: async () => ({ id: "ep-1", number: 1, slug: "abc12345" }),
      getPublicAudioKey: async () => null,
      getPublicCoverKey: async () => null,
      getPublicEpisode: async () => null,
      getById: async () => null,
      updatePublished: async () => {},
      listPublished: async () => [],
      listBySubmission: async () => [],
      listByGuest: async () => [],
      getEpisodeUserId: async () => null,
      getVoiceSample: async () => null,
      getVoiceSampleByLanguage: async () => null,
      getVoiceSampleKey: async () => null,
      saveVoiceSample: async () => ({ id: "" }),
      getProfile: async () => null,
      updateUserNickname: async () => {},
      updateChannel: async () => ({ ok: true } as const),
      syncAdminRoles: async () => 0,
      listByUser: async () => [],
      setPublic: async () => 0,
      recordStat: async () => {},
      getStats: async () => ({ plays: 0, completions: 0, likes: 0, favorites: 0 }),
      listRecommended: async () => [],
      listTopHosts: async () => [],
      getSiteStats: async () => ({ hostCount: 0, guestCount: 0, episodeCount: 0, topHost: null, topHostAvatar: null, topTags: [] }),
      getPersonaSnapshot: async () => ({ displayName: "测试员", gender: null, profession: null, age: null, bio: null, nationality: null }),
    },
  };
}

function fakeVoice(): AppDeps["voice"] {
  return {
    saveVoiceSample: async () => ({ id: "" }),
    storage: { put: async () => {}, get: async () => ({ data: new Uint8Array(), total: 0 }), delete: async () => {} },
  };
}

describe.skipIf(!hasDb)("auth (better-auth, real local PG)", () => {
  let dbClient: ReturnType<typeof createDb>;
  let app: ReturnType<typeof createApp>;

  const email = () => `auth-${randomUUID().slice(0, 8)}@test.local`;

  beforeAll(async () => {
    dbClient = createDb({ DATABASE_URL: process.env.DATABASE_URL! } as never);

    const testEnv = {
      DATABASE_URL: process.env.DATABASE_URL!,
      BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: "http://localhost:8787",
      PORT: 8787,
      FISH_API_KEY: "",
      STORAGE_DRIVER: "fs" as const,
      STORAGE_DIR: "./data",
      APP_ORIGINS: "",
      RESEND_API_KEY: "",
      EMAIL_FROM: "dailog <no-reply@dailog.fm>",
      ADMIN_EMAILS: "",
    SITE_BASE_URL: "https://dailog.fm",

    };

    const auth = createAuth({ db: dbClient.db, secret: "test-secret", env: testEnv });
    app = createApp({
      env: testEnv,
      auth,
      repo: fakeRepo(),
      voice: fakeVoice(),
      editor: {
        repo: fakeRepo(),
        env: testEnv,
        storage: { put: async () => {}, get: async () => ({ data: new Uint8Array(), total: 0 }), delete: async () => {} },
        siteBaseUrl: null,
      },
      tts: {
        repo: fakeRepo(),
        storage: { get: async () => ({ data: new Uint8Array(), total: 0 }), put: async () => {}, delete: async () => {} },
        ffmpegPath: "/fake/ffmpeg",
        fish: null,
      },
      favorites: {
        getPublishableEpisode: async () => null,
        toggleFavorite: async () => ({ favorited: true, favorites: 0 }),
        toggleLike: async () => ({ liked: true, likes: 0 }),
        listFavorites: async () => [],
      getInteractions: async () => ({ liked: false, favorited: false }),
      },
    });
  });

  afterAll(async () => {
    if (dbClient) {
      await dbClient.db
        .delete(schema.authUsers)
        .where(like(schema.authUsers.email, "auth-%@test.local"));
      await dbClient.client.end().catch(() => {});
    }
  });

  it("signs up → token + profile row（注册开放，频道自动开通）", async () => {
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
    // 频道自动开通（邀请码机制移除）：channelActive 恒 true（列仍为 null，仅展示用）
    expect(profiles[0]?.channelActivatedAt).toBeNull();

    // 带 token 访问受保护接口
    const me = await app.request("/v1/me", {
      headers: { Authorization: `Bearer ${json.token}` },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { userId: string; channelActive: boolean };
    expect(meBody.userId).toBe(json.user!.id);
    expect(meBody.channelActive).toBe(true);
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
