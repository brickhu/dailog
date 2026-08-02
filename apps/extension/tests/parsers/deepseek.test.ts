import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deepseekMessageId, parseDeepSeekPage } from "../../src/content/deepseek";

const html = readFileSync(join(import.meta.dirname, "../fixtures/deepseek-chat.html"), "utf-8");

describe("parseDeepSeekPage", () => {
  it("extracts messages by data-message-author-role", () => {
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
