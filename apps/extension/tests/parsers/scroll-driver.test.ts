import { describe, expect, it } from "vitest";
import { findScrollContainer } from "../../src/content/scroll-driver";

describe("findScrollContainer（最小容器探测）", () => {
  it("优先 data-virtuoso-scroller", () => {
    document.body.innerHTML = `<div data-virtuoso-scroller><div id="msg">x</div></div>`;
    expect(findScrollContainer(document)).toBe(document.querySelector("[data-virtuoso-scroller]"));
  });

  it("从消息元素向上找可滚动祖先", () => {
    document.body.innerHTML = `<div id="outer"><div id="scrollable"><div id="msg">x</div></div></div>`;
    const scrollable = document.getElementById("scrollable")!;
    Object.defineProperty(scrollable, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollable, "clientHeight", { value: 500, configurable: true });
    expect(findScrollContainer(document, document.getElementById("msg"))).toBe(scrollable);
  });

  it("无可滚容器 → null", () => {
    document.body.innerHTML = `<div id="msg">x</div>`;
    expect(findScrollContainer(document, document.getElementById("msg"))).toBeNull();
  });
});
