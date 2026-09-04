import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { editorRoutes, type EditorDeps } from "../src/routes/editor";
import type { AuthEnv } from "../src/middleware/auth";
import type { Repos } from "../src/repo";
import type { Env } from "../src/config/env";
import { fakePlaylistsRepo } from "./helpers/fake-playlists";

// 编辑端端点（本质版）测试：fake repo + fake storage 注入，覆盖角色守卫/队列/详情/拒审/发布/嘉宾/采样下载。
// 编辑工作流在本地 Agent 完成，服务端只有这 4 个动作 + 素材下载。

function fakeRepo(overrides: Partial<Repos> = {}): Repos {
  return {
    guests: {
      getByPlatform: async () => null,
      getById: async () => null,
      list: async () => [
        { id: "claude", platform: "claude", name: "Claude", avatar: null, intro: "Anthropic 的 AI 助手", url: null },
      ],
      voiceSampleByLanguage: async () => null,
      voiceSampleAny: async () => ({ id: "gvs-1", guestId: "claude", language: "zh", audioKey: "guests/claude/zh.mp3", transcript: "你好" }),
      anyVoiceSampleByLanguage: async () => null,
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
      createPublished: async () => ({ id: "ep-1", number: 7, slug: "abc12345" }),
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
    ...overrides,
  };
}

function fakeEnv(): Env {
  return {
    DATABASE_URL: "postgres://localhost:5432/dailog",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost:8787",
    PORT: 8787,
    FISH_API_KEY: "",
    STORAGE_DRIVER: "fs",
    STORAGE_DIR: "./data",
    APP_ORIGINS: "",
    RESEND_API_KEY: "",
    EMAIL_FROM: "dailog <no-reply@dailog.fm>",
    ADMIN_EMAILS: "",
    SITE_BASE_URL: "https://dailog.fm",
  };
}

function makeApp(deps: Partial<EditorDeps> = {}, role: "user" | "editor" | "admin" = "editor") {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", "editor-1");
    c.set("role", role);
    await next();
  });
  app.route("/", editorRoutes({
    repo: fakeRepo(),
    env: fakeEnv(),
    storage: { put: async () => {}, get: async () => ({ data: new Uint8Array([1, 2, 3]), total: 3 }), delete: async () => {} },
    siteBaseUrl: "https://dailog.fm",
    ...deps,
  }));
  return app;
}

const SUBMITTED_DETAIL = {
  id: "sub-1",
  userId: "user-1",
  url: "https://claude.ai/share/abc-123",
  title: null,
  status: "submitted" as const,
  rejectedReason: null,
  reviewedAt: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  userEmail: "submitter@test.local",
  personaInfo: { displayName: "投稿人", gender: null, profession: null, age: null, bio: null, nationality: null },
  callName: "小北",
  suggestion: null,
  voiceSampleId: null,
  voiceSamples: [{ audioUrl: "voices/user-1/zh.webm", transcript: "大家好", language: "zh", status: "ready", duration: 5 }],
};

describe("角色守卫", () => {
  it("普通用户访问编辑端点 → 403", async () => {
    const res = await makeApp({}, "user").request("/v1/editor/submissions");
    expect(res.status).toBe(403);
  });

  it("admin 可访问", async () => {
    const res = await makeApp({}, "admin").request("/v1/editor/submissions");
    expect(res.status).toBe(200);
  });
});

