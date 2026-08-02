import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";

function makeApp() {
  return createApp({
    env: {
      DATABASE_URL: "postgres://localhost:5432/dailogues",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_JWKS_URL: "https://example.supabase.co/auth/v1/jwks",
      PORT: 8787,
    } satisfies Env,
    verifyToken: async (token: string) => {
      if (token !== "valid-token") throw new Error("invalid token");
      return { sub: "user-1" };
    },
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
