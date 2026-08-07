import { describe, expect, it, vi } from "vitest";
import { collectFromDocument } from "../../src/content/collector";
import type { MessageNode } from "../../src/content/core";

// id 用内容本身：位置序号 id 会在历史加载后失效（同 claude 消息 id 同款问题）
const nodes = (contents: string[]): MessageNode[] =>
  contents.map((c, i) => ({ id: c, offsetTop: i * 100, role: i % 2 === 0 ? "user" : "assistant", content: c }));

describe("collectByScroll（打印式撑开优先 / 滚动保底）", () => {
  it("撑开成功 → 等渲染稳定后全量采集（不走滚动循环）", async () => {
    let expanded = false;
    const waitForMutation = vi.fn(async () => {});
    const restore = vi.fn();
    const scroll = {
      container: {} as Element,
      readNodes: async (): Promise<MessageNode[]> =>
        expanded ? nodes(["q1", "a1", "q2", "a2"]) : nodes(["q2", "a2"]),
      waitForMutation,
      expand: async () => { expanded = true; return true; },
      restore,
    };
    const d = await collectFromDocument({
      root: document,
      url: "https://chat.deepseek.com/chat/conv1",
      scroll,
    });
    expect(d?.platform).toBe("deepseek");
    expect(d?.messages.map((m) => m.content)).toEqual(["q1", "a1", "q2", "a2"]);
    expect(waitForMutation).toHaveBeenCalled(); // 撑开成功后仍有稳定等待（渲染可能分批）
    expect(restore).toHaveBeenCalled();
  });

  it("撑开无效 → 还原样式后走滚动循环补全", async () => {
    // 懒加载场景：滚动（scrollTop=0）才触发历史加载
    let historyLoaded = false;
    const container = { scrollTop: 999 } as unknown as Element;
    const scroll = {
      container,
      readNodes: async (): Promise<MessageNode[]> =>
        historyLoaded ? nodes(["q1", "a1", "q2", "a2"]) : nodes(["q2", "a2"]),
      waitForMutation: async () => { historyLoaded = true; },
      expand: async () => false, // 撑开无效
      restore: vi.fn(),
    };
    const d = await collectFromDocument({
      root: document,
      url: "https://claude.ai/chat/972b1a34-f710-4fcf-99b6-a063a03b1187",
      scroll,
    });
    expect(d?.platform).toBe("claude");
    expect(d?.messages.map((m) => m.content)).toEqual(["q1", "a1", "q2", "a2"]);
    expect(scroll.restore).toHaveBeenCalled();
  });

  it("无 expand（测试环境省略）→ 直接滚动循环", async () => {
    let historyLoaded = false;
    const container = { scrollTop: 999 } as unknown as Element;
    const scroll = {
      container,
      readNodes: async (): Promise<MessageNode[]> =>
        historyLoaded ? nodes(["q1", "a1"]) : nodes(["a1"]),
      waitForMutation: async () => { historyLoaded = true; },
    };
    const d = await collectFromDocument({
      root: document,
      url: "https://chat.deepseek.com/chat/conv1",
      scroll,
    });
    expect(d?.messages.map((m) => m.content)).toEqual(["q1", "a1"]);
  });
});
