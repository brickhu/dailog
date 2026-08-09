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
    updateSnapshotQuality: async () => {},
    markSnapshotUnreachable: async () => {},
    markSnapshotParseFailed: async () => {},
    findPolishByUserSnapshot: async () => null,
    qualityCheck: async () => ({ pass: true, language: "zh" }),
    llm: { complete: async () => "", stream: async () => "" },
  };
}
function fakePolishesDeps(): AppDeps["polishesDeps"] {
  return { getChannelActivatedAt: async () => new Date(), findPolishByUserSnapshot: async () => null, createPolish: async () => ({ id: "polish-1" }), getPolishDetail: async () => null };
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
  };
}

function fakeAuth(): AppDeps["auth"] {
  return {
    handler: async () => new Response("", { status: 404 }),
    api: { getSession: async () => ({ user: { id: "user-1" } }) },
  };
}

function makeApp(shareCollectUrl: string | null) {
  return createApp({
    env: fakeEnv(),
    auth: fakeAuth(),
    repo: fakeRepo(),
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
    importDeps: fakeImportDeps(),
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
