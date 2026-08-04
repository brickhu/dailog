import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env";

describe("loadEnv", () => {
  it("parses a valid env", () => {
    const env = loadEnv({
      DATABASE_URL: "postgres://localhost:5432/dailog",
      BETTER_AUTH_SECRET: "test-secret",
    });
    expect(env.PORT).toBe(8787);
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => loadEnv({ BETTER_AUTH_SECRET: "x" })).toThrow();
  });
});
