import { describe, expect, it } from "vitest";
import { findScrollContainer } from "../../src/content/scroll-container";

describe("findScrollContainer（消息滚动容器探测）", () => {
  it("claude 新版（div[role='article'] 消息标记）→ 选祖先链中 scrollHeight 最大的 overflow 容器", () => {
    const doc = new DOMParser().parseFromString(
      `<div id="scroller" style="overflow-y:auto">
        <div><div role="article">消息1</div><div role="article">消息2</div></div>
      </div>`,
      "text/html",
    );
    const container = findScrollContainer(doc);
    expect(container?.id).toBe("scroller"); // 真实滚动容器，不是页面级兜底
  });

  it("消息内部的小 overflow 容器（代码块等）被排除——选外层最大容器", () => {
    const doc = new DOMParser().parseFromString(
      `<div id="outer" style="overflow-y:auto">
        <div data-message-author-role="user">
          <div style="overflow-y:auto"><pre>代码块</pre></div>
        </div>
        <div data-message-author-role="assistant"><div class="markdown">回答</div></div>
      </div>`,
      "text/html",
    );
    const outer = doc.getElementById("outer") as HTMLElement;
    Object.defineProperty(outer, "scrollHeight", { value: 5000, configurable: true }); // 外层最大（消息滚动区）
    const inner = doc.querySelector("div[data-message-author-role='user'] > div") as HTMLElement;
    Object.defineProperty(inner, "scrollHeight", { value: 200, configurable: true }); // 内层小容器
    expect(findScrollContainer(doc)?.id).toBe("outer");
  });

  it("deepseek 新版（.ds-message 消息标记）→ 向上找到 overflow 容器", () => {
    const doc = new DOMParser().parseFromString(
      `<div id="list" style="overflow-y:scroll">
        <div class="ds-message">消息1</div>
        <div class="ds-message">消息2</div>
      </div>`,
      "text/html",
    );
    const container = findScrollContainer(doc);
    expect(container?.id).toBe("list");
  });

  it("无消息标记 → 页面级滚动兜底（HTML）", () => {
    const doc = new DOMParser().parseFromString(
      "<html><body><div>无消息</div></body></html>",
      "text/html",
    );
    const container = findScrollContainer(doc);
    expect(container?.tagName).toBe("HTML");
  });

  it("消息标记命中优先级：claude 新旧标记同时存在时也正常", () => {
    const doc = new DOMParser().parseFromString(
      `<div id="scroller" style="overflow-y:auto">
        <div data-testid="user-message">旧结构</div>
        <div role="article">新结构</div>
      </div>`,
      "text/html",
    );
    expect(findScrollContainer(doc)?.id).toBe("scroller");
  });
});
