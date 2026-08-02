import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCollect } from "../src/background";

function mockChrome(token: string | null) {
  const storage = { local: { get: vi.fn(async () => ({ dailoguesToken: token })) } };
  (globalThis as Record<string, unknown>).chrome = { storage };
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("handleCollect", () => {
  it("posts to /api/imports with bearer token", async () => {
    mockChrome("jwt-token");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "imp-1" }), { status: 200 }));
    (globalThis as Record<string, unknown>).fetch = fetchMock;

    const res = await handleCollect({
      platform: "claude", conversationId: "c1", title: "t", url: "https://claude.ai/chat/c1",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.dailogues.com/api/imports",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer jwt-token" }),
      }),
    );
    expect(res.ok).toBe(true);
  });

  it("returns auth error when no token", async () => {
    mockChrome(null);
    const res = await handleCollect({
      platform: "claude", conversationId: "c1", title: "t", url: "https://claude.ai/chat/c1",
      messages: [{ role: "user", content: "hi" }],
    });
    // 断言语义与 ok/error 逐条检查一致；expect 链不会收窄判别联合，故用整体 toEqual
    expect(res).toEqual({ ok: false, error: "no_token" });
  });
});
