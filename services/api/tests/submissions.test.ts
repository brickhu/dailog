import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { submissionsRoutes } from "../src/routes/submissions";
import type { Repos } from "../src/repo";

// 投稿端点（本质版）测试：fake repo 注入 + fetch mock（触达性探活）。
// 覆盖：URL 合法性 / 触达性 / 并发上限 / 重复提交 / 成功入库

function makeApp(repo: Partial<Repos["submissions"]> = {}) {
  const app = new Hono<{ Variables: { userId: string } }>();
  app.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  app.route("/", submissionsRoutes({
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
    notifications: {
      create: async () => {},
      listByUser: async () => [],
      unreadCount: async () => 0,
      markAllRead: async () => {},
      getEmailByUserId: async () => null,
      existsAfter: async () => false,
      existsByLink: async () => false,
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
      ...repo,
    },
  } as Repos));
  return app;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /v1/submissions —— URL 合法性与触达性", () => {
  it("rejects missing url with 400", async () => {
    const res = await makeApp().request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "invalid_url" });
  });

  it("rejects non-http(s) URLs（javascript:/ftp:）", async () => {
    const res = await makeApp().request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "javascript:alert(1)" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "invalid_url" });
  });

  it("rejects unreachable URL with 422（网络层失败）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const res = await makeApp().request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/share/abc" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "url_unreachable" });
  });

  it("accepts reachable URL（任意响应码 = 可达，含 403 反爬）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    const res = await makeApp().request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/share/abc" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ submissionId: "sub-1", status: "submitted" });
  });

  it("falls back to GET when HEAD is rejected（405 → GET 成功）", async () => {
    let headTried = false;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (!headTried) {
        headTried = true;
        return new Response(null, { status: 405 });
      }
      return new Response("body", { status: 200 });
    }));
    const res = await makeApp().request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/share/abc" }),
    });
    expect(res.status).toBe(201);
  });
});

describe("POST /v1/submissions —— 并发上限 / 重复 / 入库", () => {
  it("rejects when pending count at limit with 429", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const app = makeApp({ countPendingByUser: async () => 5 });
    const res = await app.request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/share/abc" }),
    });
    expect(res.status).toBe(429);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "pending_limit" });
  });

  it("rejects when user has no ready voice sample with 422（voice_sample_required）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const app = makeApp({ hasReadyVoiceSample: async () => false });
    const res = await app.request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/share/abc" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "voice_sample_required" });
  });

  it("returns existing submission when same user+url already submitted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const app = makeApp({ findByUrl: async () => ({ id: "sub-old", status: "submitted" }) });
    const res = await app.request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/share/abc" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ existing: true, submissionId: "sub-old", status: "submitted", episode: null });
  });

  it("creates submission with url + optional title + callName + suggestion + voiceSampleId（采样校验传参、trim 入库）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const create = vi.fn(async (_id: string, _u: string, _url: string, _t: string | null, _cn?: string | null, _pi?: unknown, _vs?: string | null, _sug?: string | null) => ({ id: _id || "sub-new" }));
    const hasReadyVoiceSample = vi.fn(async () => true);
    const app = makeApp({ create, hasReadyVoiceSample });
    const res = await app.request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/share/abc", title: "我的对话", callNameInEpisode: "飞", suggestion: "  想聊聊 AI 编程的实际用法  ", voiceSampleId: "11111111-1111-4111-8111-111111111111" }),
    });
    expect(res.status).toBe(201);
    // 采样归属校验：传入的 voiceSampleId 必须原样交给校验（防引用他人采样）
    expect(hasReadyVoiceSample).toHaveBeenCalledWith("user-1", "11111111-1111-4111-8111-111111111111");
    expect(create).toHaveBeenCalledWith(
      "user-1", "https://example.com/share/abc", "我的对话", "飞",
      expect.objectContaining({ displayName: "测试员" }), "11111111-1111-4111-8111-111111111111", "想聊聊 AI 编程的实际用法",
    );
  });

  it("does not call create when URL unreachable（探活失败不落库）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const create = vi.fn(async () => ({ id: "sub-x" }));
    await makeApp({ create }).request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/share/abc" }),
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("GET /v1/me/submissions", () => {
  it("returns my submissions list", async () => {
    const listByUser = vi.fn(async () => [
      { id: "sub-1", url: "https://example.com/share/abc", title: null, callName: null, status: "submitted", rejectedReason: null, episodeStatus: null, createdAt: new Date() },
    ]);
    const res = await makeApp({ listByUser }).request("/v1/me/submissions");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string; status: string }>;
    expect(rows[0]).toMatchObject({ id: "sub-1", status: "submitted" });
  });
});
