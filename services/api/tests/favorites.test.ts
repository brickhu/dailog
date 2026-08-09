import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { createApp, type AppDeps } from "../src/app";
import { createAuth } from "../src/auth/better-auth";
import { createDb } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createActivateChannel } from "../src/routes/channel";
import { createFavoritesRepo } from "../src/routes/favorites";

// 消费端互动全链路（真实本地 PG）：注册 → 收藏/点赞 toggle → 列表
let testPolishId = "";
let testTranscriptId = "";

const hasDb = Boolean(process.env.DATABASE_URL);



function fakeImportDeps(): AppDeps["importDeps"] {
  return {
    getSnapshotByUrl: async () => null,
    createSnapshot: async (row) => ({ id: "snap-1", platform: row.platform, sourceTitle: row.sourceTitle, sourceConversationId: row.sourceConversationId, parsedDialogue: row.parsedDialogue, quality: null, status: "ok", retryAfter: null, lastError: null }),
    updateSnapshotContent: async () => {},
    markSnapshotUnreachable: async () => {},
    markSnapshotParseFailed: async () => {},
    findPolishByUserSnapshot: async () => null,
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
    createEpisode: async () => ({ id: "ep-1" }),
    safetyCheck: async () => ({ pass: true }),
    getChannelActive: async () => true,
    getQuota: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
    consumeQuota: async () => {},
    createJob: async (episodeId: string) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
    enqueueJob: async () => {},
    setPublished: async () => {},
    getChannelActivatedAt: async () => new Date(),
    getHostModelId: async () => null,
    getVoiceSampleKey: async () => null,
    getVoiceSample: async () => null,
    saveVoiceSample: async () => {},
  };
}

