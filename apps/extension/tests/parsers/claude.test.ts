import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudePage } from "../../src/content/claude";

const html = readFileSync(join(import.meta.dirname, "../fixtures/claude-chat.html"), "utf-8");

describe("parseClaudePage", () => {
  it("extracts user + assistant messages in order", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nodes = parseClaudePage(doc);
    expect(nodes.map((n) => n.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(nodes[0].content).toContain("你好");
    expect(nodes[1].content).toContain("你好！");
  });

  it("extracts title from document.title", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.title).toContain("测试对话");
  });
});
