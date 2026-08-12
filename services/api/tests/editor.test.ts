import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { editorRoutes, type EditorDeps } from "../src/routes/editor";
import type { AuthEnv } from "../src/middleware/auth";
import type { Repos } from "../src/repo";
import type { LlmClient } from "../src/llm/client";

// 编辑端路由单测（ARC：API 契约 Vitest + Hono app 直测）：
// 覆盖角色守卫 / 队列 / 拒绝（reason 必填）/ process 审核通过·失败 / 生成 / 发布（期号）

function fakeRepo(overrides: {
    snapshots?: Partial<Repos["snapshots"]>;
    polishes?: Partial<Repos["polishes"]>;
    transcripts?: Partial<Repos["transcripts"]>;
    episodes?: Partial<Repos["episodes"]>;
  } = {}): Repos {
  return {
    snapshots: {
      getByUrl: async () => null,
      getById: async () => ({ parsedDialogue: [{ role: "user", content: "问" }, { role: "assistant", content: "答" }], sourceTitle: "对话", platform: "claude" }),
      create: async () => ({ id: "snap-1" }),
      updateContent: async () => {},
      updateQuality: async () => {},
      markUnreachable: async () => {},
            markParseFailed: async () => {},
      listTraceable: async () => [],
      setSourceTrace: async () => {},
      ...overrides.snapshots,
    },
    polishes: {
      findByUserSnapshot: async () => null,
      create: async () => ({ id: "polish-1" }),
      createSubmission: async () => ({ id: "sub-1" }),
      countPendingByUser: async () => 0,
      listSubmissionsByUser: async () => [],
      listQueue: async () => [],
      getById: async () => ({ id: "rev-1", userId: "user-1", snapshotId: "snap-1", title: "投稿", status: "submitted", rejectedReason: null, createdAt: new Date() }),
      setStatus: async () => {},
      getOwned: async () => null,
      getPolishDetail: async () => null,
      listByUser: async () => [],
      ...overrides.polishes,
    },
    transcripts: {
      create: async () => ({ id: "tr-1" }),
      listByPolish: async () => [],
      getOwned: async () => null,
      getById: async () => ({ id: "tr-1", polishId: "rev-1", segments: [{ speaker: "host", text: "你好" }], updatedSegments: null, topic: null, title: null, language: "zh", guestId: null, status: "unused" }),
      updateSegments: async () => {},
      markUsed: async () => {},
      ...overrides.transcripts,
    },
    episodes: {
      create: async () => ({ id: "ep-1" }),
      listByUser: async () => [],
      getOwned: async () => null,
      getEpisodeAudio: async () => null,
      getByTranscript: async () => null,
      getById: async () => ({ id: "ep-1", polishId: "rev-1", transcriptId: "tr-1", title: null, description: null, coverUrl: null, tags: null, status: "ready", number: null, isPicked: false, createdAt: new Date(), publishedAt: null }),
      listByPolish: async () => [],
      publish: async () => ({ number: 1 }),
      updatePublished: async () => {},
      listPublished: async () => [],
      findPublishedEpisodeBySnapshot: async () => null,
      getEpisodeScript: async () => null,
      getEpisodeGuest: async () => null,
      getPublicAudioKey: async () => null,
      getPublicCoverKey: async () => null,
      getPublishedDialogue: async () => null,
      setPublished: async () => {},
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
      updateChannel: async () => ({ ok: true }),
      isUsernameTaken: async () => false,
      syncAdminRoles: async () => 0,
      ...overrides.episodes,
    },
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
  } as unknown as Repos;
}

function makeDeps(overrides: Partial<EditorDeps> = {}): EditorDeps {
  return {
    repo: fakeRepo(),
    llm: { complete: async () => "", stream: async () => "" } as unknown as LlmClient,
    guestsByPlatform: {},
    safetyCheck: async () => ({ pass: true }),
    createJob: async (episodeId: string) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
    enqueueJob: async () => {},
    getLatestJob: async () => null,
    pexelsApiKey: null,
    ...overrides,
  };
}

function makeApp(deps: EditorDeps, role: "user" | "editor" | "admin" = "editor") {
  // 模拟真实顺序：全局认证中间件（注入 userId/role）先于 editorRoutes 注册——
  // editorRoutes 内部守卫在后执行，才能读到 role
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", "editor-1");
    c.set("role", role);
    await next();
  });
  app.route("/", editorRoutes(deps));
  return app;
}

describe("角色守卫", () => {
  it("普通用户访问编辑队列 → 403 forbidden", async () => {
    const res = await makeApp(makeDeps(), "user").request("/v1/editor/queue");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden" });
  });

  it("editor 可访问队列", async () => {
    const res = await makeApp(makeDeps()).request("/v1/editor/queue");
    expect(res.status).toBe(200);
    expect((await res.json()) as { status?: string }).toMatchObject({ status: "submitted" });
  });
});

