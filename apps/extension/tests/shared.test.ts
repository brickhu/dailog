import { describe, expect, it } from "vitest";
import { isCollectedDialogue } from "../src/shared";

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
