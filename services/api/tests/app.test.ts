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

function fakeEnv(): Env {
  return {
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
  };
}

function makeApp() {
  return createApp({
    env: fakeEnv(),
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
