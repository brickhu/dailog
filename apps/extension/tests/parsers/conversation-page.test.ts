import { describe, expect, it } from "vitest";
import { isConversationUrl, isConversationPage } from "../../src/content/conversation-page";

describe("isConversationUrl（URL 启发式：路径 ≥2 段 + 末端 ID 形态）", () => {
  it("各平台对话页 → true", () => {
    expect(isConversationUrl("https://claude.ai/chat/uuid-123")).toBe(true);
    expect(isConversationUrl("https://claude.ai/chat/972b1a34-f710-4fcf-99b6-a063a03b1187")).toBe(true);
    expect(isConversationUrl("https://chat.deepseek.com/a/chat/s/4c9356de-a5cd-4493-9913-791f5f286423")).toBe(true);
    expect(isConversationUrl("https://chatgpt.com/c/abc-123")).toBe(true);
    expect(isConversationUrl("https://kimi.moonshot.cn/chat/xyz789")).toBe(true);
    expect(isConversationUrl("https://www.doubao.com/chat/xyz789")).toBe(true);
    expect(isConversationUrl("https://gemini.google.com/app/abc123def456")).toBe(true);
  });

  it("首页/登录页/列表页 → false（无 ID 末端段）", () => {
    expect(isConversationUrl("https://claude.ai/")).toBe(false);
    expect(isConversationUrl("https://claude.ai/recents")).toBe(false);
    expect(isConversationUrl("https://chat.deepseek.com/sign_in")).toBe(false);
    expect(isConversationUrl("https://chat.deepseek.com/")).toBe(false);
    expect(isConversationUrl("https://chatgpt.com/")).toBe(false);
    expect(isConversationUrl("https://example.com/settings")).toBe(false);
  });

  it("非法 URL → false", () => {
    expect(isConversationUrl("not a url")).toBe(false);
  });
});

describe("isConversationPage（URL 启发式 OR DOM 对话框兜底）", () => {
  it("URL 启发式通过 → true（不查 DOM）", () => {
    const doc = new DOMParser().parseFromString("<html><body></body></html>", "text/html");
    expect(isConversationPage("https://claude.ai/chat/uuid-1", doc)).toBe(true);
  });

  it("URL 不通过但 DOM 有输入框 + 消息区（deepseek 新版标记）→ true", () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><textarea placeholder="发消息…"></textarea><div class="ds-message"><div>对话内容</div></div></body></html>',
      "text/html",
    );
    expect(isConversationPage("https://chat.deepseek.com/", doc)).toBe(true);
  });

  it("URL 不通过但 DOM 有输入框 + 消息区（chatgpt 标记）→ true", () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><textarea></textarea><div data-message-author-role="user">q</div></body></html>',
      "text/html",
    );
    expect(isConversationPage("https://chatgpt.com/", doc)).toBe(true);
  });

  it("URL 不通过、只有输入框无消息（豆包新建对话页）→ false", () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><div class="composer"><textarea placeholder="发消息…"></textarea></div></body></html>',
      "text/html",
    );
    expect(isConversationPage("https://www.doubao.com/chat/", doc)).toBe(false);
  });

  it("URL 不通过、有消息区但无输入框 → false", () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><div class="ds-message"><div>历史消息</div></div></body></html>',
      "text/html",
    );
    expect(isConversationPage("https://chat.deepseek.com/", doc)).toBe(false);
  });

  it("URL 不通过、DOM 无对话框（登录页 input 不算）→ false", () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><input type="email" placeholder="邮箱"></body></html>',
      "text/html",
    );
    expect(isConversationPage("https://chat.deepseek.com/sign_in", doc)).toBe(false);
  });

  it("URL 不通过、无 root → false", () => {
    expect(isConversationPage("https://example.com/")).toBe(false);
  });
});