function fakeRepo(): AppDeps["repo"] {
  return {
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
      getOwned: async () => null,
      getPolishDetail: async () => null,
      listByUser: async () => [],
    },
    transcripts: {
      create: async () => ({ id: "transcript-1" }),
      listByPolish: async () => [],
      getOwned: async () => null,
      updateSegments: async () => {},
    },
    episodes: {
      create: async () => ({ id: "ep-1" }),
      listByUser: async () => [],
      getOwned: async () => null,
      getEpisodeAudio: async () => null,
      getEpisodeScript: async () => null,
      getPublishedDialogue: async () => null,
      setPublished: async () => {},
      getEpisodeUserId: async () => null,
      getEpisodeLanguage: async () => null,
      getHostModelId: async () => null,
      getVoiceSampleKey: async () => null,
      getVoiceSample: async () => null,
      saveVoiceSample: async () => {},
      getChannelActivatedAt: async () => new Date(),
      getProfile: async () => null,
      updateUserNickname: async () => {},
      updateChannel: async () => ({ ok: true } as const),
      isUsernameTaken: async () => false,
    },
    jobs: {
      getQuotaInfo: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
      consumeQuota: async () => {},
      createJob: async () => ({ id: "job-1", episodeId: "ep-1", status: "queued", progress: 0 }),
      getLatestJob: async () => null,
      getOwnedEpisode: async () => null,
      listRecoverableJobs: async () => [],
      markJobProgress: async () => {},
      markJobDone: async () => {},
      updateEpisodeAudio: async () => {},
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

describe.skipIf(!hasDb)("favorites/likes (消费端互动, real local PG)", () => {
  let dbClient: ReturnType<typeof createDb>;
  let app: ReturnType<typeof createApp>;
  let token: string;
  let userId: string;
  let episodeId: string;

  beforeAll(async () => {
    dbClient = createDb({ DATABASE_URL: process.env.DATABASE_URL! } as never);
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
    SITE_BASE_URL: "https://site.dailog.fm",

    };

    const auth = createAuth({ db: dbClient.db, secret: "test-secret", env: testEnv });

    // 一个已发布 episode（互动对象）+ 一个用户
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
    userId = user[0].id;
    await dbClient.db.insert(schema.profiles).values({
      id: userId, username: `fav-${randomUUID().slice(0, 6)}`, displayName: "Fav",
    });
    const snap = await dbClient.db.insert(schema.snapshots).values({ url: `https://example.com/share/${randomUUID()}`, platform: "claude", parsedDialogue: [] }).returning({ id: schema.snapshots.id });
    const polish = await dbClient.db.insert(schema.polishes).values({ userId, snapshotId: snap[0].id }).returning({ id: schema.polishes.id });
    const transcript = await dbClient.db.insert(schema.transcripts).values({ polishId: polish[0].id, segments: [] }).returning({ id: schema.transcripts.id });
    testPolishId = polish[0].id;
    testTranscriptId = transcript[0].id;
    const ep = await dbClient.db
      .insert(schema.episodes)
      .values({
        userId,
        transcriptId: transcript[0].id,
        polishId: polish[0].id,
        slug: `fav-ep-${randomUUID().slice(0, 8)}`,
        title: "收藏测试节目",
        audioUrl: "audio/episodes/x.mp3",
        durationSeconds: 120,
        status: "published",
        isPublic: true,
        publishedAt: new Date(),
      })
      .returning({ id: schema.episodes.id });
    episodeId = ep[0].id;

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
      favorites: createFavoritesRepo(dbClient.db),
      admin: {
        isAdmin: async () => false,
        createInviteCode: async () => ({ ok: true, code: "fake", expiresAt: null }),
      },
    });

    // 注册真实用户拿 token
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `fav-live-${randomUUID().slice(0, 8)}@test.local`, password: "password123", name: "Live" }),
    });
    const body = (await res.json()) as { token: string; user: { id: string } };
    token = body.token;
    userId = body.user.id;
  });

  afterAll(async () => {
    if (dbClient) {
      await dbClient.db.delete(schema.authUsers).where(like(schema.authUsers.email, "fav-%@test.local"));
      await dbClient.db.delete(schema.episodes).where(eq(schema.episodes.id, episodeId));
      await dbClient.client.end().catch(() => {});
    }
  });

  it("favorite toggle: POST → 列表可见 → DELETE 取消", async () => {
    const h = { Authorization: `Bearer ${token}` };
    const add = await app.request(`/api/episodes/${episodeId}/favorite`, { method: "POST", headers: h });
    expect(add.status).toBe(200);
    expect(await add.json()).toEqual({ favorited: true });

    const list = await app.request("/api/me/favorites", { headers: h });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as Array<{ episodeId: string; title: string | null }>;
    expect(rows.some((r) => r.episodeId === episodeId && r.title === "收藏测试节目")).toBe(true);

    const del = await app.request(`/api/episodes/${episodeId}/favorite`, { method: "DELETE", headers: h });
    expect(await del.json()).toEqual({ favorited: false });
  });

  it("like toggle: POST liked → DELETE unliked", async () => {
    const h = { Authorization: `Bearer ${token}` };
    const add = await app.request(`/api/episodes/${episodeId}/like`, { method: "POST", headers: h });
    expect(await add.json()).toEqual({ liked: true });
    const del = await app.request(`/api/episodes/${episodeId}/like`, { method: "DELETE", headers: h });
    expect(await del.json()).toEqual({ liked: false });
  });

  it("draft episode not interactable (404)", async () => {
    const draft = await dbClient.db
      .insert(schema.episodes)
      .values({ userId, transcriptId: testTranscriptId, polishId: testPolishId, slug: `fav-draft-${randomUUID().slice(0, 8)}`, title: "draft", status: "generating" })
      .returning({ id: schema.episodes.id });
    const res = await app.request(`/api/episodes/${draft[0].id}/favorite`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    await dbClient.db.delete(schema.episodes).where(eq(schema.episodes.id, draft[0].id));
  });

  it("unauthenticated → 401", async () => {
    const res = await app.request(`/api/episodes/${episodeId}/like`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});
