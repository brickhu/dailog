import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { canonicalUrl, submissionsRoutes } from "../src/routes/submissions";
import type { Repos } from "../src/repo";
import { fakePlaylistsRepo } from "./helpers/fake-playlists";

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
      voiceSampleAny: async () => null, anyVoiceSampleByLanguage: async () => null,
      upsertVoiceSample: async () => {},
      update: async () => {},
      listVoiceSamples: async () => [],
    },
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
    submissions: {
      create: async () => ({ id: "sub-1" }),
      findByUrl: async () => null,
      listByUrl: async () => [],
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
      ...repo,
    },
  } as Repos));
  return app;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// 白名单内分享链接（平台分享页；原测试用 example.com 已被 SHARE_HOSTS 白名单拦截 → 400）
const VALID_URL = "https://chat.deepseek.com/share/abc123";

describe("POST /v1/submissions —— URL 合法性", () => {
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

  it("rejects non-whitelisted share host with 400（unsupported_url）", async () => {
    const res = await makeApp().request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/share/abc" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "unsupported_url" });
  });

  it("accepts whitelisted share URL（服务端不探活，直接 201）", async () => {
    const res = await makeApp().request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: VALID_URL }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ submissionId: "sub-1", status: "submitted", language: "zh" });
  });
});

describe("POST /v1/submissions —— 并发上限 / 重复 / 入库", () => {
  it("rejects when pending count at limit with 429", async () => {
    const app = makeApp({ countPendingByUser: async () => 5 });
    const res = await app.request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: VALID_URL }),
    });
    expect(res.status).toBe(429);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "pending_limit" });
  });

  it("rejects when user has no ready voice sample with 422（voice_sample_required）", async () => {
    const app = makeApp({ hasReadyVoiceSample: async () => false });
    const res = await app.request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: VALID_URL }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "voice_sample_required" });
  });

  it("returns existing submission when owner re-submits the same zone（幂等）", async () => {
    const app = makeApp({ listByUrl: async () => [{ id: "sub-old", userId: "user-1", language: "zh", status: "submitted", createdAt: new Date() }] });
    const res = await app.request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: VALID_URL }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ existing: true, submissionId: "sub-old", status: "submitted", language: "zh", episode: null });
  });

  it("creates submission with url + title + callName + suggestion + voiceSampleId（采样校验传参、trim、规范化入库）", async () => {
    const create = vi.fn(async (_id: string, _u: string, _url: string, _t: string | null, _sug?: string | null, _guest?: unknown, _host?: unknown, _lang?: string) => ({ id: _id || "sub-new" }));
    const hasReadyVoiceSample = vi.fn(async () => true);
    const app = makeApp({ create, hasReadyVoiceSample });
    const res = await app.request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: VALID_URL, title: "我的对话", callNameInEpisode: "飞", suggestion: "  想聊聊 AI 编程的实际用法  ", voiceSampleId: "11111111-1111-4111-8111-111111111111" }),
    });
    expect(res.status).toBe(201);
    // 采样归属校验：传入的 voiceSampleId 必须原样交给校验（防引用他人采样），并带投稿区语种
    expect(hasReadyVoiceSample).toHaveBeenCalledWith("user-1", "11111111-1111-4111-8111-111111111111", "zh");
    // 入库参数：id 为 UUID 格式（含随机 rand，不可预测）；url 规范化入库；host 定格 callName/画像/采样
    const createArgs = create.mock.calls[0]!;
    expect(createArgs[1]).toBe("user-1"); // userId
    expect(createArgs[2]).toBe(canonicalUrl(VALID_URL)); // 规范化 URL 入库
    expect(createArgs[3]).toBe("我的对话"); // title
    expect(createArgs[4]).toBe("想聊聊 AI 编程的实际用法"); // suggestion（trim 后）
    expect(createArgs[5]).toBeNull(); // guest（无平台匹配）
    expect(createArgs[6]).toEqual(expect.objectContaining({
      callName: "飞",
      voiceSampleId: "11111111-1111-4111-8111-111111111111",
      personaInfo: expect.objectContaining({ displayName: "测试员" }),
    }));
    expect(createArgs[7]).toBe("zh"); // language（缺省投稿区）
    expect(String(createArgs[0])).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("POST /v1/submissions —— 投稿区（language）与归属规则", () => {
  it("rejects unknown zone with 400（invalid_language）", async () => {
    const res = await makeApp().request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: VALID_URL, language: "ja" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "invalid_language" });
  });

  it("owner 追加另一语言区 → 允许创建（同 URL 已有 zh 投稿）", async () => {
    const create = vi.fn(async (id: string) => ({ id }));
    const app = makeApp({
      listByUrl: async () => [{ id: "sub-zh", userId: "user-1", language: "zh", status: "published", createdAt: new Date() }],
      create,
    });
    const res = await app.request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: VALID_URL, language: "en" }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()) as { language: string }).toMatchObject({ language: "en" });
    expect(create.mock.calls[0]![7]).toBe("en");
  });

  it("他人已投稿 → 409 already_claimed（且不追问采样）", async () => {
    const hasReadyVoiceSample = vi.fn(async () => true);
    const app = makeApp({
      listByUrl: async () => [{ id: "sub-other", userId: "user-2", language: "zh", status: "submitted", createdAt: new Date() }],
      hasReadyVoiceSample,
    });
    const res = await app.request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: VALID_URL, language: "en" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "already_claimed" });
    expect(hasReadyVoiceSample).not.toHaveBeenCalled();
  });

  it("投稿区语种参与采样校验（英文区 → en）", async () => {
    const hasReadyVoiceSample = vi.fn(async () => true);
    const app = makeApp({ hasReadyVoiceSample });
    const res = await app.request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: VALID_URL, language: "en", voiceSampleId: "11111111-1111-4111-8111-111111111111" }),
    });
    expect(res.status).toBe(201);
    expect(hasReadyVoiceSample).toHaveBeenCalledWith("user-1", "11111111-1111-4111-8111-111111111111", "en");
  });

  it("无该语种采样 → 422（voice_sample_required，提示语种）", async () => {
    const app = makeApp({ hasReadyVoiceSample: async (_u, _s, lang) => lang !== "en" });
    const res = await app.request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: VALID_URL, language: "en" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("voice_sample_required");
    expect(body.detail).toContain("en");
  });

  it("并发撞 (url, language) 唯一约束 → 回查并幂等返回已有投稿", async () => {
    const row = { id: "sub-race", userId: "user-1", language: "zh", status: "submitted", createdAt: new Date() };
    const listByUrl = vi.fn()
      .mockResolvedValueOnce([])      // 首次归属查询：无投稿
      .mockResolvedValueOnce([row]);  // create 失败后的回查
    const app = makeApp({ listByUrl, create: async () => ({ id: "" }) });
    const res = await app.request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: VALID_URL }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ existing: true, submissionId: "sub-race", status: "submitted", language: "zh", episode: null });
  });
});

