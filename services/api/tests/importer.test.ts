import { describe, expect, it, vi } from "vitest";
import { createApp, type AppDeps } from "../src/app";
import type { Env } from "../src/config/env";

// share 转发路由测试：mock 全局 fetch 模拟 importer 服务响应

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
      createJob: async (episodeId: string) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
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

function fakeImportDeps(): AppDeps["importDeps"] {
  return {
    getSnapshotByUrl: async () => null,
    createSnapshot: async (row) => ({ id: "snap-1" }),
    updateSnapshotContent: async () => {},
    markSnapshotUnreachable: async () => {},
    markSnapshotParseFailed: async () => {},
    findPolishByUserSnapshot: async () => null,
  };
}
function fakePolishesDeps(): AppDeps["polishesDeps"] {
  return { getChannelActivatedAt: async () => new Date(), findPolishByUserSnapshot: async () => null, createPolish: async () => ({ id: "polish-1" }), getPolishDetail: async () => null, listByUser: async () => [] };
}
function fakeTranscriptsDeps(): AppDeps["transcriptsDeps"] {
  return { getDialogueForPolish: async () => null, getTranscriptCount: async () => 0, getPolishLimit: async () => 5, createTranscript: async () => ({ id: "transcript-1" }), getOwnedTranscript: async () => null, updateTranscriptSegments: async () => {}, llm: { complete: async () => "", stream: async () => "" } };
}
function fakeEpisodesDeps(): AppDeps["episodesDeps"] {
  return {
    listByUser: async () => [], getOwned: async () => null, getEpisodeAudio: async () => null,
    getOwnedTranscript: async () => null, createEpisode: async () => ({ id: "ep-1" }),
    safetyCheck: async () => ({ pass: true }), getChannelActive: async () => true,
    getQuota: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }), consumeQuota: async () => {},
    createJob: async (episodeId: string) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }), enqueueJob: async () => {},
    setPublished: async () => {}, getChannelActivatedAt: async () => new Date(),
    getHostModelId: async () => null, getVoiceSampleKey: async () => null, getVoiceSample: async () => null, saveVoiceSample: async () => {},
  };
}

function fakeEnv(): Env {
  return {
    DATABASE_URL: "postgres://localhost:5432/dailog",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost:8787",
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
    SITE_BASE_URL: "https://site.dailog.fm",

  };
}

function fakeAuth(): AppDeps["auth"] {
  return {
    handler: async () => new Response("", { status: 404 }),
    api: { getSession: async () => ({ user: { id: "user-1" } }) },
  };
}

function makeApp(shareCollectUrl: string | null, importOverrides: Partial<AppDeps["importDeps"]> = {}) {
  return createApp({
    env: fakeEnv(),
    auth: fakeAuth(),
    repo: fakeRepo(),
    importDeps: { ...fakeImportDeps(), ...importOverrides },
    job: { getOwnedEpisode: async () => null, getLatestJob: async () => null },
    voice: {
      saveVoiceSample: async () => {},
      storage: { put: async () => {}, get: async () => new Uint8Array(), delete: async () => {} },
    },
    channel: {
      activateChannel: async () => ({ ok: true }),
    },
    favorites: {
      getPublishableEpisode: async () => null,
      toggleFavorite: async () => ({ favorited: true }),
      toggleLike: async () => ({ liked: true }),
      listFavorites: async () => [],
    },
    admin: {
      isAdmin: async () => false,
      createInviteCode: async () => ({ ok: true, code: "fake", expiresAt: null }),
    },
    shareCollectUrl: () => shareCollectUrl,
    polishesDeps: fakePolishesDeps(),
    transcriptsDeps: fakeTranscriptsDeps(),
    episodesDeps: fakeEpisodesDeps(),
  });
}