describe("队列与详情", () => {
  it("GET /v1/editor/submissions 缺省 submitted 队列", async () => {
    const listQueue = vi.fn(async () => [{ id: "sub-1", url: "https://claude.ai/share/abc", title: null, status: "submitted", createdAt: new Date(), userEmail: "a@b.c", displayName: "A", hasVoiceSample: true }]);
    const res = await makeApp({ repo: fakeRepo({ submissions: { ...fakeRepo().submissions, listQueue } }) }).request("/v1/editor/submissions");
    expect(res.status).toBe(200);
    expect(listQueue).toHaveBeenCalledWith("submitted");
  });

  it("GET /v1/editor/submissions?status=rejected 过滤", async () => {
    const listQueue = vi.fn(async () => []);
    await makeApp({ repo: fakeRepo({ submissions: { ...fakeRepo().submissions, listQueue } }) }).request("/v1/editor/submissions?status=rejected");
    expect(listQueue).toHaveBeenCalledWith("rejected");
  });

  it("GET /v1/editor/submissions/:id 详情 + 已上线节目", async () => {
    const res = await makeApp({
      repo: fakeRepo({
        submissions: { ...fakeRepo().submissions, getDetail: async () => SUBMITTED_DETAIL },
        episodes: { ...fakeRepo().episodes, listBySubmission: async () => [{ id: "ep-9", slug: "slug-9", title: "第 9 期", coverUrl: null, status: "published", isPublic: true, number: 9, isPicked: false, createdAt: new Date(), publishedAt: new Date() }] },
      }),
    }).request("/v1/editor/submissions/sub-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; callName: string | null; episodes: unknown[] };
    expect(body.url).toBe("https://claude.ai/share/abc-123");
    expect(body.callName).toBe("小北");
    expect(body.episodes).toHaveLength(1);
  });

  it("详情不存在 → 404", async () => {
    const res = await makeApp().request("/v1/editor/submissions/missing");
    expect(res.status).toBe(404);
  });
});

describe("拒审", () => {
  it("reason 必填 → 400", async () => {
    const res = await makeApp({ repo: fakeRepo({ submissions: { ...fakeRepo().submissions, getDetail: async () => SUBMITTED_DETAIL } }) })
      .request("/v1/editor/submissions/sub-1/reject", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "reason_required" });
  });

  it("已发布状态拒审 → 409（发布后不可拒）", async () => {
    const res = await makeApp({
      repo: fakeRepo({ submissions: { ...fakeRepo().submissions, getDetail: async () => ({ ...SUBMITTED_DETAIL, status: "published" as const }) } }),
    }).request("/v1/editor/submissions/sub-1/reject", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "内容不符合要求" }),
    });
    expect(res.status).toBe(409);
  });

  it("拒审成功 → reject + 通知投稿人", async () => {
    const reject = vi.fn(async () => {});
    const notifyCreate = vi.fn(async () => {});
    const res = await makeApp({
      repo: fakeRepo({
        submissions: { ...fakeRepo().submissions, getDetail: async () => SUBMITTED_DETAIL, reject },
        notifications: { ...fakeRepo().notifications, create: notifyCreate },
      }),
    }).request("/v1/editor/submissions/sub-1/reject", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "内容过于简短" }),
    });
    expect(res.status).toBe(200);
    expect(reject).toHaveBeenCalledWith("sub-1", "内容过于简短");
    expect(notifyCreate).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", type: "rejected", link: "/me/submits" }));
  });
});

