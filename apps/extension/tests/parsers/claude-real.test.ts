import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseByRule } from "../../src/content/rule-parser";
import { collectFromDocument } from "../../src/content/collector";

// claude.ai 对话页真实 DOM 采样（2026-08-07 实测校准，正文脱敏）：
// 消息作用域 div[role='article']（虚拟列表条目，aria-label="Message N of M"）；
// user 标记 data-testid='user-message'；assistant 无 data-testid ——
// 旧规则 [data-testid='assistant-message'] 在真实 DOM 失配，正文容器为
// div.font-claude-response > .standard-markdown
const html = readFileSync(join(import.meta.dirname, "../fixtures/claude-real.html"), "utf-8");

const CLAUDE_RULE = {
  messageSelector: "div[role='article']",
  userSelector: "[data-testid='user-message']",
  assistantSelector: "div.font-claude-response",
  contentSelector: ".standard-markdown",
};

describe("claude 规则（真实 DOM fixture 回归）", () => {
  it("提取 5 条消息：assistant/user 交替，按文档序", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const msgs = parseByRule(doc, CLAUDE_RULE);
    expect(msgs).not.toBeNull();
    expect(msgs?.map((m) => m.role)).toEqual([
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    // assistant 取 .standard-markdown 正文，user 回退节点自身
    expect(msgs?.[0].content).toContain("MSG_0_");
    expect(msgs?.[1].content).toContain("MSG_1_");
    expect(msgs?.[2].content).toContain("MSG_2_");
  });

  it("旧规则（assistant-message 选择器）在真实 DOM 只匹配到 user → 完整性校验失效", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const oldRule = {
      userSelector: "[data-testid='user-message']",
      assistantSelector: "[data-testid='assistant-message']",
    };
    const msgs = parseByRule(doc, oldRule);
    expect(msgs?.map((m) => m.role)).toEqual(["user", "user"]);
  });

  it("collectFromDocument 全链路：本地解析器（旧选择器）缺 assistant → 新规则兜底完整采集", async () => {
    document.body.innerHTML = html;
    const d = await collectFromDocument({
      root: document,
      url: "https://claude.ai/chat/972b1a34-f710-4fcf-99b6-a063a03b1187",
      getRules: async () => ({
        version: 3,
        platforms: { claude: CLAUDE_RULE },
      }),
    });
    expect(d).not.toBeNull();
    expect(d?.lowConfidence).toBeFalsy();
    expect(d?.messages.map((m) => m.role)).toEqual([
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });
});
