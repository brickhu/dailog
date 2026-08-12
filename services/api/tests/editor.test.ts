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
    notifications?: Partial<Repos["notifications"]>;
    guests?: Partial<Repos["guests"]>;
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
      existsAfter: async () => false,
      existsByLink: async () => false,
      ...overrides.notifications,
    },
    guests: {
      getByPlatform: async () => null,
      list: async () => [],
      voiceSampleByLanguage: async () => null,
      voiceSampleAny: async () => null,
      upsertVoiceSample: async () => {},
      listVoiceSamples: async () => [],
      ...overrides.guests,
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

describe("审核详情扩展字段（reviews/:id）", () => {
  it("返回投稿摘要聚合：邮箱/分享URL/字数/语言/人设/采样/拒审来源/已通知", async () => {
    const deps = makeDeps({
      repo: fakeRepo({
        polishes: {
          getById: async () => ({
            id: "rev-1", userId: "user-1", snapshotId: "snap-1", title: "投稿标题", status: "rejected",
            rejectedReason: "内容空泛", reviewedBy: "llm", reviewedAt: new Date(), createdAt: new Date(),
          }),
        },
        snapshots: {
          getById: async () => ({
            parsedDialogue: [{ role: "user", content: "你好世界" }, { role: "assistant", content: "12345" }],
            sourceTitle: "分享标题", platform: "claude", prefixSourceId: null, url: "https://claude.ai/share/x",
          }),
        },
        notifications: {
          getEmailByUserId: async () => "user@example.com",
          existsAfter: async () => true,
          existsByLink: async () => false,
        },
        transcripts: {
          listByPolish: async () => [{ id: "tr-1", segments: [{ speaker: "host", text: "你好" }], updatedSegments: null, topic: null, title: null, creationNote: null, language: "zh", status: "unused", createdAt: new Date() }],
        },
        episodes: {
          getVoiceSample: async () => ({ userId: "user-1", language: "zh", audioUrl: "voices/user-1/zh.webm", referenceId: null, transcript: null, duration: 5, status: "ready" }),
          getProfile: async () => ({ email: "user@example.com", nickname: "主持人昵称", displayName: "主持人", emailVerified: true, image: null, hasGithub: false, username: "host", bio: null, channelActivatedAt: null, persona: { callName: "阿峰" } }),
        },
        guests: {
          voiceSampleAny: async () => ({ id: "s1", guestId: "claude", language: "zh", audioKey: "guests/claude/zh.webm", referenceId: null, transcript: null }),
        },
      }),
      guestsByPlatform: { claude: { id: "claude", name: "Claude", intro: "Claude 的 AI 助手" } },
    });
    const res = await makeApp(deps).request("/v1/editor/reviews/rev-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      email: "user@example.com",
      snapshotUrl: "https://claude.ai/share/x",
      sourceTitle: "分享标题",
      msgCount: 2,
      wordCount: 9,
      platform: "claude",
      language: "zh",
      reviewedBy: "llm",
      notified: true,
      host: { name: "主持人", hasSample: true },
      guest: { id: "claude", name: "Claude", hasSample: true },
    });
    // 对话全文保留（折叠展示用）
    expect(body.dialogue.messages).toHaveLength(2);
  });
});

