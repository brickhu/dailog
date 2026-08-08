import { describe, expect, it, vi } from "vitest";
import { createApp, type AppDeps } from "../src/app";
import type { Env } from "../src/config/env";
import type { ScriptSegment } from "../src/routes/polish";

// share 转发路由测试：mock 全局 fetch 模拟 share-collect 服务响应

function fakeRepo(): AppDeps["repo"] {
  return {
    imports: {
      getChannelActivatedAt: async () => new Date(),
      findImportBySource: async () => null,
      insertImport: async () => ({ id: "imp-1" }),
      insertEpisode: async () => ({ id: "ep-1" }),
      createImport: async () => ({ importId: "imp-1", episodeId: "ep-1" }),
    },
    episodes: {
      listEpisodes: async () => [],
      getEpisode: async () => null,
      saveScript: async (episodeId: string, version: number, segments: ScriptSegment[]) => ({ episodeId, version, segments }),
      getLatestScript: async () => null,
      getImportedDialogue: async () => null,
      getPublishedDialogue: async () => null,
      setPublished: async () => {},
      setEpisodeLanguage: async () => {},
      getEpisodeUserId: async () => null,
      getEpisodeLanguage: async () => null,
      getHostModelId: async () => null,
      getVoiceSampleKey: async () => null,
      getPolishCount: async () => 0,
      incrementPolishCount: async () => {},
      saveVoiceSample: async () => {},
      getVoiceSample: async () => null,
      getEpisodeAudio: async () => null,
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
    polish: {
      getDialogueMessages: async () => [],
      qualityCheck: async () => ({ pass: true, language: "zh" }),
      savePolished: async (_episodeId: string, _language: string, segments: unknown[]) => ({ version: 1, segments }),
      getPolishCount: async () => 0,
      getPolishLimit: async () => 5,
      llm: { complete: async () => "", stream: async () => "" },
    },
    generate: {
      getOwnedEpisode: async () => ({ id: "ep-1" }),
      getLatestScript: async () => null,
      safetyCheck: async () => ({ pass: true }),
      getChannelActive: async () => true,
      getQuota: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
      consumeQuota: async () => {},
      createJob: async (episodeId: string) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
      enqueueJob: async () => {},
    },
    job: { getOwnedEpisode: async () => null, getLatestJob: async () => null },
    voice: {
      saveVoiceSample: async () => {},
      storage: { put: async () => {}, get: async () => new Uint8Array(), delete: async () => {} },
    },
    channel: {
      getChannel: async () => null,
      activateChannel: async () => ({ ok: true }),
      regenerateInvite: async () => ({ code: "INVITE-1" }),
    },
    favorites: {
      getPublishableEpisode: async () => null,
      toggleFavorite: async () => ({ favorited: true }),
      toggleLike: async () => ({ liked: true }),
      listFavorites: async () => [],
    },
    token: { create: async () => ({ token: "tok-1" }), list: async () => [], revoke: async () => {} },
    admin: {
      isAdmin: async () => false,
      createInviteCode: async () => ({ ok: true, code: "fake", expiresAt: null }),
    },
    shareCollectUrl: () => shareCollectUrl,
  } as AppDeps);
}

describe("share 转发路由", () => {
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
      const app = makeApp("https://share-collect.internal");
      const res = await app.request("/api/share/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://claude.ai/share/abc" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as typeof dialogue;
      expect(body.platform).toBe("claude");
      expect(body.messages).toHaveLength(2);
      // 转发目标：share-collect /collect + 请求体透传
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe("https://share-collect.internal/collect");
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ url: "https://claude.ai/share/abc" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("透传 share-collect 错误（platform_unreachable → 502）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: "platform_unreachable", detail: { status: 403, cf: true } }),
      }),
    );
    try {
      const app = makeApp("https://share-collect.internal");
      const res = await app.request("/api/share/collect", {
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

  it("未配置 share-collect → 503", async () => {
    const app = makeApp(null);
    const res = await app.request("/api/share/collect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://claude.ai/share/abc" }),
    });
    expect(res.status).toBe(503);
  });

  it("非法 URL → 400", async () => {
    const app = makeApp("https://share-collect.internal");
    const res = await app.request("/api/share/collect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "not-a-url" }),
    });
    expect(res.status).toBe(400);
  });
});
