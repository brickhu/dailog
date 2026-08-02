import { describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "../src/app";
import type { Env } from "../src/config/env";

function fakeRepo(): AppDeps["repo"] {
  return {
    imports: {
      findImportBySource: async () => null,
      insertImport: async () => ({ id: "imp-1" }),
      insertEpisode: async () => ({ id: "ep-1" }),
      createImport: async () => ({ importId: "imp-1", episodeId: "ep-1" }),
    },
    episodes: {
      listEpisodes: async () => [],
      getEpisode: async () => null,
      saveScript: async (episodeId, version, segments) => ({ episodeId, version, segments }),
      getLatestScript: async () => null,
      getImportedDialogue: async () => null,
      setPublished: async () => {},
      getEpisodeUserId: async () => null,
      getEpisodeLanguage: async () => null,
      getHostModelId: async () => null,
      getVoiceSampleKey: async () => null,
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
    },
  };
}

function fakePolish(): AppDeps["polish"] {
  return {
    getDialogueMessages: async () => [],
    qualityCheck: async () => ({ pass: true, language: "zh" }),
    savePolished: async (_episodeId, _language, segments) => ({ version: 1, segments }),
    llm: { complete: async () => "", stream: async () => "" },
  };
}

function fakeGenerate(): AppDeps["generate"] {
  return {
    getOwnedEpisode: async () => ({ id: "ep-1" }),
    getLatestScript: async () => null,
    safetyCheck: async () => ({ pass: true }),
    getQuota: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
    consumeQuota: async () => {},
    createJob: async (episodeId) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
    enqueueJob: async () => {},
  };
}

function fakeJob(): AppDeps["job"] {
  return {
    getLatestJob: async () => null,
  };
}

function makeApp() {
  return createApp({
    env: {
      DATABASE_URL: "postgres://localhost:5432/dailogues",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_JWKS_URL: "https://example.supabase.co/auth/v1/jwks",
      PORT: 8787,
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
      DEEPSEEK_MODEL: "deepseek-chat",
      FISH_API_KEY: "",
      STORAGE_DRIVER: "fs",
      STORAGE_DIR: "./data",
    } satisfies Env,
    verifyToken: async (token: string) => {
      if (token !== "valid-token") throw new Error("invalid token");
      return { sub: "user-1" };
    },
    repo: fakeRepo(),
    polish: fakePolish(),
    generate: fakeGenerate(),
    job: fakeJob(),
  });
}

describe("auth middleware", () => {
  it("rejects missing token with 401", async () => {
    const res = await makeApp().request("/api/me");
    expect(res.status).toBe(401);
  });

  it("rejects invalid token with 401", async () => {
    const res = await makeApp().request("/api/me", {
      headers: { Authorization: "Bearer bad-token" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts valid token and exposes userId", async () => {
    const res = await makeApp().request("/api/me", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-1" });
  });
});

describe("auth middleware scheme", () => {
  it("accepts lowercase bearer scheme (RFC 6750)", async () => {
    const res = await makeApp().request("/api/me", {
      headers: { Authorization: "bearer valid-token" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-1" });
  });
});

describe("auth middleware on imports", () => {
  it("rejects POST /api/imports without token", async () => {
    const res = await makeApp().request("/api/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "claude", conversationId: "c", title: "", url: "https://claude.ai/chat/c", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
  });
});

describe("auth middleware on polish", () => {
  it("rejects POST polish without token", async () => {
    const res = await makeApp().request("/api/episodes/ep-1/polish", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
