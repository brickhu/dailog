// @vitest-environment happy-dom
// auth-api 使用 localStorage 持久化 token
import { describe, expect, it, vi, afterEach } from "vitest";
import { authApi, TOKEN_KEY } from "../auth-api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetchOnce(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const USER = { id: "user-1", email: "a@b.co", name: "A" };

describe("authApi.signUp", () => {
  it("posts inviteCode and persists token", async () => {
    mockFetchOnce(async (url, init) => {
      expect(String(url)).toContain("/api/auth/sign-up/email");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ email: "a@b.co", password: "pw123456", inviteCode: "inv-1" });
      return jsonResponse(200, { token: "t1", user: USER });
    });
    const out = await authApi.signUp({ email: "a@b.co", password: "pw123456", name: "A", inviteCode: "inv-1" });
    expect(out.token).toBe("t1");
    expect(localStorage.getItem(TOKEN_KEY)).toBe("t1");
  });
});

describe("authApi.signIn", () => {
  it("persists token from sign-in response", async () => {
    mockFetchOnce(async () => jsonResponse(200, { token: "t2", user: USER }));
    await authApi.signIn({ email: "a@b.co", password: "pw123456" });
    expect(localStorage.getItem(TOKEN_KEY)).toBe("t2");
  });
});

describe("authApi.getSession", () => {
  it("uses bearer token and returns user", async () => {
    mockFetchOnce(async (_url, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer t3");
      return jsonResponse(200, { user: USER });
    });
    const user = await authApi.getSession("t3");
    expect(user?.id).toBe("user-1");
  });

  it("returns null on 401", async () => {
    mockFetchOnce(async () => jsonResponse(401, { message: "unauthorized" }));
    expect(await authApi.getSession("bad")).toBeNull();
  });
});

describe("authApi.signOut", () => {
  it("calls sign-out and clears persisted token", async () => {
    localStorage.setItem(TOKEN_KEY, "t4");
    mockFetchOnce(async (_url, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer t4");
      return jsonResponse(200, {});
    });
    await authApi.signOut("t4");
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe("authApi error mapping", () => {
  it("surfaces better-auth error message (invalid_invite_code)", async () => {
    mockFetchOnce(async () => jsonResponse(400, { message: "invalid_invite_code" }));
    const err = await authApi.signUp({ email: "x@y.z", password: "pw123456", name: "X", inviteCode: "bad" }).catch((e) => e);
    expect((err as Error).message).toBe("invalid_invite_code");
  });
});
