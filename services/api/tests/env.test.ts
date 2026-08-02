import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env";

describe("loadEnv", () => {
  it("parses a valid env", () => {
    const env = loadEnv({
      DATABASE_URL: "postgres://localhost:5432/dailogues",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_JWKS_URL: "https://example.supabase.co/auth/v1/jwks",
    });
    expect(env.PORT).toBe(8787);
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => loadEnv({ SUPABASE_URL: "https://x" })).toThrow();
  });
});
