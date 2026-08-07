import { describe, expect, it } from "vitest";
import { collectFromDocument, resolvePlatform } from "../../src/content/collector";
import type { CollectRules } from "../../src/shared";

describe("collectFromDocument（远程规则 fallback）", () => {
  it("chatgpt（无专有解析器）→ 规则直接采集", async () => {
    document.body.innerHTML = `
      <article data-message-author-role="user"><p>q1</p></article>
      <article data-message-author-role="assistant"><div class="markdown">a1</div></article>
    `;
    const rules: CollectRules = {
      version: 1,
      platforms: {
        chatgpt: {
          userSelector: "article[data-message-author-role='user']",
          assistantSelector: "article[data-message-author-role='assistant']",
          contentSelector: ".markdown",
        },
      },
    };
    const d = await collectFromDocument({
      root: document,
      url: "https://chatgpt.com/c/abc-123",
      getRules: async () => rules,
    });
    expect(d?.platform).toBe("chatgpt");
    expect(d?.conversationId).toBe("abc-123");
    expect(d?.messages).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ]);
  });

  it("claude 本地解析失败 → 规则兜底", async () => {
    // URL 无会话 id → 本地解析器返回 null → 走远程规则
    document.body.innerHTML = `
      <div data-testid="user-message">q</div>
      <div data-testid="assistant-message">a</div>
    `;
    const rules: CollectRules = {
      version: 1,
      platforms: {
        claude: {
          userSelector: "[data-testid='user-message']",
          assistantSelector: "[data-testid='assistant-message']",
        },
      },
    };
    const d = await collectFromDocument({
      root: document,
      url: "https://claude.ai/chat/",
      getRules: async () => rules,
    });
    expect(d?.platform).toBe("claude");
    expect(d?.messages).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
    ]);
  });

  it("规则缺失 → 整页文本兜底（lowConfidence，含页面噪音）", async () => {
    document.body.innerHTML = `<nav>导航栏</nav><article data-message-author-role="user">q</article>`;
    const d = await collectFromDocument({
      root: document,
      url: "https://chatgpt.com/c/x",
      getRules: async () => ({ version: 1, platforms: {} }),
    });
    expect(d?.lowConfidence).toBe(true);
    expect(d?.platform).toBe("chatgpt");
    expect(d?.messages).toEqual([{ role: "user", content: "导航栏q" }]);
  });

  it("结构化结果缺助手回复（选择器失效）→ 整页文本兜底，AI 回复不丢", async () => {
    // 模拟真实 claude：助手回复无 data-testid="assistant-message"（spike 文档警告的选择器失配）
    document.body.innerHTML = `
      <div data-testid="user-message">q1</div>
      <div class="assistant-reply">a1</div>
      <div data-testid="user-message">q2</div>
      <div class="assistant-reply">a2</div>
    `;
    const d = await collectFromDocument({ root: document, url: "https://claude.ai/chat/uuid-123" });
    expect(d?.lowConfidence).toBe(true);
    expect(d?.messages[0].content).toContain("a1");
    expect(d?.messages[0].content).toContain("a2");
  });

  it("getRules 未注入（测试环境省略）→ 整页文本兜底", async () => {
    document.body.innerHTML = `<article data-message-author-role="user">q</article>`;
    const d = await collectFromDocument({ root: document, url: "https://chatgpt.com/c/x" });
    expect(d?.lowConfidence).toBe(true);
    expect(d?.messages[0].content).toBe("q");
  });

  it("内容去重：滚动采集重复读到的消息只保留一条并计数", async () => {
    document.body.innerHTML = `
      <div data-message-author-role="user"><p>q1</p></div>
      <div data-message-author-role="assistant"><div class="markdown">a1</div></div>
      <div data-message-author-role="user"><p>q1</p></div>
      <div data-message-author-role="assistant"><div class="markdown">a2</div></div>
    `;
    const rules: CollectRules = {
      version: 7,
      platforms: {
        chatgpt: {
          userSelector: "[data-message-author-role='user']",
          assistantSelector: "[data-message-author-role='assistant']",
          contentSelector: ".markdown",
        },
      },
    };
    const d = await collectFromDocument({
      root: document,
      url: "https://chatgpt.com/c/abc",
      getRules: async () => rules,
    });
    expect(d?.duplicatesRemoved).toBe(1);
    expect(d?.messages.map((m) => m.content)).toEqual(["q1", "a1", "a2"]);
  });

  it("无重复内容 → duplicatesRemoved 不设置", async () => {
    document.body.innerHTML = `
      <div data-message-author-role="user"><p>q1</p></div>
      <div data-message-author-role="assistant"><div class="markdown">a1</div></div>
    `;
    const rules: CollectRules = {
      version: 7,
      platforms: {
        chatgpt: {
          userSelector: "[data-message-author-role='user']",
          assistantSelector: "[data-message-author-role='assistant']",
          contentSelector: ".markdown",
        },
      },
    };
    const d = await collectFromDocument({
      root: document,
      url: "https://chatgpt.com/c/abc",
      getRules: async () => rules,
    });
    expect(d?.duplicatesRemoved).toBeUndefined();
    expect(d?.messages.length).toBe(2);
  });
});

