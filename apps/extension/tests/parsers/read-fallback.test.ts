import { describe, expect, it } from "vitest";
import { applyRuleFallback } from "../../src/content/read-fallback";
import type { MessageNode } from "../../src/content/core";

const RULE = {
  userSelector: "[data-role='user']",
  assistantSelector: "[data-role='assistant']",
  contentSelector: ".body",
};

describe("applyRuleFallback（本地解析器失配 → 规则选择器兜底）", () => {
  it("本地解析器有结果 → 直接返回本地，不触发规则", () => {
    const local: MessageNode[] = [
      { id: "u1", offsetTop: 0, role: "user", content: "q1" },
      { id: "a1", offsetTop: 1, role: "assistant", content: "a1" },
    ];
    document.body.innerHTML = `<div data-role="user"><div class="body">q2</div></div>`;
    expect(applyRuleFallback(local, RULE, document)).toBe(local);
  });

  it("本地为空 + 规则存在 → 规则选择器提取（含 user/assistant 与内容容器）", () => {
    document.body.innerHTML = `
      <nav>导航</nav>
      <div data-role="user"><div class="body">q1</div></div>
      <div data-role="assistant"><div class="body">a1</div></div>
      <div data-role="user"><div class="body">q2</div></div>
      <div data-role="assistant"><div class="body">a2</div></div>
    `;
    const nodes = applyRuleFallback([], RULE, document);
    expect(nodes.map((n) => n.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(nodes.map((n) => n.content)).toEqual(["q1", "a1", "q2", "a2"]);
    expect(nodes[0].content).not.toContain("导航");
  });

  it("本地为空 + 规则缺失 → 返回空（上层继续兜底）", () => {
    document.body.innerHTML = `<div data-role="user">q</div>`;
    expect(applyRuleFallback([], null, document)).toEqual([]);
    expect(applyRuleFallback([], undefined, document)).toEqual([]);
  });

  it("本地为空 + 规则选择器不匹配 → 返回空", () => {
    document.body.innerHTML = `<article class="other">x</article>`;
    expect(applyRuleFallback([], RULE, document)).toEqual([]);
  });
});