describe("发布（编辑本地制作完成后一次性上传）", () => {
  it("audio 文件缺失 → 400", async () => {
    const res = await makeApp({ repo: fakeRepo({ submissions: { ...fakeRepo().submissions, getDetail: async () => SUBMITTED_DETAIL } }) })
      .request("/v1/editor/submissions/sub-1/publish", { method: "POST", body: new FormData() });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "audio_required" });
  });

  it("非 submitted 状态发布 → 409", async () => {
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array([1])], { type: "audio/mpeg" }), "final.mp3");
    const res = await makeApp({
      repo: fakeRepo({ submissions: { ...fakeRepo().submissions, getDetail: async () => ({ ...SUBMITTED_DETAIL, status: "published" as const }) } }),
    }).request("/v1/editor/submissions/sub-1/publish", { method: "POST", body: form });
    expect(res.status).toBe(409);
  });

  it("发布成功：音频落 R2 + episode 创建（期号）+ 投稿 published + 通知", async () => {
    const storagePut = vi.fn(async () => {});
    const createPublished = vi.fn(async () => ({ id: "ep-7", number: 7, slug: "abc12345" }));
    const markPublished = vi.fn(async () => {});
    const notifyCreate = vi.fn(async () => {});
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }), "final.mp3");
    form.append("cover", new Blob([new Uint8Array([9])], { type: "image/jpeg" }), "cover.jpg");
    form.append("meta", JSON.stringify({ title: "AI 会取代程序员吗", description: "一次深入的对话", tags: ["AI", "职业"], language: "zh", guestId: "claude", durationSeconds: 420 }));

    const res = await makeApp({
      storage: { put: storagePut, get: async () => ({ data: new Uint8Array(), total: 0 }), delete: async () => {} },
      repo: fakeRepo({
        submissions: {
          ...fakeRepo().submissions,
          getDetail: async () => SUBMITTED_DETAIL,
          markPublished,
        },
        episodes: { ...fakeRepo().episodes, createPublished },
        notifications: { ...fakeRepo().notifications, create: notifyCreate },
      }),
    }).request("/v1/editor/submissions/sub-1/publish", { method: "POST", body: form });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ episodeId: "ep-7", slug: "abc12345", number: 7, status: "published" });
    // 音频与封面各落一次 storage
    expect(storagePut).toHaveBeenCalledWith("episodes/user-1/sub-1.mp3", new Uint8Array([1, 2, 3]));
    expect(storagePut).toHaveBeenCalledWith("covers/sub-1.jpg", new Uint8Array([9]));
    expect(createPublished).toHaveBeenCalledWith(expect.objectContaining({
      submissionId: "sub-1",
      userId: "user-1",
      profileId: "user-1",
      guestId: "claude",
      title: "AI 会取代程序员吗",
      language: "zh",
      durationSeconds: 420,
      audioSize: 3,
      coverUrl: "covers/sub-1.jpg",
      rawConversationUrl: "https://claude.ai/share/abc-123",
    }));
    expect(markPublished).toHaveBeenCalledWith("sub-1");
    expect(notifyCreate).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      type: "published",
      title: expect.stringContaining("dailog 第 7 期"),
      link: "/episode/abc12345",
    }));
  });

  it("发布不带封面 → coverUrl 为 null，仍成功", async () => {
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array([1])], { type: "audio/mpeg" }), "final.mp3");
    const res = await makeApp({
      repo: fakeRepo({ submissions: { ...fakeRepo().submissions, getDetail: async () => SUBMITTED_DETAIL } }),
    }).request("/v1/editor/submissions/sub-1/publish", { method: "POST", body: form });
    expect(res.status).toBe(201);
  });

  // 回归：crafted 投稿发布（发布卡复用路径）——音频已在 R2（canonical episodes/{userId}/{id}.m4a），
  // 不发文件也不带 audioKey 也应成功（曾因客户端默认 flat key 而 400 audio_key_missing）
  it("crafted 发布（无 audio 文件/无 audioKey）→ 服务端解析 canonical 成品，零拷贝发布成功", async () => {
    const storagePut = vi.fn(async () => {});
    const createPublished = vi.fn(async () => ({ id: "ep-8", number: 8, slug: "slug-8" }));
    const markPublished = vi.fn(async () => {});
    // canonical 命中；flat/full 无；scripts 存在（scripts/{id}.json）
    const get = vi.fn(async (key: string) => {
      if (key === "episodes/user-1/sub-1.m4a") return { data: new Uint8Array([7, 8]), total: 2 };
      if (key.startsWith("scripts/") || key.startsWith("workflows/")) return { data: new Uint8Array([1, 2]), total: 2 };
      return { data: null as unknown as Uint8Array, total: 0 };
    });
    const form = new FormData();
    form.append("meta", JSON.stringify({ title: "crafted 复用发布", language: "zh" }));
    const res = await makeApp({
      storage: { put: storagePut, get, delete: async () => {} },
      repo: fakeRepo({
        submissions: {
          ...fakeRepo().submissions,
          getDetail: async () => ({ ...SUBMITTED_DETAIL, status: "crafted" as const }),
          markPublished,
        },
        episodes: { ...fakeRepo().episodes, createPublished },
      }),
    }).request("/v1/editor/submissions/sub-1/publish", { method: "POST", body: form });

    expect(res.status).toBe(201);
    expect(createPublished).toHaveBeenCalledWith(expect.objectContaining({
      audioUrl: "episodes/user-1/sub-1.m4a",
      audioSize: 2,
      rawConversationUrl: "https://claude.ai/share/abc-123",
    }));
    // canonical 已存在 → 零拷贝：audio 不重传
    expect(storagePut).not.toHaveBeenCalledWith("episodes/user-1/sub-1.m4a", expect.anything());
    expect(markPublished).toHaveBeenCalledWith("sub-1");
  });

  // 回归：音频在历史 flat episodes/{id}.m4a（2026-09 过渡布局）→ 解析命中后拷贝归一到 canonical
  it("crafted 发布但音频仅在 flat key → 拷贝归一到 episodes/{userId}/{id}.m4a", async () => {
    const storagePut = vi.fn(async () => {});
    const createPublished = vi.fn(async () => ({ id: "ep-9", number: 9, slug: "slug-9" }));
    const get = vi.fn(async (key: string) => {
      if (key === "episodes/sub-1.m4a") return { data: new Uint8Array([9, 9, 9]), total: 3 };
      if (key.startsWith("scripts/") || key.startsWith("workflows/")) return { data: new Uint8Array([1, 2]), total: 2 };
      return { data: null as unknown as Uint8Array, total: 0 };
    });
    const form = new FormData();
    form.append("meta", JSON.stringify({ title: "flat 迁移发布", language: "zh" }));
    const res = await makeApp({
      storage: { put: storagePut, get, delete: async () => {} },
      repo: fakeRepo({
        submissions: {
          ...fakeRepo().submissions,
          getDetail: async () => ({ ...SUBMITTED_DETAIL, status: "crafted" as const }),
        },
        episodes: { ...fakeRepo().episodes, createPublished },
      }),
    }).request("/v1/editor/submissions/sub-1/publish", { method: "POST", body: form });

    expect(res.status).toBe(201);
    expect(createPublished).toHaveBeenCalledWith(expect.objectContaining({ audioUrl: "episodes/user-1/sub-1.m4a", audioSize: 3 }));
    expect(storagePut).toHaveBeenCalledWith("episodes/user-1/sub-1.m4a", new Uint8Array([9, 9, 9]));
  });

  // crafted 但 R2 无任何成品音频 → 明确 400 audio_key_missing（不再落入 audio_required 误报）
  it("crafted 发布但 R2 无成品音频 → 400 audio_key_missing", async () => {
    const get = vi.fn(async () => ({ data: null as unknown as Uint8Array, total: 0 }));
    const form = new FormData();
    form.append("meta", JSON.stringify({ title: "无音频发布", language: "zh" }));
    const res = await makeApp({
      storage: { put: async () => {}, get, delete: async () => {} },
      repo: fakeRepo({
        submissions: { ...fakeRepo().submissions, getDetail: async () => ({ ...SUBMITTED_DETAIL, status: "crafted" as const }) },
      }),
    }).request("/v1/editor/submissions/sub-1/publish", { method: "POST", body: form });

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "audio_key_missing" });
  });
});

