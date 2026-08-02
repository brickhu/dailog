import { describe, expect, it } from "vitest";
import { collectFromDocument } from "../src/content/collector";

describe("collectFromDocument", () => {
  it("dispatches claude and returns null when no messages", async () => {
    const root = { querySelectorAll: () => [], ownerDocument: { title: "x" } } as unknown as ParentNode;
    const r = await collectFromDocument({ root, url: "https://claude.ai/chat/uuid-123" });
    expect(r).toBeNull();
  });

  it("returns null for unknown hosts", async () => {
    const root = { querySelectorAll: () => [], ownerDocument: { title: "x" } } as unknown as ParentNode;
    const r = await collectFromDocument({ root, url: "https://example.com/chat/xyz" });
    expect(r).toBeNull();
  });

  it("uses scroll loop for deepseek when scroll ctx provided", async () => {
    const root = { querySelectorAll: () => [], ownerDocument: { title: "测试 - DeepSeek" } } as unknown as ParentNode;
    const scroll = {
      container: { scrollTo: null } as unknown as Element,
      readNodes: async () => [
        { id: "m1", offsetTop: 100, role: "user" as const, content: "hi" },
        { id: "m2", offsetTop: 200, role: "assistant" as const, content: "hello" },
      ],
      waitForMutation: async () => {},
    };
    const r = await collectFromDocument({ root, url: "https://chat.deepseek.com/chat/conv1", scroll });
    expect(r?.platform).toBe("deepseek");
    expect(r?.messages.map((m) => m.content)).toEqual(["hi", "hello"]);
  });
});
