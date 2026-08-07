import { describe, expect, it } from "vitest";
import { parseByRule } from "../../src/content/rule-parser";

describe("parseByRule（通用选择器解析）", () => {
  it("按 role 选择器解析（deepseek 风格 + contentSelector）", () => {
    document.body.innerHTML = `
      <div data-message-author-role="user"><div class="ds-markdown">q1</div></div>
      <div data-message-author-role="assistant"><div class="ds-markdown">a1</div></div>
    `;
    const msgs = parseByRule(document, {
      userSelector: "[data-message-author-role='user']",
      assistantSelector: "[data-message-author-role='assistant']",
      contentSelector: ".ds-markdown",
    });
    expect(msgs).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ]);
  });

  it("contentSelector 缺失回退节点自身（user 消息无 markdown 容器）", () => {
    document.body.innerHTML = `
      <article data-message-author-role="user">q1</article>
      <article data-message-author-role="assistant"><div class="markdown">a1</div></article>
    `;
    const msgs = parseByRule(document, {
      userSelector: "article[data-message-author-role='user']",
      assistantSelector: "article[data-message-author-role='assistant']",
      contentSelector: ".markdown",
    });
    expect(msgs).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ]);
  });

  it("messageSelector 限制候选集合", () => {
    document.body.innerHTML = `
      <div class="chat"><div data-role="user">q</div></div>
      <div class="other"><div data-role="user">忽略</div></div>
    `;
    const msgs = parseByRule(document, {
      messageSelector: ".chat",
      userSelector: "[data-role='user']",
      assistantSelector: "[data-role='assistant']",
    });
    expect(msgs).toEqual([{ role: "user", content: "q" }]);
  });

  it("无有效消息 → null", () => {
    document.body.innerHTML = `<div class="empty"></div>`;
    const msgs = parseByRule(document, {
      userSelector: "[data-role='user']",
      assistantSelector: "[data-role='assistant']",
    });
    expect(msgs).toBeNull();
  });

  it("空白内容跳过", () => {
    document.body.innerHTML = `
      <div data-role="user">  </div>
      <div data-role="assistant"><div class="markdown">a</div></div>
    `;
    const msgs = parseByRule(document, {
      userSelector: "[data-role='user']",
      assistantSelector: "[data-role='assistant']",
    });
    expect(msgs).toEqual([{ role: "assistant", content: "a" }]);
  });
});