describe("importer 转发路由", () => {
  it("转发采集请求并透传 dialogue", async () => {
    const dialogue = {
      platform: "claude",
      conversationId: "conv-1",
      title: "测试对话",
      url: "https://claude.ai/share/abc",
      messages: [{ role: "user", content: "问" }, { role: "assistant", content: "答" }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => dialogue,
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const app = makeApp("https://importer.internal");
      const res = await app.request("/api/importer/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://claude.ai/share/abc" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as typeof dialogue;
      expect(body.platform).toBe("claude");
      expect(body.messages).toHaveLength(2);
      // 转发目标：importer /collect + 请求体透传
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe("https://importer.internal/collect");
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ url: "https://claude.ai/share/abc" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("透传 importer 错误（platform_unreachable → 502）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: "platform_unreachable", detail: { status: 403, cf: true } }),
      }),
    );
    try {
      const app = makeApp("https://importer.internal");
      const res = await app.request("/api/importer/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://claude.ai/share/abc" }),
      });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("platform_unreachable");
    } finally {
      vi.stubGlobal("fetch", undefined);
      vi.unstubAllGlobals();
    }
  });

  it("未配置 importer → 503", async () => {
    const app = makeApp(null);
    const res = await app.request("/api/importer/collect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://claude.ai/share/abc" }),
    });
    expect(res.status).toBe(503);
  });

  it("转发 /platforms 规则", async () => {
    const rules = { platforms: [{ id: "claude", label: "Claude", sharePattern: "^https?://(www\\.)?claude\\.ai/share/[0-9a-f-]+" }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => rules });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const app = makeApp("https://importer.internal");
      const res = await app.request("/api/importer/platforms");
      expect(res.status).toBe(200);
      const body = (await res.json()) as typeof rules;
      expect(body.platforms[0].id).toBe("claude");
      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toBe("https://importer.internal/platforms");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("importer 返回空内容（伪成功）→ parse_failed 且不写快照", async () => {
    const prev = process.env.IMPORTER_URL;
    process.env.IMPORTER_URL = "https://importer.internal";
    let createCalled = false;
    const app = makeApp(null, {
      createSnapshot: async () => { createCalled = true; return { id: "snap-x" }; },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          platform: "claude",
          conversationId: "c1",
          title: "t",
          url: "https://claude.ai/share/abc",
          messages: [
            { role: "user", content: "" },
            { role: "assistant", content: "" },
          ],
        }),
      }),
    );
    try {
      const res = await app.request("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://claude.ai/share/6cc0f373-72c5-4afd-a223-98471688e736" }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("parse_failed");
      expect(createCalled).toBe(false); // 解码失败不写快照
    } finally {
      if (prev === undefined) delete process.env.IMPORTER_URL; else process.env.IMPORTER_URL = prev;
      vi.unstubAllGlobals();
    }
  });

  it("非法 URL → 400", async () => {
    const app = makeApp("https://importer.internal");
    const res = await app.request("/api/importer/collect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "not-a-url" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("/api/import 规则检查（内容门槛）", () => {
  /** 已有快照（跳过 importer），直接走规则检查 */
  const snapshotDeps = (messages: { role: string; content: string }[]) => ({
    getSnapshotByUrl: async () => ({
      id: "snap-1",
      platform: "claude",
      sourceTitle: "测试对话",
      sourceConversationId: null,
      parsedDialogue: messages,
      status: "ok" as const,
      retryAfter: null,
      lastError: null,
    }),
    findPolishByUserSnapshot: async () => null,
  });
  const postImport = (app: ReturnType<typeof makeApp>) =>
    app.request("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://claude.ai/share/abc" }),
    });

  it("少于 3 轮问答 → 422 too_short", async () => {
    const app = makeApp("https://importer.internal", snapshotDeps([
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好！有什么可以帮你？" },
    ]));
    const res = await postImport(app);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("too_short");
  });

  it("总字数 < 500 即使轮数够 → 422 too_short", async () => {
    const messages: { role: string; content: string }[] = [];
    for (let i = 0; i < 3; i++) messages.push({ role: "user", content: "好的" }, { role: "assistant", content: "嗯嗯" });
    const app = makeApp("https://importer.internal", snapshotDeps(messages));
    const res = await postImport(app);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("too_short");
  });

  it("3 轮以上且 ≥ 500 字 → 200，响应不含 quality", async () => {
    const long = "这段对话讨论了某个值得做成播客的主题。".repeat(20); // 约 400 字/条
    const messages: { role: string; content: string }[] = [];
    for (let i = 0; i < 3; i++) messages.push({ role: "user", content: long }, { role: "assistant", content: long });
    const app = makeApp("https://importer.internal", snapshotDeps(messages));
    const res = await postImport(app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dialogue: { messages: unknown[] }; quality?: unknown };
    expect(body.dialogue.messages).toHaveLength(6);
    expect(body.quality).toBeUndefined(); // LLM 质量检测已移除
  });
});
