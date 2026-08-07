import { describe, expect, it } from "vitest";
import { isConversationUrl, isConversationPage } from "../../src/content/conversation-page";

describe("isConversationUrl（规则 1+2：路径 ≥2 段 + 末端 ID，忽略 query）", () => {
  it("各平台对话页（含域名 3 级+）→ true", () => {
    expect(isConversationUrl("https://claude.ai/chat/uuid-123")).toBe(true);
    expect(isConversationUrl("https://claude.ai/chat/972b1a34-f710-4fcf-99b6-a063a03b1187")).toBe(true);
    expect(isConversationUrl("https://chat.deepseek.com/a/chat/s/4c9356de-a5cd-4493-9913-791f5f286423")).toBe(true);
    expect(isConversationUrl("https://chatgpt.com/c/abc-123")).toBe(true);
    expect(isConversationUrl("https://kimi.moonshot.cn/chat/xyz789")).toBe(true);
    expect(isConversationUrl("https://www.doubao.com/chat/xyz789")).toBe(true);
    expect(isConversationUrl("https://gemini.google.com/app/abc123def456")).toBe(true);
  });

  it("query 参数不影响末端 ID 判定（只看 pathname）", () => {
    expect(isConversationUrl("https://claude.ai/chat/uuid-1?source=web&x=1")).toBe(true);
    expect(isConversationUrl("https://chat.deepseek.com/a/chat/s/4c9356de-a5cd-4493-9913-791f5f286423?tab=1")).toBe(true);
  });

  it("首页/登录页/新建页（含域名 <3 级）→ false", () => {
    expect(isConversationUrl("https://claude.ai/")).toBe(false);
    expect(isConversationUrl("https://chat.deepseek.com/")).toBe(false);
    expect(isConversationUrl("https://chat.deepseek.com/sign_in")).toBe(false); // 1 段
    expect(isConversationUrl("https://www.doubao.com/chat/")).toBe(false); // 豆包新建页 1 段
  });

  it("≥2 段但末端非 ID（语义 slug）→ false", () => {
    expect(isConversationUrl("https://claude.ai/recents")).toBe(false);
    expect(isConversationUrl("https://claude.ai/projects")).toBe(false);
    expect(isConversationUrl("https://chat.deepseek.com/settings")).toBe(false);
    expect(isConversationUrl("https://www.doubao.com/chat/new")).toBe(false); // 新建页带 slug
  });

  it("非法 URL → false", () => {
    expect(isConversationUrl("not a url")).toBe(false);
  });
});

describe("isConversationPage（规则 3：URL 通过后还必须有对话输入框）", () => {
  it("URL 通过 + 有 textarea → true", () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><textarea placeholder="发消息…"></textarea></body></html>',
      "text/html",
    );
    expect(isConversationPage("https://claude.ai/chat/uuid-1", doc)).toBe(true);
    expect(isConversationPage("https://chat.deepseek.com/a/chat/s/abc-123", doc)).toBe(true);
  });

  it("URL 通过 + 有 contenteditable → true", () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><div contenteditable="true"></div></body></html>',
      "text/html",
    );
    expect(isConversationPage("https://chatgpt.com/c/abc-123", doc)).toBe(true);
  });

  it("URL 通过但无输入框（静态页末端像 ID）→ false", () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><article>文章内容</article></body></html>',
      "text/html",
    );
    expect(isConversationPage("https://example.com/blog/post-123", doc)).toBe(false);
  });

  it("URL 不通过（新建页/登录页）→ false，不查输入框", () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><textarea placeholder="发消息…"></textarea></body></html>',
      "text/html",
    );
    expect(isConversationPage("https://www.doubao.com/chat/", doc)).toBe(false); // 新建页
    expect(isConversationPage("https://chat.deepseek.com/sign_in", doc)).toBe(false); // 登录页
    expect(isConversationPage("https://claude.ai/", doc)).toBe(false); // 首页
  });

  it("URL 不通过、无 root → false", () => {
    expect(isConversationPage("https://example.com/")).toBe(false);
  });
});
