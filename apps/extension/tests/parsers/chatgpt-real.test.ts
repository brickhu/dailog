import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseByRule } from "../../src/content/rule-parser";

// 真实 chatgpt.com 分享页 DOM 片段（2026-08-07 生产实测）：
// 消息为 div[data-message-author-role]（非 article），内容容器 .markdown
const html = readFileSync(join(import.meta.dirname, "../fixtures/chatgpt-real.html"), "utf-8");

const CHATGPT_RULE = {
  userSelector: "[data-message-author-role='user']",
  assistantSelector: "[data-message-author-role='assistant']",
  contentSelector: ".markdown",
};

describe("chatgpt 规则（真实 DOM fixture 回归）", () => {
  it("提取 user + assistant 消息及内容", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const msgs = parseByRule(doc, CHATGPT_RULE);
    expect(msgs).not.toBeNull();
    expect(msgs?.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs?.[0].content).toContain("TL;DR");
    expect(msgs?.[1].content).toContain("Too Long; Didn't Read");
  });
});
