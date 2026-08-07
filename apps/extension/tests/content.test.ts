import { describe, expect, it } from "vitest";
import { collectFromDocument } from "../src/content/collector";

describe("collectFromDocument（静态 one-shot 采集）", () => {
  it("dispatches claude and returns null when no messages", async () => {
    const root = {
      querySelectorAll: () => [],
      ownerDocument: { title: "x" },
      cloneNode: () => ({ querySelectorAll: () => [], textContent: "" }),
    } as unknown as ParentNode;
    const r = await collectFromDocument({ root, url: "https://claude.ai/chat/uuid-123" });
    expect(r).toBeNull();
  });

  it("returns null for unknown hosts", async () => {
    const root = { querySelectorAll: () => [], ownerDocument: { title: "x" } } as unknown as ParentNode;
    const r = await collectFromDocument({ root, url: "https://example.com/chat/xyz" });
    expect(r).toBeNull();
  });

  it("collects deepseek via static parser (full-render platforms need no scrolling)", async () => {
    const root = {
      querySelectorAll: () => [],
      ownerDocument: { title: "测试 - DeepSeek" },
      cloneNode: () => ({ querySelectorAll: () => [], textContent: "正文内容" }),
    } as unknown as ParentNode;
    const r = await collectFromDocument({ root, url: "https://chat.deepseek.com/a/chat/s/conv1" });
    // 无消息 → 落入整页文本兜底（lowConfidence），conversationId 仍可解析
    expect(r).not.toBeNull();
    expect(r?.conversationId).toBe("conv1");
    expect(r?.lowConfidence).toBe(true);
  });
});
