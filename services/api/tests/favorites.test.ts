import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { createApp, type AppDeps } from "../src/app";
import { createAuth } from "../src/auth/better-auth";
import { createDb } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createFavoritesRepo } from "../src/routes/favorites";
import { fakePlaylistsRepo } from "./helpers/fake-playlists";

// 消费端互动（简化版 0034）：仅点赞 toggle + interactions（收藏与播放统计已移除）。
// 真实本地 PG 集成：注册 → 点赞 toggle → interactions 计数。

const hasDb = Boolean(process.env.DATABASE_URL);

function fakeRepo(): AppDeps["repo"] {
  return {
    playlists: fakePlaylistsRepo(),
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
      voiceSampleAny: async () => null, anyVoiceSampleByLanguage: async () => null,
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
      markPublished: async () => {}, setCallName: async () => ({ id: "sub-1" }),
    },
    episodes: {
      createPublished: async () => ({ id: "ep-1", number: 1, slug: "abc12345" }),
      getPublicAudioKey: async () => null,
      getPublicCoverKey: async () => null,
      getPublicEpisode: async () => null,
      getById: async () => null,
      updatePublished: async () => {},
      updateEpisodeContent: async () => {},
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
      getRemovalTarget: async () => null,
      createRemovalRequest: async () => ({ id: "rr-1" }),
      listRemovalRequests: async () => [],
      resolveRemovalRequest: async () => null,
      listRecommended: async () => [],
      listTopHosts: async () => [],
      getSiteStats: async () => ({ hostCount: 0, guestCount: 0, episodeCount: 0, topHost: null, topHostAvatar: null, topTags: [] }),
      recordStat: async () => {},
      getStats: async () => ({ plays: 0, completions: 0, likes: 0 }),
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

describe.skipIf(!hasDb)("likes (消费端互动简化版, real local PG)", () => {
  let dbClient: ReturnType<typeof createDb>;
  let app: ReturnType<typeof createApp>;
  let token: string;
  let episodeId: string;

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

    // 一个已发布 episode（互动对象）
    const user = await dbClient.db
      .insert(schema.authUsers)
      .values({
        id: `fav-user-${randomUUID()}`,
        name: "Fav User",
        email: `fav-${randomUUID().slice(0, 8)}@test.local`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: schema.authUsers.id });
    const ownerId = user[0].id;
    await dbClient.db.insert(schema.profiles).values({
      id: ownerId, displayName: "Fav",
    });
    const sub = await dbClient.db.insert(schema.submissions).values({
      userId: ownerId,
      url: `https://example.com/share/${randomUUID()}`,
      status: "published",
    }).returning({ id: schema.submissions.id });
    const ep = await dbClient.db
      .insert(schema.episodes)
      .values({
        submissionId: sub[0].id,
        userId: ownerId,
        slug: `fav-ep-${randomUUID().slice(0, 8)}`,
        title: "点赞测试节目",
        audioUrl: `episodes/${ownerId}/${sub[0].id}.mp3`,
        status: "published",
        isPublic: true,
        publishedAt: new Date(),
      })
      .returning({ id: schema.episodes.id });
    episodeId = ep[0].id;

    const repo = fakeRepo();
    app = createApp({
      env: testEnv,
      auth,
      repo,
      voice: fakeVoice(),
      editor: {
        repo,
        env: testEnv,
        storage: { put: async () => {}, get: async () => ({ data: new Uint8Array(), total: 0 }), delete: async () => {} },
        siteBaseUrl: null,
      },
      tts: {
        repo,
        storage: { get: async () => ({ data: new Uint8Array(), total: 0 }), put: async () => {}, delete: async () => {} },
        ffmpegPath: "/fake/ffmpeg",
        fish: null,
      },
      favorites: createFavoritesRepo(dbClient.db),
    });

    // 注册真实用户拿 token
    const res = await app.request("/v1/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `fav-live-${randomUUID().slice(0, 8)}@test.local`, password: "password123", name: "Live" }),
    });
    const body = (await res.json()) as { token: string; user: { id: string } };
    token = body.token;
  });

  afterAll(async () => {
    if (dbClient) {
      await dbClient.db.delete(schema.authUsers).where(like(schema.authUsers.email, "fav-%@test.local"));
      await dbClient.db.delete(schema.episodes).where(eq(schema.episodes.id, episodeId));
      await dbClient.client.end().catch(() => {});
    }
  });

  it("like toggle: POST liked+1 → DELETE unliked+0", async () => {
    const h = { Authorization: `Bearer ${token}` };
    const add = await app.request(`/v1/episodes/${episodeId}/like`, { method: "POST", headers: h });
    expect(add.status).toBe(200);
    expect(await add.json()).toEqual({ liked: true, likes: 1 });
    const del = await app.request(`/v1/episodes/${episodeId}/like`, { method: "DELETE", headers: h });
    expect(await del.json()).toEqual({ liked: false, likes: 0 });
  });

  it("interactions: 点赞后返回状态 + 计数（无独立统计端点，合并返回）", async () => {
    const h = { Authorization: `Bearer ${token}` };
    await app.request(`/v1/episodes/${episodeId}/like`, { method: "POST", headers: h });
    const res = await app.request(`/v1/episodes/${episodeId}/interactions`, { headers: h });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ liked: true, likes: 1 });
    // 清理
    await app.request(`/v1/episodes/${episodeId}/like`, { method: "DELETE", headers: h });
  });

  it("unpublished episode not interactable (404)", async () => {
    const liveUser = await dbClient.db
      .select({ id: schema.authUsers.id })
      .from(schema.authUsers)
      .where(like(schema.authUsers.email, "fav-live-%"))
      .limit(1);
    const userId = liveUser[0]?.id ?? "none";
    const draftSub = await dbClient.db.insert(schema.submissions).values({
      userId,
      url: `https://example.com/share/${randomUUID()}`,
      status: "submitted",
    }).returning({ id: schema.submissions.id });
    const draft = await dbClient.db
      .insert(schema.episodes)
      .values({ submissionId: draftSub[0].id, userId, slug: `fav-draft-${randomUUID().slice(0, 8)}`, title: "draft", audioUrl: "x.mp3", status: "generating" as never })
      .returning({ id: schema.episodes.id });
    const res = await app.request(`/v1/episodes/${draft[0].id}/like`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    await dbClient.db.delete(schema.episodes).where(eq(schema.episodes.id, draft[0].id));
  });
});
