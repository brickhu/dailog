import { describe, expect, it, vi, beforeEach } from "vitest";
import { getChatgptAccessToken, fetchChatgptConversation, extractChatgptSharePage } from "../../src/content/chatgpt-api";

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

describe("extractChatgptSharePage（分享页静态 HTML 提取）", () => {
  it("按 data-message-author-role 提取消息（含嵌套文本）", () => {
    document.body.innerHTML = `
      <section data-testid="conversation-turn-1">
        <h4 class="sr-only">你说：</h4>
        <div data-message-author-role="user" data-message-id="u1">
          <div class="bubble"><div>翻译这句话：基于AI对话的知识收集平台</div></div>
        </div>
      </section>
      <section data-testid="conversation-turn-2">
        <div data-message-author-role="assistant" data-message-id="a1">
          <div class="markdown"><p>翻译：基于 AI 对话的知识收集平台</p></div>
        </div>
      </section>`;
    document.title = "翻译测试 - ChatGPT";
    const d = extractChatgptSharePage(document, "share-1", "https://chatgpt.com/share/share-1");
    expect(d?.platform).toBe("chatgpt");
    expect(d?.conversationId).toBe("share-1");
    expect(d?.title).toBe("翻译测试");
    expect(d?.messages).toEqual([
      { role: "user", content: "翻译这句话：基于AI对话的知识收集平台" },
      { role: "assistant", content: "翻译：基于 AI 对话的知识收集平台" },
    ]);
  });

  it("无消息 → null", () => {
    document.body.innerHTML = `<div>无对话内容</div>`;
    expect(extractChatgptSharePage(document, "id", "url")).toBeNull();
  });
});
