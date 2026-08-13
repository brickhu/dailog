import { describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "../src/app";
import type { Env } from "../src/config/env";

function fakeRepo(): AppDeps["repo"] {
  return {
    notifications: {
      create: async () => {},
      listByUser: async () => [],
      unreadCount: async () => 0,
      markAllRead: async () => {},
      getEmailByUserId: async () => null,
      existsAfter: async () => false,
      existsByLink: async () => false,
    },
    guests: {
      getByPlatform: async () => null,
      list: async () => [],
      voiceSampleByLanguage: async () => null,
      voiceSampleAny: async () => null,
      upsertVoiceSample: async () => {},
      update: async () => {},
      listVoiceSamples: async () => [],
    },
    submissions: {
      create: async () => ({ id: "sub-1" }),
      findByUserUrl: async () => null,
      countPendingByUser: async () => 0,
      listByUser: async () => [],
      listQueue: async () => [],
      getDetail: async () => null,
      reject: async () => {},
      markPublished: async () => {},
    },
    episodes: {
      createPublished: async () => ({ id: "ep-1", number: 1 }),
      getPublicAudioKey: async () => null,
      getPublicCoverKey: async () => null,
      getById: async () => null,
      updatePublished: async () => {},
      listPublished: async () => [],
      listBySubmission: async () => [],
      getEpisodeUserId: async () => null,
      getVoiceSample: async () => null,
      getVoiceSampleByLanguage: async () => null,
      getVoiceSampleKey: async () => null,
      saveVoiceSample: async () => {},
      getProfile: async () => null,
      updateUserNickname: async () => {},
      updatePersona: async () => {},
      updateChannel: async () => ({ ok: true } as const),
      isUsernameTaken: async () => false,
      syncAdminRoles: async () => 0,
    },
  };
}

function fakeVoice(): AppDeps["voice"] {
  return {
    saveVoiceSample: async () => {},
    storage: { put: async () => {}, get: async () => new Uint8Array(), delete: async () => {} },
  };
}

function fakeEditor(): AppDeps["editor"] {
  return {
    repo: fakeRepo(),
    env: fakeEnv(),
    storage: { put: async () => {}, get: async () => new Uint8Array() },
    siteBaseUrl: null,
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
    voice: fakeVoice(),
    editor: fakeEditor(),
    tts: {
      repo: fakeRepo(),
      storage: { get: async () => new Uint8Array() },
      ffmpegPath: "/fake/ffmpeg",
      fish: null,
    },
    favorites: {
      getPublishableEpisode: async () => null,
      toggleFavorite: async () => ({ favorited: true }),
      toggleLike: async () => ({ liked: true }),
      listFavorites: async () => [],
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
