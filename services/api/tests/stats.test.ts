import { describe, expect, it, vi } from "vitest";
import { createApp, type AppDeps } from "../src/app";
import type { Env } from "../src/config/env";

// 播放/完播统计端点（公开免鉴权）：上报 +1（session 去重在前端）/ 读取计数

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
    guests: {
      getByPlatform: async () => null,
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
      getPublicAudioKey: async () => ({ audioKey: "episodes/u/1.mp3", version: "v" }),
      getPublicCoverKey: async () => null,
      getById: async () => null,
      updatePublished: async () => {},
      listPublished: async () => [],
      listBySubmission: async () => [],
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
      getStats: async () => ({ plays: 0, completions: 0, likes: 0, favorites: 0 }),
      listRecommended: async () => [],
      listTopHosts: async () => [],
      getSiteStats: async () => ({ hostCount: 0, guestCount: 0, episodeCount: 0, topHost: null, topHostAvatar: null, topTags: [] }),
      ...overrides,
    },
  };
  return createApp({
    env: makeEnv(),
    auth: {
      handler: async () => new Response("", { status: 401 }),
      api: { getSession: async () => null },
    },
    repo: repo as unknown as AppDeps["repo"],
    voice: { saveVoiceSample: async () => ({ id: "" }), storage: { get: async () => ({ data: new Uint8Array(), total: 0 }), put: async () => {}, delete: async () => {} } },
    favorites: {
      toggleFavorite: async () => ({ favorited: false }),
      toggleLike: async () => ({ liked: false }),
      listFavorites: async () => [],
    } as never,
    editor: {} as never,
    tts: { fish: null, repo: repo as never, storage: { get: async () => ({ data: new Uint8Array(), total: 0 }), put: async () => {}, delete: async () => {} }, ffmpegPath: "" },
  });
}

describe("POST /v1/public/episodes/:id/stats/:type（免鉴权上报 + 限频）", () => {
  it("play → 200 且 recordStat(play) 被调用", async () => {
    const recordStat = vi.fn(async () => {});
    const app = makeApp({ recordStat });
    const res = await app.request("/v1/public/episodes/ep-1/stats/play", { method: "POST" });
    expect(res.status).toBe(200);
    expect(recordStat).toHaveBeenCalledWith("ep-1", "play");
  });

  it("completion → 200；非法 type → 400", async () => {
    const recordStat = vi.fn(async () => {});
    const app = makeApp({ recordStat });
    const ok = await app.request("/v1/public/episodes/ep-2/stats/completion", { method: "POST" });
    expect(ok.status).toBe(200);
    const bad = await app.request("/v1/public/episodes/ep-2/stats/rewind", { method: "POST" });
    expect(bad.status).toBe(400);
  });

  it("限频：同 IP 同 episode 同事件 5 分钟内第二次 → 200 但不计数", async () => {
    const recordStat = vi.fn(async () => {});
    const app = makeApp({ recordStat });
    await app.request("/v1/public/episodes/ep-3/stats/play", { method: "POST" });
    const again = await app.request("/v1/public/episodes/ep-3/stats/play", { method: "POST" });
    expect(again.status).toBe(200); // 静默忽略（不暴露限频）
    expect(recordStat).toHaveBeenCalledTimes(1);
  });

  it("限频按事件独立：play 不影响同 episode 的 completion", async () => {
    const recordStat = vi.fn(async () => {});
    const app = makeApp({ recordStat });
    await app.request("/v1/public/episodes/ep-4/stats/play", { method: "POST" });
    const completion = await app.request("/v1/public/episodes/ep-4/stats/completion", { method: "POST" });
    expect(completion.status).toBe(200);
    expect(recordStat).toHaveBeenCalledTimes(2);
  });

  it("节目不存在/未公开 → 404（不计数）", async () => {
    const recordStat = vi.fn(async () => {});
    const app = makeApp({ getPublicAudioKey: async () => null, recordStat });
    const res = await app.request("/v1/public/episodes/missing/stats/play", { method: "POST" });
    expect(res.status).toBe(404);
    expect(recordStat).not.toHaveBeenCalled();
  });

  it("GET stats → { plays, completions }", async () => {
    const app = makeApp({ getStats: async () => ({ plays: 42, completions: 7, likes: 3, favorites: 4 }) });
    const res = await app.request("/v1/public/episodes/ep-5/stats");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plays: 42, completions: 7, likes: 3, favorites: 4 });
  });
});

describe("GET /v1/public/episodes/recommended（推荐队列）", () => {
  it("返回推荐列表；lang/limit/exclude 透传", async () => {
    const listRecommended = vi.fn(async () => []);
    const app = makeApp({ listRecommended });
    const res = await app.request("/v1/public/episodes/recommended?lang=zh&limit=5&exclude=ep-1,ep-2");
    expect(res.status).toBe(200);
    expect(listRecommended).toHaveBeenCalledWith({ lang: "zh", limit: 5, exclude: ["ep-1", "ep-2"] });
  });

  it("非法 lang 忽略；limit 上限 50", async () => {
    const listRecommended = vi.fn(async () => []);
    const app = makeApp({ listRecommended });
    await app.request("/v1/public/episodes/recommended?lang=toolong&limit=9999");
    expect(listRecommended).toHaveBeenCalledWith({ lang: undefined, limit: 50, exclude: undefined });
  });
});

describe("公开端点：热门主播 / 常驻嘉宾", () => {
  it("GET /v1/public/hosts → 主播列表（limit 透传）", async () => {
    const listTopHosts = vi.fn(async () => [{ username: "fei", displayName: "飞", avatar: null, episodeCount: 3, totalPlays: 99 }]);
    const app = makeApp({ listTopHosts });
    const res = await app.request("/v1/public/hosts?limit=5");
    expect(res.status).toBe(200);
    expect(listTopHosts).toHaveBeenCalledWith(5);
    expect(await res.json()).toHaveLength(1);
  });

  it("GET /v1/public/guests → 嘉宾列表", async () => {
    const app = makeApp();
    // guests fake list 返回 []；覆盖返回
    const repo = (app as never) as { request: never };
    const res = await app.request("/v1/public/guests");
    expect(res.status).toBe(200);
  });
});
