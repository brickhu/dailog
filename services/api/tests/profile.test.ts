import { describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "../src/app";
import type { Env } from "../src/config/env";
import type { Repos } from "../src/repo";
import { fakePlaylistsRepo } from "./helpers/fake-playlists";

// /api/me/profile、/api/me/channel 端点测试：fake repo 注入行为，覆盖校验/冲突/成功分支

function fakeRepo(overrides: Partial<AppDeps["repo"]["episodes"]> = {}): Repos {
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
      getProfile: async () => ({
        email: "tester@test.dev",
        nickname: "测试员",
        emailVerified: true,
        image: null,
        displayName: "测试员",
        bio: null,
        gender: null,
        profession: null,
        age: null,
        nationality: null,
        socialLinks: null,
        channelActivatedAt: new Date(),
      }),
      updateUserNickname: async () => {},
      updateChannel: async () => ({ ok: true }),
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
      ...overrides,
    },
  };
}

function makeApp(episodesOverrides: Partial<AppDeps["repo"]["episodes"]> = {}) {
  const env: Env = {
    DATABASE_URL: "postgres://localhost:5432/dailog",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost:8787",
    SITE_BASE_URL: "https://dailog.fm",
    PORT: 8787,
    FISH_API_KEY: "",
    STORAGE_DRIVER: "fs",
    STORAGE_DIR: "./data",
    APP_ORIGINS: "",
    RESEND_API_KEY: "",
    EMAIL_FROM: "dailog <no-reply@dailog.fm>",
    ADMIN_EMAILS: "",
  };
  const repo = fakeRepo(episodesOverrides);
  return createApp({
    env,
    auth: { handler: async () => new Response("", { status: 404 }), api: { getSession: async () => ({ user: { id: "user-1" } }) } },
    repo,
    voice: {
      saveVoiceSample: async () => ({ id: "" }),
      storage: { put: async () => {}, get: async () => ({ data: new Uint8Array(), total: 0 }), delete: async () => {} },
    },
    favorites: {
      getPublishableEpisode: async () => null,
            toggleLike: async () => ({ liked: true, likes: 0 }),
            getInteractions: async () => ({ liked: false, likes: 0 }),
    },
    editor: {
      repo,
      env,
      storage: { put: async () => {}, get: async () => ({ data: new Uint8Array(), total: 0 }), delete: async () => {} },
      siteBaseUrl: null,
    },
    tts: {
      repo,
      storage: { get: async () => ({ data: new Uint8Array(), total: 0 }), put: async () => {}, delete: async () => {} },
      ffmpegPath: "/fake/ffmpeg",
      fish: null,
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
    expect(body.displayName).toBe("测试员");
  });

  it("PATCH 昵称：合法 → 200；空 → 400；超 30 字 → 400", async () => {
    const app = makeApp();
    const ok = await patch("/v1/me/profile", { nickname: "新昵称" })(app);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });

    const empty = await patch("/v1/me/profile", { nickname: "   " })(app);
    expect(empty.status).toBe(400);

    const long = await patch("/v1/me/profile", { nickname: "很".repeat(31) })(app);
    expect(long.status).toBe(400);
  });
});

describe("/v1/me/profile（主持人档案）", () => {
  it("displayName 合法 → 200", async () => {
    const app = makeApp();
    const res = await patch("/v1/me/profile", { displayName: "飞" })(app);
    expect(res.status).toBe(200);
  });

  it("displayName 空 / 超 30 字 → 400", async () => {
    const app = makeApp();
    const empty = await patch("/v1/me/profile", { displayName: "   " })(app);
    expect(empty.status).toBe(400);
    const long = await patch("/v1/me/profile", { displayName: "名".repeat(31) })(app);
    expect(long.status).toBe(400);
  });

  it("bio 超 200 字 → 400", async () => {
    const app = makeApp();
    const bio = await patch("/v1/me/profile", { bio: "介".repeat(201) })(app);
    expect(bio.status).toBe(400);
  });

  it("画像字段（gender/profession/age/nationality）合法 → 200", async () => {
    const app = makeApp();
    const res = await patch("/v1/me/profile", { gender: "男", profession: "产品经理", age: "28", nationality: "中国" })(app);
    expect(res.status).toBe(200);
  });

  it("socialLinks 合法对象 → 200；非对象 → 400", async () => {
    const app = makeApp();
    const ok = await patch("/v1/me/profile", { socialLinks: { twitter: "https://x.com/fei", github: "fei" } })(app);
    expect(ok.status).toBe(200);
    const bad = await patch("/v1/me/profile", { socialLinks: "not-an-object" })(app);
    expect(bad.status).toBe(400);
  });

  it("空 body → 200（无字段可改，幂等）", async () => {
    const app = makeApp();
    const res = await patch("/v1/me/profile", {})(app);
    expect(res.status).toBe(200);
  });
});