describe("拒绝（reject）", () => {
  it("缺少 reason → 400 reason_required", async () => {
    const res = await makeApp(makeDeps()).request("/v1/editor/reviews/rev-1/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "reason_required" });
  });

  it("带 reason → 200（setStatus rejected + reason）", async () => {
    let rejected: { status: string; reason: string | null } | null = null;
    const deps = makeDeps({
      repo: fakeRepo({
        polishes: { setStatus: async (_id, status, opts) => { rejected = { status, reason: opts?.rejectedReason ?? null }; } },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/reviews/rev-1/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "内容过于空泛" }),
    });
    expect(res.status).toBe(200);
    expect(rejected).toMatchObject({ status: "rejected", reason: "内容过于空泛" });
  });
});

describe("审核 + 润色（process）", () => {
  it("审核不通过（quality_failed）→ rejected + reason，不建脚本", async () => {
    let created = 0;
    const deps = makeDeps({
      llm: { complete: async () => JSON.stringify({ quality_failed: true, reason: "对话过短无主题" }), stream: async () => "" } as unknown as LlmClient,
      repo: fakeRepo({
        transcripts: {
          create: async () => { created += 1; return { id: `tr-${created}` }; },
          listByPolish: async () => [],
          getOwned: async () => null,
          getById: async () => null,
          updateSegments: async () => {},
          markUsed: async () => {},
        },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/reviews/rev-1/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rejected: true, reason: "对话过短无主题" });
    expect(created).toBe(0);
  });

  it("审核通过 → 创建脚本候选（1–N 版）+ accepted", async () => {
    const created: string[] = [];
    const deps = makeDeps({
      llm: {
        complete: async () => JSON.stringify({
          language: "zh",
          scripts: [
            { topic: "AI 与创作", title: "AI 时代的创作", creationNote: "主题一", segments: [{ speaker: "host", text: "你好" }] },
            { topic: "AI 与工作", title: "工作会消失吗", creationNote: "主题二", segments: [{ speaker: "guest", text: "不会" }] },
          ],
        }),
        stream: async () => "",
      } as unknown as LlmClient,
      repo: fakeRepo({
        transcripts: {
          create: async (_p, _s, _l, opts) => { created.push(opts?.topic ?? ""); return { id: `tr-${created.length}` }; },
          listByPolish: async () => [],
          getOwned: async () => null,
          getById: async () => null,
          updateSegments: async () => {},
          markUsed: async () => {},
        },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/reviews/rev-1/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rejected?: boolean; transcripts?: unknown[] };
    expect(body.rejected).toBe(false);
    expect(body.transcripts).toHaveLength(2);
    expect(created).toEqual(["AI 与创作", "AI 与工作"]);
  });
});

describe("发布（publish）", () => {
  it("非 ready 状态 → 409", async () => {
    const deps = makeDeps({
      repo: fakeRepo({
        episodes: {
          getById: async () => ({ id: "ep-1", polishId: "rev-1", transcriptId: "tr-1", title: null, description: null, coverUrl: null, tags: null, status: "generating", number: null, isPicked: false, createdAt: new Date(), publishedAt: null }),
        },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/episodes/ep-1/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "标题" }),
    });
    expect(res.status).toBe(409);
  });

  it("发布成功 → 返回分配期号", async () => {
    const deps = makeDeps({
      repo: fakeRepo({
        episodes: {
          publish: async () => ({ number: 12 }),
        },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/episodes/ep-1/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "第 12 期标题", description: "简介", tags: ["AI", "创作"], isPicked: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, number: 12 });
  });

  it("缺少 title → 400 title_required", async () => {
    const res = await makeApp(makeDeps()).request("/v1/editor/episodes/ep-1/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "title_required" });
  });
});

describe("封面候选（cover-search）", () => {
  it("未配置 Pexels key → 503", async () => {
    const res = await makeApp(makeDeps()).request("/v1/editor/reviews/rev-1/cover-search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["mountain"] }),
    });
    expect(res.status).toBe(503);
  });
});

describe("已发布节目（list / edit）", () => {
  it("GET /v1/editor/episodes → 已发布列表（按期号倒序由 repo 保证）", async () => {
    let called = false;
    const deps = makeDeps({
      repo: fakeRepo({
        episodes: {
          listPublished: async () => {
            called = true;
            return [
              { id: "ep-2", title: "第二期", number: 2, isPicked: true, tags: ["AI"], durationSeconds: 300, publishedAt: new Date() },
              { id: "ep-1", title: "第一期", number: 1, isPicked: false, tags: null, durationSeconds: 240, publishedAt: new Date() },
            ];
          },
        },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/episodes");
    expect(res.status).toBe(200);
    expect(called).toBe(true);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ id: "ep-2", number: 2, isPicked: true });
  });

  it("PUT /v1/editor/episodes/:id → 更新 tags + 精选标记", async () => {
    let updated: { tags?: string[] | null; isPicked?: boolean } | null = null;
    const deps = makeDeps({
      repo: fakeRepo({
        episodes: {
          getById: async () => ({ id: "ep-1", polishId: "rev-1", transcriptId: "tr-1", title: null, description: null, coverUrl: null, tags: null, status: "published", number: 1, isPicked: false, createdAt: new Date(), publishedAt: new Date() }),
          updatePublished: async (_id, row) => { updated = row; },
        },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/episodes/ep-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["AI", " 创作 "], isPicked: true }),
    });
    expect(res.status).toBe(200);
    expect(updated).toEqual({ tags: ["AI", "创作"], isPicked: true });
  });

  it("PUT 空 body → 400 invalid_input", async () => {
    const res = await makeApp(makeDeps()).request("/v1/editor/episodes/ep-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_input" });
  });

  it("PUT 不存在节目 → 404 not_found", async () => {
    const deps = makeDeps({
      repo: fakeRepo({ episodes: { getById: async () => null } }),
    });
    const res = await makeApp(deps).request("/v1/editor/episodes/missing", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPicked: true }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });
});
