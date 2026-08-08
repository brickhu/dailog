import { describe, expect, it, vi, beforeEach } from "vitest";
import { getChatgptAccessToken, fetchChatgptConversation } from "../../src/content/chatgpt-api";

describe("getChatgptAccessToken（localStorage __session）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("__session 为对象（含 accessToken）→ 取 accessToken", () => {
    localStorage.setItem("__session", JSON.stringify({ accessToken: "tok-123", user: { id: 1 } }));
    expect(getChatgptAccessToken()).toBe("tok-123");
  });

  it("__session 为纯字符串 → 直接用", () => {
    localStorage.setItem("__session", JSON.stringify("tok-abc"));
    expect(getChatgptAccessToken()).toBe("tok-abc");
  });

  it("缺失/非法 JSON → null", () => {
    expect(getChatgptAccessToken()).toBeNull();
    localStorage.setItem("__session", "not-json{");
    expect(getChatgptAccessToken()).toBeNull();
    localStorage.setItem("__session", JSON.stringify({ user: 1 }));
    expect(getChatgptAccessToken()).toBeNull();
  });
});

describe("fetchChatgptConversation（mapping 节点图 → dialogue）", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    localStorage.setItem("__session", JSON.stringify({ accessToken: "tok-1" }));
  });

  const sample = {
    title: "测试对话",
    mapping: {
      root: { message: null, children: ["m1"] },
      m1: {
        message: { author: { role: "user" }, content: { parts: ["你好"] } },
        children: ["m2"],
      },
      m2: {
        message: { author: { role: "assistant" }, content: { parts: ["你好！", "有什么可以帮你？"] } },
        children: ["m3"],
      },
      m3: {
        message: { author: { role: "user" }, content: { parts: ["再见"] } },
        children: [],
      },
    },
  };

  it("DFS 遍历 mapping → 消息按对话顺序，parts 拼接", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => sample,
    } as unknown as Response);
    const d = await fetchChatgptConversation("abc-123");
    expect(d?.platform).toBe("chatgpt");
    expect(d?.conversationId).toBe("abc-123");
    expect(d?.title).toBe("测试对话");
    expect(d?.messages).toEqual([
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好！\n\n有什么可以帮你？" },
      { role: "user", content: "再见" },
    ]);
  });

  it("跳过 system/tool 节点，无有效消息 → null", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        mapping: {
          root: { children: ["m1"] },
          m1: { message: { author: { role: "system" }, content: { parts: ["sys"] } }, children: [] },
        },
      }),
    } as unknown as Response);
    expect(await fetchChatgptConversation("abc-123")).toBeNull();
  });

  it("无 token / HTTP 失败 / 无 mapping → null", async () => {
    localStorage.clear();
    expect(await fetchChatgptConversation("abc-123")).toBeNull();
    localStorage.setItem("__session", JSON.stringify({ accessToken: "tok-1" }));
    vi.mocked(fetch).mockResolvedValue({ ok: false } as unknown as Response);
    expect(await fetchChatgptConversation("abc-123")).toBeNull();
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ title: "x" }) } as unknown as Response);
    expect(await fetchChatgptConversation("abc-123")).toBeNull();
  });
});
