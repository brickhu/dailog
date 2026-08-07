import { describe, expect, it } from "vitest";
import { findScrollContainer } from "../../src/content/scroll-container";

describe("findScrollContainer（消息滚动容器探测）", () => {
  it("claude 新版（div[role='article'] 消息标记）→ 向上找到 overflow 容器", () => {
    const doc = new DOMParser().parseFromString(
      `<div id="scroller" style="overflow-y:auto">
        <div><div role="article">消息1</div><div role="article">消息2</div></div>
      </div>`,
      "text/html",
    );
    const container = findScrollContainer(doc);
    expect(container?.id).toBe("scroller"); // 真实滚动容器，不是页面级兜底
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
