import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deepseekMessageId, parseDeepSeekPage, parseDeepSeekShare } from "../../src/content/deepseek";

const html = readFileSync(join(import.meta.dirname, "../fixtures/deepseek-chat.html"), "utf-8");

describe("parseDeepSeekPage", () => {
  it("extracts messages by 新版结构（ds-message 容器 + ds-assistant-message-main-content）", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nodes = parseDeepSeekPage(doc);
    expect(nodes.map((n) => n.role)).toEqual(["user", "assistant", "user"]);
    expect(nodes[1].content).toContain("核心原则");
  });

  it("assigns stable ids from data-message-id", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ids = parseDeepSeekPage(doc).map((n) => n.id);
    expect(ids).toEqual(["m1", "m2", "m3"]);
  });
});

describe("deepseekMessageId", () => {
  it("falls back to a derived id when data-message-id missing", () => {
    const el = document.createElement("div");
    el.textContent = "fallback";
    expect(deepseekMessageId(el, 5)).toBe("gen-5");
  });
});

describe("parseDeepSeekShare（分享页 /api/v0/share/content 解析）", () => {
  it("data.biz_data.messages → dialogue（role/content，thinking_content 不并入）", () => {
    const d = {
      code: 0,
      data: {
        biz_data: {
          messages: [
            { message_id: 1, role: "user", content: "问题一", thinking_content: "思考..." },
            { message_id: 2, role: "assistant", content: "回答一", thinking_content: "推理过程" },
          ],
        },
      },
    };
    const out = parseDeepSeekShare(d, "5csqep2gdjake4h8na", "https://chat.deepseek.com/share/5csqep2gdjake4h8na");
    expect(out?.platform).toBe("deepseek");
    expect(out?.conversationId).toBe("5csqep2gdjake4h8na");
    expect(out?.messages).toEqual([
      { role: "user", content: "问题一" },
      { role: "assistant", content: "回答一" },
    ]);
    expect(out?.messages[0].content).not.toContain("思考");
  });

  it("无有效消息 / 结构缺失 → null", () => {
    expect(parseDeepSeekShare({}, "id", "url")).toBeNull();
    expect(parseDeepSeekShare({ data: { biz_data: { messages: [{ role: "system", content: "x" }] } } }, "id", "url")).toBeNull();
  });
});
