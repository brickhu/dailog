import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseByRule } from "../../src/content/rule-parser";
import type { CollectRule } from "../../src/shared";

// www.doubao.com 对话页真实 DOM 采样（2026-08-07 实测校准，正文脱敏）：
// data-message-author-role 不存在；消息容器 data-target-id="message-box-target-id"，
// 角色由 data-message-id 所在 div 的 Tailwind 类区分（user=justify-end 右对齐气泡，
// assistant=grid 布局），内容容器 .md-box-root（markdown 渲染，5/5 条均命中）
const html = readFileSync(join(import.meta.dirname, "../fixtures/doubao-real.html"), "utf-8");

const DOUBAO_RULE: CollectRule = {
  userSelector: "div[data-message-id].justify-end",
  assistantSelector: "div[data-message-id].grid",
  contentSelector: ".md-box-root",
};

describe("doubao 规则（真实 DOM fixture 回归）", () => {
  it("提取 5 条消息：assistant/user 交替，角色判定正确", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const msgs = parseByRule(doc, DOUBAO_RULE);
    expect(msgs).not.toBeNull();
    expect(msgs?.map((m) => m.role)).toEqual(["assistant", "user", "assistant", "user", "assistant"]);
    // 内容来自 .md-box-root（markdown 正文，无按钮/aria 噪音）
    expect(msgs?.[0].content).toContain("MSG_");
    expect(msgs?.[1].content).toContain("MSG_");
    expect(msgs?.[1].content).not.toContain("aria");
  });

  it("旧规则（data-message-author-role）在真实 DOM 失配 → null", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const oldRule: CollectRule = {
      userSelector: "[data-message-author-role='user']",
      assistantSelector: "[data-message-author-role='assistant']",
    };
    expect(parseByRule(doc, oldRule)).toBeNull();
  });
});