describe("resolvePlatform（URL 规则数据化分发）", () => {
  it("规则 url 字段驱动分发 + 会话 id 取路径末端段（忽略 query）", async () => {
    document.body.innerHTML = `
      <div data-message-author-role="user"><p>q1</p></div>
      <div data-message-author-role="assistant"><div class="markdown">a1</div></div>
    `;
    const rules: CollectRules = {
      version: 7,
      platforms: {
        chatgpt: {
          url: { host: "chatgpt.com" },
          userSelector: "[data-message-author-role='user']",
          assistantSelector: "[data-message-author-role='assistant']",
          contentSelector: ".markdown",
        },
      },
    };
    const d = await collectFromDocument({
      root: document,
      url: "https://chatgpt.com/c/abc-123?source=web",
      getRules: async () => rules,
    });
    expect(d?.platform).toBe("chatgpt");
    expect(d?.conversationId).toBe("abc-123");
    expect(d?.messages).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ]);
  });

  it("规则无 url 字段（旧格式）→ 内置默认表兜底分发", async () => {
    document.body.innerHTML = `
      <div data-message-author-role="user">q</div>
      <div data-message-author-role="assistant"><div class="markdown">a</div></div>
    `;
    const rules: CollectRules = {
      version: 7,
      platforms: {
        chatgpt: {
          userSelector: "[data-message-author-role='user']",
          assistantSelector: "[data-message-author-role='assistant']",
          contentSelector: ".markdown",
        },
      },
    };
    const d = await collectFromDocument({
      root: document,
      url: "https://chatgpt.com/c/xyz",
      getRules: async () => rules,
    });
    expect(d?.platform).toBe("chatgpt");
    expect(d?.conversationId).toBe("xyz"); // 缺 conversationIdPattern → 取路径最后一段
  });

  it("resolvePlatform：规则 host 匹配优先，未命中回退默认表", () => {
    const rules: CollectRules = {
      version: 7,
      platforms: {
        claude: {
          url: { host: "claude.ai" },
          userSelector: "a",
          assistantSelector: "b",
        },
      },
    };
    expect(resolvePlatform(rules, "https://claude.ai/chat/uuid-1")).toBe("claude");
    expect(resolvePlatform(rules, "https://claude.ai/")).toBe("claude"); // 域名级：首页也归属 claude
    expect(resolvePlatform(rules, "https://chatgpt.com/c/x")).toBe("chatgpt"); // 默认表兜底
    expect(resolvePlatform(null, "https://chat.deepseek.com/a/chat/s/1")).toBe("deepseek");
    expect(resolvePlatform(rules, "https://example.com/x")).toBeNull();
    expect(resolvePlatform(rules, "not a url")).toBeNull();
  });
});
