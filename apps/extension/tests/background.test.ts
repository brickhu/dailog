import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCollect, setApiBase } from "../src/background";

function mockChrome(overrides: Record<string, unknown> = {}) {
  const storage = {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const result: Record<string, unknown> = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          if (key in overrides) result[key] = overrides[key];
        }
        return result;
      }),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    },
  };
  (globalThis as Record<string, unknown>).chrome = { storage };
  return storage;
}

function collectPayload() {
  return {
    platform: "claude" as const,
    conversationId: "c1",
    title: "t",
    url: "https://claude.ai/chat/c1",
    messages: [{ role: "user" as const, content: "hi" }],
  };
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("handleCollect", () => {
  it("posts to default prod api with bearer token", async () => {
    mockChrome({ dailogToken: "jwt-token" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "imp-1" }), { status: 200 }));
    (globalThis as Record<string, unknown>).fetch = fetchMock;

    const res = await handleCollect(collectPayload());

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.dailog.fm/api/imports",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer jwt-token" }),
      }),
    );
    expect(res.ok).toBe(true);
  });

  it("透传 body.error（403 channel_not_activated）", async () => {
    mockChrome({ dailogToken: "jwt-token" });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: "channel_not_activated" }), { status: 403 }),
    );
    (globalThis as Record<string, unknown>).fetch = fetchMock;
    const res = await handleCollect(collectPayload());
    expect(res).toEqual({ ok: false, error: "channel_not_activated" });
  });

  it("posts to popup-configured api base when overridden", async () => {
    mockChrome({ dailogToken: "jwt-token", dailogApiBase: "https://api.candelbot.app" });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    (globalThis as Record<string, unknown>).fetch = fetchMock;

    await handleCollect(collectPayload());

    expect(fetchMock).toHaveBeenCalledWith("https://api.candelbot.app/api/imports", expect.anything());
  });

  it("returns auth error with loginUrl when no token", async () => {
    mockChrome();
    const res = await handleCollect(collectPayload());
    // 断言语义与 ok/error 逐条检查一致；expect 链不会收窄判别联合，故用整体 toEqual
    expect(res).toEqual({ ok: false, error: "no_token", loginUrl: "https://dailog.fm/login" });
  });
});

describe("setApiBase", () => {
  it("strips trailing slashes before saving", async () => {
    const storage = mockChrome();
    await setApiBase("https://api.candelbot.app/");
    expect(storage.local.set).toHaveBeenCalledWith({ dailogApiBase: "https://api.candelbot.app" });
  });

  it("clears override when empty", async () => {
    const storage = mockChrome();
    await setApiBase("   ");
    expect(storage.local.remove).toHaveBeenCalledWith("dailogApiBase");
    expect(storage.local.set).not.toHaveBeenCalled();
  });
});
