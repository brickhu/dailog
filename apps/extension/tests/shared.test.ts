import { describe, expect, it } from "vitest";
import { isCollectedDialogue, conversationKey, conversationIdFromUrl } from "../src/shared";

describe("isCollectedDialogue", () => {
  it("accepts a valid dialogue", () => {
    expect(isCollectedDialogue({
      platform: "claude",
      conversationId: "abc-123",
      title: "测试对话",
      url: "https://claude.ai/chat/abc-123",
      messages: [
        { role: "user", content: "你好" },
        { role: "assistant", content: "你好！" },
      ],
    })).toBe(true);
  });

  it("rejects empty messages", () => {
    expect(isCollectedDialogue({
      platform: "claude",
      conversationId: "abc-123",
      title: "",
      url: "https://claude.ai/chat/abc-123",
      messages: [],
    })).toBe(false);
  });

  it("rejects unknown platform", () => {
    expect(isCollectedDialogue({
      platform: "not-a-platform",
      conversationId: "x",
      title: "",
      url: "u",
      messages: [{ role: "user", content: "hi" }],
    } as never)).toBe(false);
  });
});

describe("conversationKey（会话归一：pathname 忽略 query/hash/尾斜杠）", () => {
  it("query/hash 差异视为同一会话", () => {
    expect(conversationKey("https://claude.ai/chat/abc-123?source=web")).toBe("/chat/abc-123");
    expect(conversationKey("https://claude.ai/chat/abc-123#bottom")).toBe("/chat/abc-123");
  });

  it("去掉尾斜杠", () => {
    expect(conversationKey("https://chat.deepseek.com/chat/conv1/")).toBe("/chat/conv1");
  });

  it("非法 URL 原样返回", () => {
    expect(conversationKey("not a url")).toBe("not a url");
  });
});

describe("conversationIdFromUrl（会话 id 提取：规则 pattern / 缺省最后一段）", () => {
  it("pattern 提取（deepseek 新版 /a/chat/s/{uuid}）", () => {
    expect(
      conversationIdFromUrl(
        "https://chat.deepseek.com/a/chat/s/4c9356de-a5cd-4493-9913-791f5f286423",
        "/a/chat/s/([^/?#]+)",
      ),
    ).toBe("4c9356de-a5cd-4493-9913-791f5f286423");
  });

  it("缺省取路径最后一段（忽略 query）", () => {
    expect(conversationIdFromUrl("https://chatgpt.com/c/abc-123?source=web")).toBe("abc-123");
  });

  it("pattern 无匹配 / 非法正则 → 回退最后一段", () => {
    expect(conversationIdFromUrl("https://claude.ai/chat/uuid-1", "/nope/([a-z]+)")).toBe("uuid-1");
    expect(conversationIdFromUrl("https://claude.ai/chat/uuid-1", "([bad")).toBe("uuid-1");
  });
});