describe("嘉宾与采样下载", () => {
  it("GET /v1/editor/guests 返回嘉宾列表", async () => {
    const res = await makeApp().request("/v1/editor/guests");
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ id: string; name: string }>;
    expect(list[0]).toMatchObject({ id: "claude", name: "Claude" });
  });

  it("GET /v1/editor/samples/guest/:id/audio 返回采样音频", async () => {
    const res = await makeApp().request("/v1/editor/samples/guest/claude/audio");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("audio");
  });

  it("GET /v1/editor/samples/host/:userId/audio 返回投稿人采样", async () => {
    const res = await makeApp({
      repo: fakeRepo({ episodes: { ...fakeRepo().episodes, getVoiceSample: async () => ({ userId: "user-1", language: "zh", audioUrl: "voices/user-1/zh.webm", transcript: "大家好", duration: 15, status: "ready" }) } }),
    }).request("/v1/editor/samples/host/user-1/audio");
    expect(res.status).toBe(200);
  });
});
describe("已发布节目编辑（含下架）", () => {
  it("PUT 带 isPublic=false → updatePublished 收到 isPublic: false（编辑下架）", async () => {
    const updatePublished = vi.fn(async () => {});
    const res = await makeApp({
      repo: fakeRepo({
        episodes: {
          ...fakeRepo().episodes,
          getById: async () => ({ id: "ep-1", submissionId: "sub-1", userId: "user-1", title: "第 1 期", description: null, coverUrl: null, tags: null, status: "published", number: 1, isPicked: false, createdAt: new Date(), publishedAt: new Date() }),
          updatePublished,
        },
      }),
    }).request("/v1/editor/episodes/ep-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPublic: false }),
    });
    expect(res.status).toBe(200);
    expect(updatePublished).toHaveBeenCalledWith("ep-1", { isPublic: false });
  });
});

