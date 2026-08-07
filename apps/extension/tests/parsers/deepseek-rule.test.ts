import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseByRule } from "../../src/content/rule-parser";
import { parseDeepSeekPage } from "../../src/content/deepseek";
import type { CollectRule } from "../../src/shared";

// chat.deepseek.com 新版对话页真实 DOM 采样（2026-08-07 实测校准，正文脱敏）：
// data-message-author-role 已移除；消息容器 div.ds-message（user/assistant 共用），
// assistant 内容带语义类 ds-assistant-message-main-content，user 内容为 ds-message 直接子 div
const html = readFileSync(join(import.meta.dirname, "../fixtures/deepseek-real.html"), "utf-8");

const DEEPSEEK_RULE: CollectRule = {
  userSelector: "div.ds-message",
  assistantSelector: ".ds-assistant-message-main-content",
};

describe("deepseek 规则（新版真实 DOM fixture 回归）", () => {
  it("提取 user + assistant 消息（容器嵌套判定不双计）", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const msgs = parseByRule(doc, DEEPSEEK_RULE);
    expect(msgs).not.toBeNull();
    expect(msgs?.map((m) => m.role)).toEqual(["user", "assistant"]);
    // user 取 ds-message 自身文本（无 contentSelector），assistant 取语义类节点
    expect(msgs?.[0].content).toBe("MSG_1");
    expect(msgs?.[1].content).toContain("MSG_3");
    // assistant 不应含 user 消息文本（MSG_1 独立编号；MSG_10 等是子串干扰）
    expect(msgs?.[1].content).not.toMatch(/MSG_1[^0-9]/);
  });

  it("本地解析器 parseDeepSeekPage 同规则提取", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nodes = parseDeepSeekPage(doc);
    expect(nodes.map((n) => n.role)).toEqual(["user", "assistant"]);
    expect(nodes[1].content.length).toBeGreaterThan(0);
  });

  it("旧规则（data-message-author-role）在真实 DOM 失配 → 空", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const oldRule: CollectRule = {
      userSelector: "[data-message-author-role='user']",
      assistantSelector: "[data-message-author-role='assistant']",
      contentSelector: ".ds-markdown",
    };
    expect(parseByRule(doc, oldRule)).toBeNull();
  });
});
