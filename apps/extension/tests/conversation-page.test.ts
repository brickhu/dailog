import { describe, expect, it } from "vitest";
import { isConversationPage } from "../src/content/conversation-page";

describe("isConversationPage（对话页判定：默认表 + 规则覆盖）", () => {
  it("默认表：平台对话页 true、首页/非对话路径 false", () => {
    expect(isConversationPage("https://claude.ai/chat/abc")).toBe(true);
    expect(isConversationPage("https://claude.ai/")).toBe(false);
    expect(isConversationPage("https://chat.deepseek.com/chat/conv1")).toBe(true);
    expect(isConversationPage("https://chat.deepseek.com/")).toBe(false);
    expect(isConversationPage("https://chatgpt.com/c/abc")).toBe(true);
    expect(isConversationPage("https://chatgpt.com/")).toBe(false);
    expect(isConversationPage("https://kimi.moonshot.cn/chat/x")).toBe(true);
    expect(isConversationPage("https://www.doubao.com/chat/x")).toBe(true);
    expect(isConversationPage("https://gemini.google.com/app/x")).toBe(true);
  });

  it("默认表：无条目平台（tongyi 全站、未知域名）注入即显示", () => {
    expect(isConversationPage("https://www.tongyi.com/any/path")).toBe(true);
    expect(isConversationPage("https://example.com/")).toBe(true);
  });

  it("规则 url.conversationPath 优先于默认表", () => {
    const rule = {
      userSelector: "a",
      assistantSelector: "b",
      url: { host: "claude.ai", conversationPath: "/custom/" },
    };
    expect(isConversationPage("https://claude.ai/custom/x", rule)).toBe(true);
    expect(isConversationPage("https://claude.ai/chat/x", rule)).toBe(false);
  });

  it("规则缺省 conversationPath → 回退默认表", () => {
    const rule = {
      userSelector: "a",
      assistantSelector: "b",
      url: { host: "claude.ai" },
    };
    expect(isConversationPage("https://claude.ai/chat/x", rule)).toBe(true);
    expect(isConversationPage("https://claude.ai/", rule)).toBe(false);
  });
});