describe("已发布节目详情（编辑端）", () => {
  it("GET /v1/editor/episodes/:id 返回节目 + 投稿 URL/称呼", async () => {
    const res = await makeApp({
      repo: fakeRepo({
        episodes: {
          ...fakeRepo().episodes,
          getById: async () => ({ id: "ep-1", submissionId: "sub-1", userId: "user-1", title: "第 1 期", description: null, coverUrl: null, tags: null, status: "published", number: 1, isPicked: false, createdAt: new Date(), publishedAt: new Date() }),
        },
        submissions: {
          ...fakeRepo().submissions,
          getDetail: async () => ({ ...SUBMITTED_DETAIL, url: "https://example.com/share/abc", callName: "Fei" }),
        },
      }),
    }).request("/v1/editor/episodes/ep-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { submissionId: string; url: string; callName: string };
    expect(body).toMatchObject({ submissionId: "sub-1", url: "https://example.com/share/abc", callName: "Fei" });
  });
});

describe("重新生成已发布节目（republish）", () => {
  it("audio 缺失 → 400", async () => {
    const res = await makeApp({
      repo: fakeRepo({ episodes: { ...fakeRepo().episodes, getById: async () => ({ id: "ep-1", submissionId: "sub-1", userId: "user-1", title: "第 1 期", description: null, coverUrl: null, tags: null, status: "published", number: 1, isPicked: false, createdAt: new Date(), publishedAt: new Date() }) } }),
    }).request("/v1/editor/episodes/ep-1/republish", { method: "POST", body: new FormData() });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "audio_required" });
  });

  it("节目不存在 → 404", async () => {
    const res = await makeApp().request("/v1/editor/episodes/nope/republish", { method: "POST", body: new FormData() });
    expect(res.status).toBe(404);
  });

  it("republish 成功：覆盖 R2 音频 + 更新 episode 行（保留 id/期号），publishedAt 刷新", async () => {
    const storagePut = vi.fn(async () => {});
    const updateEpisodeContent = vi.fn(async () => {});
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array([4, 5, 6])], { type: "audio/mpeg" }), "final.mp3");
    form.append("cover", new Blob([new Uint8Array([7])], { type: "image/jpeg" }), "cover.jpg");
    form.append("meta", JSON.stringify({ title: "重新生成后的标题", description: "新简介", tags: ["AI"], language: "zh", durationSeconds: 500 }));

    const res = await makeApp({
      storage: { put: storagePut, get: async () => ({ data: new Uint8Array(), total: 0 }), delete: async () => {} },
      repo: fakeRepo({
        episodes: {
          ...fakeRepo().episodes,
          getById: async () => ({ id: "ep-1", submissionId: "sub-1", userId: "user-1", title: "第 1 期", description: null, coverUrl: null, tags: null, status: "published", number: 3, isPicked: false, createdAt: new Date(), publishedAt: new Date() }),
          updateEpisodeContent,
        },
      }),
    }).request("/v1/editor/episodes/ep-1/republish", { method: "POST", body: form });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ episodeId: "ep-1", number: 3, status: "published" });
    // 音频/封面覆盖落 R2（同确定性 key）
    expect(storagePut).toHaveBeenCalledWith("episodes/user-1/sub-1.mp3", new Uint8Array([4, 5, 6]));
    expect(storagePut).toHaveBeenCalledWith("covers/sub-1.jpg", new Uint8Array([7]));
    // 更新 episode 行：保留 id，内容字段替换
    expect(updateEpisodeContent).toHaveBeenCalledWith("ep-1", expect.objectContaining({
      title: "重新生成后的标题",
      description: "新简介",
      tags: ["AI"],
      language: "zh",
      durationSeconds: 500,
      audioUrl: "episodes/user-1/sub-1.mp3",
    }));
  });

  it("republish 无 cover → 保留旧封面（updateCover=false 不传 coverUrl）", async () => {
    const updateEpisodeContent = vi.fn(async (_id: string, _row: Record<string, unknown>) => {});
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array([1])], { type: "audio/mpeg" }), "final.mp3");

    const res = await makeApp({
      repo: fakeRepo({
        episodes: {
          ...fakeRepo().episodes,
          getById: async () => ({ id: "ep-1", submissionId: "sub-1", userId: "user-1", title: null, description: null, coverUrl: "covers/sub-1.jpg", tags: null, status: "published", number: 1, isPicked: false, createdAt: new Date(), publishedAt: new Date() }),
          updateEpisodeContent,
        },
      }),
    }).request("/v1/editor/episodes/ep-1/republish", { method: "POST", body: form });

    expect(res.status).toBe(200);
    const call = updateEpisodeContent.mock.calls[0][1] as Record<string, unknown>;
    expect(call).not.toHaveProperty("coverUrl");
  });
});
describe("节目下线申请（用户申请 → 编辑审批）", () => {
  it("GET /v1/editor/episodes/removal-requests 缺省 pending 队列", async () => {
    const listRemovalRequests = vi.fn(async () => []);
    const res = await makeApp({
      repo: fakeRepo({ episodes: { ...fakeRepo().episodes, listRemovalRequests } }),
    }).request("/v1/editor/episodes/removal-requests");
    expect(res.status).toBe(200);
    expect(listRemovalRequests).toHaveBeenCalledWith("pending");
  });

  it("GET ?status=approved 过滤", async () => {
    const listRemovalRequests = vi.fn(async () => []);
    await makeApp({ repo: fakeRepo({ episodes: { ...fakeRepo().episodes, listRemovalRequests } }) })
      .request("/v1/editor/episodes/removal-requests?status=approved");
    expect(listRemovalRequests).toHaveBeenCalledWith("approved");
  });

  it("批准下线 → episode isPublic=false + 通知投稿人", async () => {
    const resolve = vi.fn(async () => ({ episodeId: "ep-1", userId: "user-1" }));
    const updatePublished = vi.fn(async () => {});
    const notifyCreate = vi.fn(async () => {});
    const res = await makeApp({
      repo: fakeRepo({
        episodes: { ...fakeRepo().episodes, resolveRemovalRequest: resolve, updatePublished },
        notifications: { ...fakeRepo().notifications, create: notifyCreate },
      }),
    }).request("/v1/editor/episodes/removal-requests/rr-1/approve", { method: "POST" });
    expect(res.status).toBe(200);
    expect(resolve).toHaveBeenCalledWith("rr-1", "approved", "editor-1");
    expect(updatePublished).toHaveBeenCalledWith("ep-1", { isPublic: false });
    expect(notifyCreate).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", type: "unpublished", link: "/me/episodes" }));
  });

  it("拒绝下线 → 通知投稿人，不动 isPublic", async () => {
    const resolve = vi.fn(async () => ({ episodeId: "ep-1", userId: "user-1" }));
    const updatePublished = vi.fn(async () => {});
    const notifyCreate = vi.fn(async () => {});
    const res = await makeApp({
      repo: fakeRepo({
        episodes: { ...fakeRepo().episodes, resolveRemovalRequest: resolve, updatePublished },
        notifications: { ...fakeRepo().notifications, create: notifyCreate },
      }),
    }).request("/v1/editor/episodes/removal-requests/rr-1/reject", { method: "POST" });
    expect(res.status).toBe(200);
    expect(resolve).toHaveBeenCalledWith("rr-1", "rejected", "editor-1");
    expect(updatePublished).not.toHaveBeenCalled();
    expect(notifyCreate).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", type: "unpublish_rejected", link: "/me/episodes" }));
  });

  it("申请不存在/已处理 → 404", async () => {
    const res = await makeApp({
      repo: fakeRepo({ episodes: { ...fakeRepo().episodes, resolveRemovalRequest: async () => null } }),
    }).request("/v1/editor/episodes/removal-requests/rr-x/approve", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