describe("拒审来源记录", () => {
  it("人工拒审 → reviewedBy=editor", async () => {
    let reviewedBy: string | null | undefined;
    const deps = makeDeps({
      repo: fakeRepo({
        polishes: { setStatus: async (_id, _s, opts) => { reviewedBy = opts?.reviewedBy ?? null; } },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/reviews/rev-1/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "违规内容" }),
    });
    expect(res.status).toBe(200);
    expect(reviewedBy).toBe("editor");
  });

  it("LLM 质量不达标自动拒 → reviewedBy=llm", async () => {
    let reviewedBy: string | null | undefined;
    const deps = makeDeps({
      llm: { complete: async () => JSON.stringify({ quality_failed: true, reason: "过短" }), stream: async () => "" } as unknown as LlmClient,
      repo: fakeRepo({
        polishes: { setStatus: async (_id, _s, opts) => { reviewedBy = opts?.reviewedBy ?? null; } },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/reviews/rev-1/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(reviewedBy).toBe("llm");
  });
});

describe("生成任务列表（generates）", () => {
  it("列表返回脚本数 + 各节目语音状态（job 阶段并入）", async () => {
    const deps = makeDeps({
      repo: fakeRepo({
        polishes: {
          listAccepted: async () => [
            { id: "rev-1", title: "投稿A", snapshotTitle: "对话A", platform: "claude", createdAt: new Date(), reviewedAt: new Date() },
          ],
        },
        transcripts: {
          listByPolish: async () => [
            { id: "tr-1", segments: [], updatedSegments: null, topic: null, title: "脚本一", creationNote: null, language: "zh", status: "unused", createdAt: new Date() },
            { id: "tr-2", segments: [], updatedSegments: null, topic: null, title: "脚本二", creationNote: null, language: "zh", status: "used", createdAt: new Date() },
          ],
        },
        episodes: {
          listByPolish: async () => [
            { id: "ep-1", transcriptId: "tr-2", title: null, status: "generating", number: null, isPicked: false, createdAt: new Date(), publishedAt: null },
          ],
        },
      }),
      getLatestJob: async () => ({ id: "job-1", status: "tts", progress: 40, error: null }),
    });
    const res = await makeApp(deps).request("/v1/editor/generates");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: "rev-1",
      scripts: 2,
      episodes: [{ id: "ep-1", transcriptId: "tr-2", status: "generating", jobStatus: "tts" }],
    });
  });
});

describe("生成任务详情（generates/:id）", () => {
  it("返回投稿摘要 + 脚本列表（关联节目 + job 状态）", async () => {
    const deps = makeDeps({
      repo: fakeRepo({
        polishes: {
          getById: async () => ({
            id: "rev-1", userId: "user-1", snapshotId: "snap-1", title: "投稿A", status: "accepted",
            rejectedReason: null, reviewedBy: null, reviewedAt: new Date(), createdAt: new Date(),
          }),
        },
        transcripts: {
          listByPolish: async () => [
            { id: "tr-1", segments: [{ speaker: "host", text: "你好" }], updatedSegments: null, topic: "主题一", title: "脚本一", creationNote: "思路", language: "zh", status: "used", createdAt: new Date() },
            { id: "tr-2", segments: [{ speaker: "guest", text: "再见" }], updatedSegments: null, topic: "主题二", title: "脚本二", creationNote: null, language: "zh", status: "unused", createdAt: new Date() },
          ],
        },
        episodes: {
          listByPolish: async () => [
            { id: "ep-1", transcriptId: "tr-1", title: null, status: "failed", number: null, isPicked: false, createdAt: new Date(), publishedAt: null },
          ],
        },
      }),
      getLatestJob: async () => ({ id: "job-1", status: "failed", progress: 100, error: "tts 服务不可用" }),
    });
    const res = await makeApp(deps).request("/v1/editor/generates/rev-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: "rev-1", status: "accepted" });
    expect(body.scripts).toHaveLength(2);
    expect(body.scripts[0]).toMatchObject({
      id: "tr-1",
      status: "used",
      episode: { id: "ep-1", status: "failed", jobStatus: "failed", jobError: "tts 服务不可用" },
    });
    expect(body.scripts[1].episode).toBeNull();
  });

  it("不存在的投稿 → 404", async () => {
    const deps = makeDeps({ repo: fakeRepo({ polishes: { getById: async () => null } }) });
    const res = await makeApp(deps).request("/v1/editor/generates/missing");
    expect(res.status).toBe(404);
  });
});

describe("追加脚本（scripts）", () => {
  it("缺少创作要求 → 400 prompt_required", async () => {
    const deps = makeDeps({
      repo: fakeRepo({
        polishes: {
          getById: async () => ({
            id: "rev-1", userId: "user-1", snapshotId: "snap-1", title: "投稿A", status: "accepted",
            rejectedReason: null, reviewedBy: null, reviewedAt: new Date(), createdAt: new Date(),
          }),
        },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/reviews/rev-1/scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "prompt_required" });
  });

  it("非 accepted 投稿 → 409", async () => {
    const res = await makeApp(makeDeps()).request("/v1/editor/reviews/rev-1/scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "换个轻松的角度" }),
    });
    // 默认 fake status=submitted
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "invalid_status" });
  });

  it("成功 → 创建一条新脚本并返回", async () => {
    let created = 0;
    const deps = makeDeps({
      llm: {
        complete: async () => JSON.stringify({ language: "zh", scripts: [{ topic: "轻松角度", title: "轻松版", creationNote: "追加说明", segments: [{ speaker: "host", text: "换个聊法" }] }] }),
        stream: async () => "",
      } as unknown as LlmClient,
      repo: fakeRepo({
        polishes: {
          getById: async () => ({
            id: "rev-1", userId: "user-1", snapshotId: "snap-1", title: "投稿A", status: "accepted",
            rejectedReason: null, reviewedBy: null, reviewedAt: new Date(), createdAt: new Date(),
          }),
        },
        transcripts: {
          create: async () => { created += 1; return { id: `tr-new-${created}` }; },
        },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/reviews/rev-1/scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "换个轻松的角度聊聊" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transcript).toMatchObject({
      id: "tr-new-1",
      title: "轻松版",
      topic: "轻松角度",
      creationNote: "追加说明",
    });
    expect(created).toBe(1);
  });
});

describe("概览统计（overview）", () => {
  it("返回审核/脚本/发布三组计数", async () => {
    const deps = makeDeps({
      repo: fakeRepo({
        polishes: {
          overviewStats: async () => ({
            reviews: { submitted: 5, accepted: 3, rejected: 2 },
            scripts: { pending: 6, generated: 10, failed: 1 },
            episodes: { published: 4, failed: 0 },
          }),
        },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/overview");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      reviews: { submitted: 5, accepted: 3, rejected: 2 },
      scripts: { pending: 6, generated: 10, failed: 1 },
      episodes: { published: 4, failed: 0 },
    });
  });
});

describe("发布页详情（publish-detail）", () => {
  it("返回节目 + 音频 + 投稿/脚本摘要 + 已通知推断 + 节目 URL", async () => {
    const deps = makeDeps({
      siteBaseUrl: "https://site.dailog.fm",
      repo: fakeRepo({
        episodes: {
          getById: async () => ({ id: "ep-1", polishId: "rev-1", transcriptId: "tr-1", title: "第 1 期", description: "简介", coverUrl: "covers/ep-1.jpg", tags: ["AI"], status: "published", number: 1, isPicked: false, createdAt: new Date(), publishedAt: new Date() }),
          getPublicAudioKey: async () => ({ audioKey: "audio/ep-1.mp3", version: "v1" }),
          getProfile: async () => ({ email: "user@example.com", nickname: null, displayName: "主持人", emailVerified: true, image: null, hasGithub: false, username: "host", bio: null, channelActivatedAt: null, persona: { callName: "阿峰" } }),
        },
        transcripts: {
          getById: async () => ({ id: "tr-1", polishId: "rev-1", segments: [{ speaker: "host", text: "你好" }], updatedSegments: null, topic: "主题", title: "脚本标题", language: "zh", guestId: "claude", status: "used" }),
        },
        notifications: {
          getEmailByUserId: async () => "user@example.com",
          existsByLink: async () => true,
        },
        guests: {
          getByPlatform: async () => ({ id: "claude", name: "Claude" }),
        },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/episodes/ep-1/publish-detail");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      episode: { id: "ep-1", status: "published", number: 1 },
      audioUrl: "/v1/editor/episodes/ep-1/audio",
      polish: { id: "rev-1", email: "user@example.com" },
      transcript: { id: "tr-1", title: "脚本标题", topic: "主题" },
      host: { name: "主持人", callName: "阿峰" },
      guest: { id: "claude", name: "Claude" },
      notified: true,
      programUrl: "https://site.dailog.fm/episode/ep-1",
    });
  });

  it("未发布 → programUrl null", async () => {
    const deps = makeDeps({ repo: fakeRepo() });
    // 默认 fake episode status=ready
    const res = await makeApp(deps).request("/v1/editor/episodes/ep-1/publish-detail");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.programUrl).toBeNull();
    expect(body.episode.status).toBe("ready");
  });
});

describe("采样音频端点（samples）", () => {
  const storage = { get: async () => new Uint8Array([0x1f, 0x8b, 0x08]), put: async () => {} };

  it("主持人采样 → 音频流 audio/webm", async () => {
    const deps = makeDeps({
      storage,
      repo: fakeRepo({
        episodes: {
          getVoiceSample: async () => ({ userId: "user-1", language: "zh", audioUrl: "voices/user-1/zh.webm", referenceId: null, transcript: null, duration: 5, status: "ready" }),
        },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/samples/host/user-1/audio");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("audio/webm");
    expect((await res.arrayBuffer()).byteLength).toBe(3);
  });

  it("嘉宾采样 → 音频流 audio/webm", async () => {
    const deps = makeDeps({
      storage,
      repo: fakeRepo({
        guests: {
          voiceSampleAny: async () => ({ id: "s1", guestId: "claude", language: "zh", audioKey: "guests/claude/zh.webm", referenceId: null, transcript: null }),
        },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/samples/guest/claude/audio");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("audio/webm");
  });

  it("无采样/无存储 → 404", async () => {
    const res = await makeApp(makeDeps()).request("/v1/editor/samples/host/user-1/audio");
    expect(res.status).toBe(404);
  });

  it("节目音频 → audio/mpeg", async () => {
    const deps = makeDeps({
      storage,
      repo: fakeRepo({
        episodes: {
          getPublicAudioKey: async () => ({ audioKey: "audio/ep-1.mp3", version: "v1" }),
        },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/episodes/ep-1/audio");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("audio/mpeg");
  });
});

describe("已发布节目元数据编辑（PUT 标题/封面/摘要）", () => {
  it("PUT title/description/coverUrl → updatePublished 透传", async () => {
    let updated: Record<string, unknown> | null = null;
    const deps = makeDeps({
      repo: fakeRepo({
        episodes: {
          getById: async () => ({ id: "ep-1", polishId: "rev-1", transcriptId: "tr-1", title: null, description: null, coverUrl: null, tags: null, status: "published", number: 1, isPicked: false, createdAt: new Date(), publishedAt: new Date() }),
          updatePublished: async (_id, row) => { updated = row as Record<string, unknown>; },
        },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/episodes/ep-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "新标题", description: "新简介", coverUrl: "https://img.example.com/a.jpg" }),
    });
    expect(res.status).toBe(200);
    expect(updated).toMatchObject({ title: "新标题", description: "新简介", coverUrl: "https://img.example.com/a.jpg" });
  });

  it("PUT 非 http 封面 → coverUrl null", async () => {
    let updated: Record<string, unknown> | null = null;
    const deps = makeDeps({
      repo: fakeRepo({
        episodes: {
          getById: async () => ({ id: "ep-1", polishId: "rev-1", transcriptId: "tr-1", title: null, description: null, coverUrl: null, tags: null, status: "published", number: 1, isPicked: false, createdAt: new Date(), publishedAt: new Date() }),
          updatePublished: async (_id, row) => { updated = row as Record<string, unknown>; },
        },
      }),
    });
    const res = await makeApp(deps).request("/v1/editor/episodes/ep-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coverUrl: "not-a-url" }),
    });
    expect(res.status).toBe(200);
    expect(updated).toMatchObject({ coverUrl: null });
  });
});
