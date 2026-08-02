import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type { ImportsRepo } from "../src/routes/imports";

function fakeImportsRepo(): ImportsRepo {
  return {
    findImportBySource: async () => null,
    insertImport: async () => ({ id: "imp-1" }),
    insertEpisode: async () => ({ id: "ep-1" }),
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
    importsRepo: fakeImportsRepo(),
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
