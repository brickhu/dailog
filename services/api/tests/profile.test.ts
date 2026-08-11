import { describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "../src/app";
import type { Env } from "../src/config/env";
import type { Repos } from "../src/repo";

// /api/me/profile、/api/me/channel 端点测试：fake repo 注入行为，覆盖校验/冲突/成功分支

function fakeRepo(overrides: Partial<AppDeps["repo"]["episodes"]> = {}): Repos {
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
      getPublicCoverKey: async () => null,
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
      getProfile: async () => ({
        email: "tester@test.dev",
        nickname: "测试员",
        emailVerified: true,
        image: null,
        hasGithub: false,
        username: "u_abc123",
        displayName: "测试员",
        bio: null,
        persona: null,
        channelActivatedAt: new Date(),
      }),
      updateUserNickname: async () => {},
      updatePersona: async () => {},
      updateChannel: async () => ({ ok: true }),
      isUsernameTaken: async () => false,
      syncAdminRoles: async () => 0,
      ...overrides,
    },
    jobs: {
      getQuotaInfo: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
      consumeQuota: async () => {},
      createJob: async (episodeId: string) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
      getLatestJob: async () => null,
      getOwnedEpisode: async () => null,
      listRecoverableJobs: async () => [],
      markJobProgress: async () => {},
      markJobDone: async () => {},

      markJobFailed: async () => {},
    },
  };
}

function makeApp(episodesOverrides: Partial<AppDeps["repo"]["episodes"]> = {}) {
  const env: Env = {
    DATABASE_URL: "postgres://localhost:5432/dailog",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost:8787",
    SITE_BASE_URL: "https://site.dailog.fm",
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
    RESEND_API_KEY: "",
    EMAIL_FROM: "dailog <no-reply@dailog.fm>",
    ADMIN_EMAILS: "",
    PEXELS_API_KEY: "",
  };
  const repo = fakeRepo(episodesOverrides);
  return createApp({
    env,
    auth: { handler: async () => new Response("", { status: 404 }), api: { getSession: async () => ({ user: { id: "user-1" } }) } },
    repo,
    importDeps: {
      getSnapshotByUrl: async () => null,
      createSnapshot: async () => ({ id: "snap-1" }),
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
    },
    job: { getOwnedEpisode: async () => null, getLatestJob: async () => null },
    voice: {
      saveVoiceSample: async () => {},
      storage: { put: async () => {}, get: async () => new Uint8Array(), delete: async () => {} },
    },
    channel: { activateChannel: async () => ({ ok: true }) },
    favorites: {
      getPublishableEpisode: async () => null,
      toggleFavorite: async () => ({ favorited: true }),
      toggleLike: async () => ({ liked: true }),
      listFavorites: async () => [],
    },
    admin: { isAdmin: async () => false, createInviteCode: async () => ({ ok: true, code: "fake", expiresAt: null }), storage: { put: async () => {} }, upsertGuestVoiceSample: async () => {}, listGuestVoiceSamples: async () => [], listGuests: async () => [] },
    shareCollectUrl: () => null,
    polishesDeps: {
      getChannelActivatedAt: async () => new Date(),

      findPolishByUserSnapshot: async () => null,
      createPolish: async () => ({ id: "polish-1" }),
      getPolishDetail: async () => null,
      listByUser: async () => [],
    },
    transcriptsDeps: {
      getDialogueForPolish: async () => null,
      getTranscriptCount: async () => 0,
      getPolishLimit: async () => 5,
      createTranscript: async () => ({ id: "transcript-1" }),
      getOwnedTranscript: async () => null,
      guestsByPlatform: {},
      updateTranscriptSegments: async () => {},
      llm: { complete: async () => "", stream: async () => "" },
    },
    episodesDeps: {
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
    },
  });
}

const patch = (path: string, body: unknown) =>
  (app: ReturnType<typeof makeApp>) =>
    app.request(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

describe("/v1/me/profile", () => {
  it("GET 返回账号 + 频道档案", async () => {
    const res = await makeApp().request("/v1/me/profile");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.email).toBe("tester@test.dev");
    expect(body.username).toBe("u_abc123");
    expect(body.hasGithub).toBe(false);
  });

  it("PATCH 昵称：合法 → 200；空 → 400；超 30 字 → 400", async () => {
    const app = makeApp();
    const ok = await patch("/v1/me/profile", { nickname: "新昵称" })(app);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { nickname: string }).nickname).toBe("新昵称");

    const empty = await patch("/v1/me/profile", { nickname: "   " })(app);
    expect(empty.status).toBe(400);

    const long = await patch("/v1/me/profile", { nickname: "很".repeat(31) })(app);
    expect(long.status).toBe(400);
  });
});

describe("/v1/me/channel/check", () => {
  it("slug 可用 → available: true；被占用 → false", async () => {
    const app = makeApp({ isUsernameTaken: async (_uid, username) => username === "taken-name" });
    const free = await app.request("/v1/me/channel/check?username=my-channel");
    expect(free.status).toBe(200);
    expect(((await free.json()) as { available: boolean }).available).toBe(true);

    const busy = await app.request("/v1/me/channel/check?username=taken-name");
    expect(busy.status).toBe(200);
    expect(((await busy.json()) as { available: boolean }).available).toBe(false);
  });

  it("非法格式 → 400（特殊字符/过短/中文）", async () => {
    const app = makeApp();
    for (const username of ["U_PPER", "ab", "中文"]) {
      const res = await app.request(`/v1/me/channel/check?username=${encodeURIComponent(username)}`);
      expect(res.status, `slug=${username}`).toBe(400);
    }
  });
});

describe("/v1/me/channel", () => {
  it("slug 合法（自动小写化）→ 200", async () => {
    const app = makeApp();
    const res = await patch("/v1/me/channel", { username: "My-Channel" })(app);
    expect(res.status).toBe(200);
  });

  it("slug 非法格式 → 400（特殊字符/中文/过短）", async () => {
    const app = makeApp();
    for (const username of ["U_PPER", "a b", "中文", "a!", "ab"]) {
      const res = await patch("/v1/me/channel", { username })(app);
      expect(res.status, `slug=${username}`).toBe(400);
    }
  });

  it("slug 被占用 → 409", async () => {
    const app = makeApp({
      updateChannel: async () => ({ error: "username_taken" as const }),
    });
    const res = await patch("/v1/me/channel", { username: "taken-name" })(app);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("username_taken");
  });

  it("频道名超 30 字 / bio 超 200 字 → 400", async () => {
    const app = makeApp();
    const name = await patch("/v1/me/channel", { displayName: "名".repeat(31) })(app);
    expect(name.status).toBe(400);
    const bio = await patch("/v1/me/channel", { bio: "介".repeat(201) })(app);
    expect(bio.status).toBe(400);
  });

  it("空 body → 400", async () => {
    const app = makeApp();
    const res = await patch("/v1/me/channel", {})(app);
    expect(res.status).toBe(400);
  });
});
