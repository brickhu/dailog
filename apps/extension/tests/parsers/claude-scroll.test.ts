import { afterEach, describe, expect, it } from "vitest";
import { collectFromDocument } from "../../src/content/collector";
import { parseClaudePage } from "../../src/content/claude";
import type { MessageNode } from "../../src/content/core";

const MSG_SELECTOR = "[data-testid='user-message'], [data-testid='assistant-message']";

afterEach(() => { document.body.innerHTML = ""; });

describe("claude 滚动采集（懒加载历史补全）", () => {
  it("首轮只有末尾两条，滚动到顶触发历史加载后完整采集", async () => {
    document.body.innerHTML = `
      <div class="scrollbar" style="overflow-y: auto; height: 400px">
        <div data-testid="user-message">q1</div>
        <div data-testid="assistant-message">a1</div>
        <div data-testid="user-message">q2</div>
        <div data-testid="assistant-message">a2</div>
      </div>
    `;
    // 模拟懒加载初始态：DOM 里只有最后两条
    const initial = [...document.querySelectorAll(MSG_SELECTOR)];
    initial[0].remove();
    initial[1].remove();

    const container = document.querySelector(".scrollbar") as HTMLDivElement;
    let historyLoaded = false;

    // jsdom 下 offsetTop 恒 0：按文档序伪造位置，验证去重排序端到端生效
    const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const idx = [...document.querySelectorAll(MSG_SELECTOR)].indexOf(this);
      return { top: idx * 100, height: 50, bottom: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };

    const scroll = {
      container,
      readNodes: async (): Promise<MessageNode[]> => parseClaudePage(document),
      waitForMutation: async () => {
        // 模拟历史消息懒加载完成：补回前两条
        if (!historyLoaded) {
          historyLoaded = true;
          container.insertAdjacentHTML(
            "afterbegin",
            `<div data-testid="user-message">q1</div><div data-testid="assistant-message">a1</div>`,
          );
        }
      },
    };

    try {
      const d = await collectFromDocument({
        root: document,
        url: "https://claude.ai/chat/972b1a34-f710-4fcf-99b6-a063a03b1187",
        scroll,
      });
      expect(d?.platform).toBe("claude");
      expect(d?.conversationId).toBe("972b1a34-f710-4fcf-99b6-a063a03b1187");
      expect(d?.messages.map((m) => m.content)).toEqual(["q1", "a1", "q2", "a2"]);
      expect(d?.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    } finally {
      Element.prototype.getBoundingClientRect = orig;
    }
  });
});