describe("POST /v1/submissions/check —— 归属与投稿区占用", () => {
  const check = (app: Hono<{ Variables: { userId: string } }>, body: unknown) =>
    app.request("/v1/submissions/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("无投稿 → owner=none，两个区都可投", async () => {
    const res = await check(makeApp(), { url: VALID_URL });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { owner: string; existing: boolean; zones: Record<string, { canSubmit: boolean; submitted: boolean }> };
    expect(body.owner).toBe("none");
    expect(body.existing).toBe(false);
    expect(body.zones.zh).toMatchObject({ submitted: false, canSubmit: true });
    expect(body.zones.en).toMatchObject({ submitted: false, canSubmit: true });
  });

  it("本人已投中文区 → owner=self，zh 不可再投、en 可投", async () => {
    const app = makeApp({ listByUrl: async () => [{ id: "sub-zh", userId: "user-1", language: "zh", status: "published", createdAt: new Date() }] });
    const body = (await (await check(app, { url: VALID_URL })).json()) as {
      owner: string; submissionId: string | null; zones: Record<string, { canSubmit: boolean; submitted: boolean; status: string | null }>;
    };
    expect(body.owner).toBe("self");
    expect(body.submissionId).toBe("sub-zh");
    expect(body.zones.zh).toMatchObject({ submitted: true, canSubmit: false, status: "published" });
    expect(body.zones.en).toMatchObject({ submitted: false, canSubmit: true });
  });

  it("他人已投稿 → owner=other，不回传他人 submissionId，两区都不可投", async () => {
    const app = makeApp({ listByUrl: async () => [{ id: "sub-other", userId: "user-2", language: "zh", status: "published", createdAt: new Date() }] });
    const body = (await (await check(app, { url: VALID_URL })).json()) as {
      owner: string; existing: boolean; submissionId: string | null; zones: Record<string, { canSubmit: boolean; submissionId: string | null; hasSample: boolean }>;
    };
    expect(body.owner).toBe("other");
    expect(body.existing).toBe(true);
    expect(body.submissionId).toBeNull();
    expect(body.zones.zh).toMatchObject({ canSubmit: false, submissionId: null, hasSample: false });
    expect(body.zones.en).toMatchObject({ canSubmit: false });
  });
});

describe("GET /v1/me/submissions", () => {
  it("returns my submissions list", async () => {
    const listByUser = vi.fn(async () => [
      { id: "sub-1", url: VALID_URL, title: null, callName: null, status: "submitted", rejectedReason: null, episodeStatus: null, createdAt: new Date() },
    ]);
    const res = await makeApp({ listByUser }).request("/v1/me/submissions");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string; status: string }>;
    expect(rows[0]).toMatchObject({ id: "sub-1", status: "submitted" });
  });
});
