import { describe, expect, it, vi } from "vitest";
import { createApp, type AppDeps } from "../src/app";
import type { Env } from "../src/config/env";

// 播放/完播统计端点（公开免鉴权，0036 恢复）：上报 +1（session 去重在前端）/ 读取计数。
// 使用合法 uuid 作为节目 id（app.ts 的 UUID_RE 校验，非 uuid 直接 404）。

function makeEnv(): Env {
  return {
    DATABASE_URL: "postgres://localhost:5432/dailog",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost:8787",
    SITE_BASE_URL: "https://dailog.fm",
    PORT: 8787,
    FISH_API_KEY: "",
    STORAGE_DRIVER: "fs",
    APP_ORIGINS: "https://dailog.fm",
    ADMIN_EMAILS: "",
  } as Env;
}

const EP1 = "11111111-1111-4111-8111-111111111111";
const EP2 = "22222222-2222-4222-8222-222222222222";
const EP3 = "33333333-3333-4333-8333-333333333333";
const EP4 = "44444444-4444-4444-8444-444444444444";

function makeApp(overrides: Partial<AppDeps["repo"]["episodes"]> = {}) {
  const repo = {
    notifications: {
      create: async () => {},
      listByUser: async () => [],
      unreadCount: async () => 0,
      markAllRead: async () => {},
      getEmailByUserId: async () => null,
      existsAfter: async () => false,
      existsByLink: async () => false,
    },
    playlists: {
      create: async () => ({ id: "pl-1", slug: "abc12345" }),
      listPublic: async () => [],
      listEditor: async () => [],
      getPublicBySlug: async () => null,
      getById: async () => null,
      listFavorites: async () => [],
      isFavorite: async () => false,
      addFavorite: async () => ({ added: true }),
      removeFavorite: async () => {},
      update: async () => {},
      getPublicCover: async () => null,
      getOrCreateDefault: async () => ({ id: "pl-default" }),
      remove: async () => {},
      listEpisodes: async () => [],
      addEpisode: async () => ({ added: true }),
      removeEpisode: async () => {},
      reorder: async () => {},
      listByEpisode: async () => [],
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
      getPublicAudioKey: async () => ({ audioKey: "episodes/u/1.mp3", version: "v" }),
      getPublicCoverKey: async () => null,
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
      getPersonaSnapshot: async () => null,
      updateUserNickname: async () => {},
      updateChannel: async () => ({ ok: true as const }),
      syncAdminRoles: async () => 0,
      recordStat: async () => {},
      getStats: async () => ({ plays: 0, completions: 0, likes: 0 }),
      listRecommended: async () => [],
      listTopHosts: async () => [],
      getSiteStats: async () => ({ hostCount: 0, guestCount: 0, episodeCount: 0, topHost: null, topHostAvatar: null, topTags: [] }),
      ...overrides,
    },
  } as AppDeps["repo"];

  const app = createApp({
    env: makeEnv(),
    auth: { handler: async () => new Response(), api: { getSession: async () => null } },
    repo,
    voice: { saveVoiceSample: async () => ({ id: "" }), storage: { put: async () => {}, get: async () => ({ data: new Uint8Array(), total: 0 }), delete: async () => {} } },
    editor: { repo, env: makeEnv(), storage: { put: async () => {}, get: async () => ({ data: new Uint8Array(), total: 0 }), delete: async () => {} }, siteBaseUrl: null },
    tts: { repo, storage: { get: async () => ({ data: new Uint8Array(), total: 0 }), put: async () => {}, delete: async () => {} }, ffmpegPath: "/fake/ffmpeg", fish: null },
    favorites: {
      getPublishableEpisode: async () => null,
      toggleLike: async () => ({ liked: true, likes: 1 }),
      getInteractions: async () => ({ liked: false, likes: 0 }),
    },
    authExt: undefined,
    deviceStore: undefined,
  } as unknown as AppDeps);
  return app;
}

describe("POST /v1/public/episodes/:id/stats/:type（免鉴权上报 + 限频）", () => {
  it("play → 200 且 recordStat(play) 被调用", async () => {
    const recordStat = vi.fn(async () => {});
    const app = makeApp({ recordStat });
    const res = await app.request(`/v1/public/episodes/${EP1}/stats/play`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(recordStat).toHaveBeenCalledWith(EP1, "play");
  });

  it("completion → 200；非法 type → 400", async () => {
    const recordStat = vi.fn(async () => {});
    const app = makeApp({ recordStat });
    const ok = await app.request(`/v1/public/episodes/${EP2}/stats/completion`, { method: "POST" });
    expect(ok.status).toBe(200);
    expect(recordStat).toHaveBeenCalledWith(EP2, "completion");
    const bad = await app.request(`/v1/public/episodes/${EP2}/stats/like`, { method: "POST" });
    expect(bad.status).toBe(400);
  });

  it("限频：同 IP 同 episode 同事件 5 分钟内第二次 → 200 但不计数", async () => {
    const recordStat = vi.fn(async () => {});
    const app = makeApp({ recordStat });
    await app.request(`/v1/public/episodes/${EP3}/stats/play`, { method: "POST" });
    const again = await app.request(`/v1/public/episodes/${EP3}/stats/play`, { method: "POST" });
    expect(again.status).toBe(200); // 静默忽略（不暴露限频）
    expect(recordStat).toHaveBeenCalledTimes(1);
  });

  it("限频按事件独立：play 不影响同 episode 的 completion", async () => {
    const recordStat = vi.fn(async () => {});
    const app = makeApp({ recordStat });
    await app.request(`/v1/public/episodes/${EP4}/stats/play`, { method: "POST" });
    const completion = await app.request(`/v1/public/episodes/${EP4}/stats/completion`, { method: "POST" });
    expect(completion.status).toBe(200);
    expect(recordStat).toHaveBeenCalledTimes(2);
  });

  it("节目不存在/未公开 → 404（不计数）", async () => {
    const app = makeApp({ getPublicAudioKey: async () => null });
    const res = await app.request(`/v1/public/episodes/${EP1}/stats/play`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("GET stats → { plays, completions, likes }", async () => {
    const getStats = vi.fn(async () => ({ plays: 10, completions: 4, likes: 3 }));
    const app = makeApp({ getStats });
    const res = await app.request(`/v1/public/episodes/${EP1}/stats`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plays: 10, completions: 4, likes: 3 });
    expect(getStats).toHaveBeenCalledWith(EP1);
  });

  it("非法 uuid → 404（避免 22P02）", async () => {
    const app = makeApp();
    const res = await app.request("/v1/public/episodes/not-a-uuid/stats/play", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/public/episodes/recommended（推荐队列）", () => {
  it("返回推荐列表；lang/limit/exclude 透传", async () => {
    const listRecommended = vi.fn(async () => []);
    const app = makeApp({ listRecommended });
    const res = await app.request("/v1/public/episodes/recommended?lang=zh&limit=5&exclude=a,b");
    expect(res.status).toBe(200);
    expect(listRecommended).toHaveBeenCalledWith({ lang: "zh", limit: 5, exclude: ["a", "b"] });
  });

  it("非法 lang → 400（zod enum 校验）；limit 上限 50", async () => {
    const listRecommended = vi.fn(async () => []);
    const app = makeApp({ listRecommended });
    const bad = await app.request("/v1/public/episodes/recommended?lang=123");
    expect(bad.status).toBe(400);
    const ok = await app.request("/v1/public/episodes/recommended?limit=999");
    expect(ok.status).toBe(200);
    expect(listRecommended).toHaveBeenCalledWith({ lang: undefined, limit: 50, exclude: undefined });
  });
});