import { describe, expect, it, beforeEach } from "vitest";
import { createConfirmPanel } from "../../src/content/confirm-panel";
import type { MessageNode } from "../../src/content/core";

const nodes: MessageNode[] = [
  { id: "u1", offsetTop: 0, role: "user", content: "问题一" },
  { id: "a1", offsetTop: 1, role: "assistant", content: "回答一" },
  { id: "u2", offsetTop: 2, role: "user", content: "问题二" },
];

let panel: ReturnType<typeof createConfirmPanel>;
let shadow: ShadowRoot;

function queryPanel(): ShadowRoot {
  const host = document.querySelector("[dailog-panel]")!;
  return host.shadowRoot!;
}

beforeEach(() => {
  panel = createConfirmPanel();
  panel.close();
  shadow = queryPanel();
});

describe("采集确认面板（confirm-panel，Shadow DOM 独立于页面消息 DOM）", () => {
  it("open 渲染全部消息 + 默认全选", () => {
    panel.open(nodes, { onConfirm: () => {}, onAbandon: () => {} });
    expect(panel.isOpen()).toBe(true);
    const boxes = shadow.querySelectorAll("input[type=checkbox]");
    expect(boxes.length).toBe(3);
    expect(Array.from(boxes).every((b) => (b as HTMLInputElement).checked)).toBe(true);
    expect(shadow.querySelector(".header")?.textContent).toContain("3 条消息");
  });

  it("取消勾选后确认 → 回调只含选中的消息（全量可操作，与虚拟列表无关）", () => {
    const received: MessageNode[][] = [];
    panel.open(nodes, {
      onConfirm: (sel) => { received.push(sel); },
      onAbandon: () => {},
    });
    const boxes = shadow.querySelectorAll("input[type=checkbox]");
    (boxes[1] as HTMLInputElement).checked = false; // 取消「回答一」
    (boxes[1] as HTMLInputElement).dispatchEvent(new Event("change"));
    (shadow.querySelector(".confirm") as HTMLButtonElement).click();
    expect(received[0]?.map((n) => n.content)).toEqual(["问题一", "问题二"]);
    expect(panel.isOpen()).toBe(false); // 确认后面板关闭
  });

  it("放弃 → onAbandon 回调，面板关闭", () => {
    let abandoned = false;
    panel.open(nodes, {
      onConfirm: () => {},
      onAbandon: () => { abandoned = true; },
    });
    (shadow.querySelector(".abandon") as HTMLButtonElement).click();
    expect(abandoned).toBe(true);
    expect(panel.isOpen()).toBe(false);
  });

  it("全部取消勾选 → 确认按钮禁用", () => {
    panel.open(nodes, { onConfirm: () => {}, onAbandon: () => {} });
    const boxes = shadow.querySelectorAll("input[type=checkbox]");
    boxes.forEach((b) => {
      (b as HTMLInputElement).checked = false;
      (b as HTMLInputElement).dispatchEvent(new Event("change"));
    });
    expect((shadow.querySelector(".confirm") as HTMLButtonElement).disabled).toBe(true);
  });
});
