import { describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "../src/app";
import type { Env } from "../src/config/env";

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
      updateHostName: async () => {},
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
      getByTranscript: async () => null,
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
      createJob: async (episodeId) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
      getLatestJob: async () => null,
      getOwnedEpisode: async () => ({ id: "ep-1" }),
      listRecoverableJobs: async () => [],
      markJobProgress: async () => {},
      markJobDone: async () => {},
      updateEpisodeAudio: async () => {},
      markJobFailed: async () => {},
    },
  };
}



function fakeJob(): AppDeps["job"] {
  return {
    getOwnedEpisode: async () => ({ id: "ep-1" }),
    getLatestJob: async () => null,
  };
}

function fakeVoice(): AppDeps["voice"] {
  return {
    saveVoiceSample: async () => {},
    storage: { put: async () => {}, get: async () => new Uint8Array(), delete: async () => {} },
  };
}

function fakeImportDeps(): AppDeps["importDeps"] {
  return {
    getSnapshotByUrl: async () => null,
    createSnapshot: async (row) => ({ id: "snap-1", platform: row.platform, sourceTitle: row.sourceTitle, sourceConversationId: row.sourceConversationId, parsedDialogue: row.parsedDialogue, quality: null, status: "ok", retryAfter: null, lastError: null }),
    updateSnapshotContent: async () => {},
    markSnapshotUnreachable: async () => {},
    markSnapshotParseFailed: async () => {},
    findPolishByUserSnapshot: async () => null,
  };
}
function fakePolishesDeps(): AppDeps["polishesDeps"] {
  return {
    getChannelActivatedAt: async () => new Date(),
    findPolishByUserSnapshot: async () => null,
    updateHostName: async () => {},
    createPolish: async () => ({ id: "polish-1" }),
    getPolishDetail: async () => null,
      listByUser: async () => [],
  };
}
function fakeTranscriptsDeps(): AppDeps["transcriptsDeps"] {
  return {
    getDialogueForPolish: async () => null,
    getTranscriptCount: async () => 0,
    getPolishLimit: async () => 5,
    createTranscript: async () => ({ id: "transcript-1" }),
    getOwnedTranscript: async () => null,
    updateTranscriptSegments: async () => {},
    llm: { complete: async () => "", stream: async () => "" },
  };
}
function fakeEpisodesDeps(): AppDeps["episodesDeps"] {
  return {
    listByUser: async () => [],
    getOwned: async () => null,
    getEpisodeAudio: async () => null,
    getOwnedTranscript: async () => null,
    getEpisodeByTranscript: async () => null,
    createEpisode: async () => ({ id: "ep-1" }),
    safetyCheck: async () => ({ pass: true }),
    getChannelActive: async () => true,
    getQuota: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
    consumeQuota: async () => {},
    createJob: async (episodeId: string) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
    enqueueJob: async () => {},
    setPublished: async () => {},
    getChannelActivatedAt: async () => new Date(),
    getHostModelId: async () => null,
    getVoiceSampleKey: async () => null,
    getVoiceSample: async () => null,
    saveVoiceSample: async () => {},
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

function makeApp(envOverride: Partial<Env> = {}) {
  return createApp({
    env: { ...fakeEnv(), ...envOverride },
    auth: fakeAuth(),
    repo: fakeRepo(),
    importDeps: fakeImportDeps(),
    polishesDeps: fakePolishesDeps(),
    transcriptsDeps: fakeTranscriptsDeps(),
    episodesDeps: fakeEpisodesDeps(),
    job: fakeJob(),
    voice: fakeVoice(),
    channel: { activateChannel: async () => ({ ok: true }) },
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
  });
}

describe("CORS", () => {
  const app = makeApp({ APP_ORIGINS: "http://localhost:5173,https://app.dailog.fm" });

  it("answers OPTIONS preflight with allow headers for whitelisted origin", async () => {
    const res = await app.request("/v1/me", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });

  it("sets allow-origin on actual requests from whitelisted origin", async () => {
    const res = await app.request("/health", { headers: { Origin: "https://app.dailog.fm" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.dailog.fm");
  });

  it("includes Allow-Credentials for whitelisted origin (SSO cookie)", async () => {
    const res = await app.request("/health", { headers: { Origin: "https://app.dailog.fm" } });
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("does not add CORS headers for unknown origin", async () => {
    const res = await app.request("/health", { headers: { Origin: "https://evil.example.com" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("no CORS headers when origins list empty", async () => {
    const app2 = makeApp({ APP_ORIGINS: "" });
    const res = await app2.request("/health", { headers: { Origin: "http://localhost:5173" } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("health", () => {
  it("returns ok", async () => {
    const res = await makeApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("error handling", () => {
  it("returns json 404 for unknown routes", async () => {
    const res = await makeApp().request("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
