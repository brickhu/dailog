import { describe, expect, it, vi, afterEach } from "vitest";
import { createApiClient, ApiError } from "../api";

const TOKEN = "jwt-token";

function mockFetchOnce(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("createApiClient", () => {
  const client = createApiClient({ baseUrl: "http://localhost:8787", getToken: () => TOKEN });

  it("GET sends bearer token and parses json", async () => {
    const spy = mockFetchOnce(async (url, init) => {
      expect(String(url)).toBe("http://localhost:8787/api/me");
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
      return jsonResponse(200, { userId: "u-1" });
    });
    const out = await client.get<{ userId: string }>("/api/me");
    expect(out.userId).toBe("u-1");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("POST sends json body", async () => {
    const spy = mockFetchOnce(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ a: 1 });
      return jsonResponse(201, { id: "x" });
    });
    await client.post("/api/episodes", { a: 1 });
    expect(spy).toHaveBeenCalled();
  });

  it("throws ApiError with code on non-2xx", async () => {
    mockFetchOnce(async () => jsonResponse(422, { error: "quality_rejected", detail: "信息量不足" }));
    const err = await client.get("/api/episodes/e1/polish").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).code).toBe("quality_rejected");
    expect((err as ApiError).detail).toBe("信息量不足");
  });

  it("sends request without bearer when no token (cookie session path)", async () => {
    const anon = createApiClient({ baseUrl: "http://localhost:8787", getToken: () => null });
    const spy = mockFetchOnce(async (_url, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBeNull();
      return jsonResponse(200, { userId: "u-1" });
    });
    const out = await anon.get<{ userId: string }>("/api/me");
    expect(out.userId).toBe("u-1");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("maps 401 response to unauthorized error", async () => {
    mockFetchOnce(async () => jsonResponse(401, { error: "unauthorized" }));
    const err = await client.get("/api/me").catch((e) => e);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).code).toBe("unauthorized");
  });
});
