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
      url: "https://chat.deepseek.com/a/chat/s/conv1",
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
    const container = { scrollTop: 999, clientHeight: 800, scrollHeight: 2400 } as unknown as Element;
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
    const container = { scrollTop: 999, clientHeight: 800, scrollHeight: 2400 } as unknown as Element;
    const scroll = {
      container,
      readNodes: async (): Promise<MessageNode[]> =>
        historyLoaded ? nodes(["q1", "a1"]) : nodes(["a1"]),
      waitForMutation: async () => { historyLoaded = true; },
    };
    const d = await collectFromDocument({
      root: document,
      url: "https://chat.deepseek.com/a/chat/s/conv1",
      scroll,
    });
    expect(d?.messages.map((m) => m.content)).toEqual(["q1", "a1"]);
  });

  it("chatgpt（虚拟列表长对话）带 scroll 上下文 → 打印撑开/滚动采集完整消息", async () => {
    // chatgpt 无专有解析器：content.ts 注入 ruleOnlyScroll（规则选择器提取），
    // 此处验证 collectFromDocument 对非专有平台也走 collectByScroll
    let expanded = false;
    const waitForMutation = vi.fn(async () => {});
    const restore = vi.fn();
    const scroll = {
      container: {} as Element,
      readNodes: async (): Promise<MessageNode[]> =>
        expanded ? nodes(["q1", "a1", "q2", "a2", "q3", "a3"]) : nodes(["q2", "a2", "q3", "a3"]),
      waitForMutation,
      expand: async () => { expanded = true; return true; },
      restore,
    };
    const d = await collectFromDocument({
      root: document,
      url: "https://chatgpt.com/c/abc-123",
      scroll,
    });
    expect(d?.platform).toBe("chatgpt");
    expect(d?.conversationId).toBe("abc-123");
    expect(d?.messages.map((m) => m.content)).toEqual(["q1", "a1", "q2", "a2", "q3", "a3"]);
    expect(waitForMutation).toHaveBeenCalled(); // 撑开成功后仍有稳定等待
    expect(restore).toHaveBeenCalled();
  });

  it("滚动循环补发 wheel/scroll 事件（覆盖监听事件才懒加载的虚拟列表）", async () => {
    const container = document.createElement("div");
    const wheelSpy = vi.fn();
    const scrollSpy = vi.fn();
    container.addEventListener("wheel", wheelSpy);
    container.addEventListener("scroll", scrollSpy);
    let historyLoaded = false;
    const scroll = {
      container,
      readNodes: async (): Promise<MessageNode[]> =>
        historyLoaded ? nodes(["q1", "a1"]) : nodes(["a1"]),
      waitForMutation: async () => { historyLoaded = true; },
      expand: undefined, // 无打印撑开：直接走滚动循环
      restore: () => {},
    };
    const d = await collectFromDocument({
      root: document,
      url: "https://chatgpt.com/c/abc-123",
      scroll,
    });
    expect(d?.messages.map((m) => m.content)).toEqual(["q1", "a1"]);
    expect(wheelSpy).toHaveBeenCalled(); // 程序化 scrollTop 之外补派发事件
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("虚拟列表窗口化：从顶到底步进扫过全部窗口（中间段不缺失）", async () => {
    // 模拟 chatgpt 虚拟列表：只有视口窗口渲染，滚动位置决定可见消息
    const container = { scrollTop: 0, clientHeight: 800, scrollHeight: 4000 } as unknown as Element;
    const windows = [["q1", "a1"], ["q2", "a2"], ["q3", "a3"], ["q4", "a4"], ["q5", "a5"]];
    const scroll = {
      container,
      readNodes: async (): Promise<MessageNode[]> => {
        const idx = Math.min(windows.length - 1, Math.floor((container as { scrollTop: number }).scrollTop / 800));
        return windows[idx].map((c, i) => ({
          id: c,
          offsetTop: idx * 800 + i * 100,
          role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
          content: c,
        }));
      },
      waitForMutation: async () => {},
      expand: undefined,
      restore: () => {},
    };
    const d = await collectFromDocument({
      root: document,
      url: "https://chatgpt.com/c/abc-123",
      scroll,
    });
    expect(d?.messages.map((m) => m.content)).toEqual(["q1", "a1", "q2", "a2", "q3", "a3", "q4", "a4", "q5", "a5"]);
  });

  it("滚动未到底（对话超长）→ incomplete 标记", async () => {
    // scrollHeight 远大于 100 步 × 一屏：步数上限耗尽仍未到底
    const container = { scrollTop: 0, clientHeight: 800, scrollHeight: 1_000_000 } as unknown as Element;
    const scroll = {
      container,
      readNodes: async (): Promise<MessageNode[]> => nodes(["q1", "a1"]),
      waitForMutation: async () => {},
      expand: undefined,
      restore: () => {},
    };
    const d = await collectFromDocument({
      root: document,
      url: "https://chatgpt.com/c/abc-123",
      scroll,
    });
    expect(d?.incomplete).toBe(true);
    expect(d?.messages.map((m) => m.content)).toEqual(["q1", "a1"]);
  });
});
