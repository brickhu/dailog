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

describe("超时保护（fetch 挂起不再静默卡死）", () => {
  const client = createApiClient({ baseUrl: "http://localhost:8787", getToken: () => TOKEN });

  it("挂起的请求在默认 30s 后抛 request_timeout", async () => {
    vi.useFakeTimers();
    try {
      // 永不 resolve 的 fetch：监听 signal，abort 时 reject（模拟浏览器行为）
      const spy = mockFetchOnce((_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
      );
      const p = client.get("/api/episodes");
      const assertion = expect(p).rejects.toMatchObject({ status: 408, code: "request_timeout" });
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("timeoutMs: 0 跳过默认超时（SSE 长连接）", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const spy = mockFetchOnce((_url, init) => {
        init?.signal?.addEventListener("abort", () => { aborted = true; });
        return new Promise<Response>((_resolve, reject) => {
          // 不 resolve；用 timer 之外的方式终结：直接返回挂起，测试结束前手动结束
          setTimeout(() => reject(new Error("done")), 100);
        });
      });
      // 30s 内不超时：请求自己以 error 结束（模拟 SSE 正常结束由调用方控制）
      const p = client.request("/api/episodes/x/polish", { timeoutMs: 0 });
      await vi.advanceTimersByTimeAsync(35_000);
      await expect(p).rejects.toThrow("done");
      expect(aborted).toBe(false); // 未被超时中止
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
