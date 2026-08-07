import { describe, expect, it } from "vitest";
import { collectFromDocument } from "../../src/content/collector";
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
});
