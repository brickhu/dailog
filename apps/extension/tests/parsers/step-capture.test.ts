import { describe, expect, it, vi } from "vitest";
import { createStepCapture, findScrollContainer } from "../../src/content/step-capture";
import type { MessageNode } from "../../src/content/core";

// 模拟容器：scrollTop 可写，rect 恒为 {top: 0}
const mkContainer = (scrollTop: number) =>
  ({
    scrollTop,
    scrollHeight: 4000,
    clientHeight: 800,
    getBoundingClientRect: () => ({ top: 0 }),
  }) as unknown as HTMLElement;

/** 消息元素：rect.top 依赖容器 scrollTop（模拟真实滚动后元素位置变化） */
const mkEl = (baseTop: number, container: HTMLElement): HTMLElement => {
  const el = document.createElement("div");
  const c = container as unknown as { scrollTop: number };
  el.getBoundingClientRect = (() => ({ top: baseTop - (2000 - c.scrollTop) })) as unknown as typeof el.getBoundingClientRect;
  el.scrollIntoView = vi.fn() as unknown as typeof el.scrollIntoView;
  return el;
};

const node = (id: string, el: HTMLElement): MessageNode => ({ id, offsetTop: 0, role: "user", content: id, el });

describe("createStepCapture（步进截取：自下而上）", () => {
  it("start：滚到底部（最后消息 scrollIntoView）+ 首次截取", async () => {
    const container = mkContainer(2000);
    const el1 = mkEl(100, container);
    const el2 = mkEl(300, container);
    const readNodes = vi.fn(async () => [node("m1", el1), node("m2", el2)]);
    const s = createStepCapture({ readNodes, container, settleMs: 1 });
    await s.start();
    expect(el2.scrollIntoView).toHaveBeenCalled(); // 滚到底部
    expect(s.count()).toBe(2);
    expect(s.nodes().map((n) => n.id)).toEqual(["m1", "m2"]);
  });

  it("stepUp：滚动成功 + 新窗口内容前插累积（虚拟列表自下而上）→ moved", async () => {
    const container = mkContainer(2000);
    const el1 = mkEl(100, container);
    const el2 = mkEl(300, container);
    const el0 = mkEl(-200, container); // 上方内容（初始未渲染，滚动后出现）
    const onProgress = vi.fn();
    // 模拟虚拟列表：向上滚动后（scrollTop < 1800），上方窗口渲染（el0 出现）
    const readNodes = vi.fn(async () => {
      const c = container as unknown as { scrollTop: number };
      return c.scrollTop >= 1800 ? [node("m1", el1), node("m2", el2)] : [node("m0", el0), node("m1", el1), node("m2", el2)];
    });
    const s = createStepCapture({ readNodes, container, settleMs: 1, onProgress });
    await s.start();
    expect(s.count()).toBe(2);
    const r = await s.stepUp();
    expect(r).toBe("moved");
    expect(s.count()).toBe(3);
    // 自下而上：新内容（m0）前插 → 对话顺序（顶→底）
    expect(s.nodes().map((n) => n.id)).toEqual(["m0", "m1", "m2"]);
    expect(onProgress).toHaveBeenCalledWith(3);
  });

  it("stepUp：位置动了但无新增 → 全文渲染平台早停 → top", async () => {
    const container = mkContainer(2000);
    const el1 = mkEl(100, container);
    const el2 = mkEl(300, container);
    // 全文渲染：无论滚动位置，读到的都是全部消息
    const readNodes = vi.fn(async () => [node("m1", el1), node("m2", el2)]);
    const s = createStepCapture({ readNodes, container, settleMs: 1 });
    await s.start();
    const r = await s.stepUp();
    expect(r).toBe("top");
    expect(s.count()).toBe(2);
  });

  it("stepUp：位置始终不动 + 容器不可再上滚 → 到顶 → top", async () => {
    const container = mkContainer(0); // 已在顶部
    const el1 = document.createElement("div");
    el1.getBoundingClientRect = (() => ({ top: 100 })) as unknown as typeof el1.getBoundingClientRect;
    el1.scrollIntoView = vi.fn() as unknown as typeof el1.scrollIntoView;
    const readNodes = vi.fn(async () => [node("m1", el1)]);
    const s = createStepCapture({ readNodes, container, settleMs: 1 });
    await s.start();
    const r = await s.stepUp();
    expect(r).toBe("top");
  });

  it("stepUp：滚动目标 = 视口内第 2 条（与上一步重叠防漏）", async () => {
    const container = mkContainer(2000);
    const el1 = mkEl(100, container);
    const el2 = mkEl(300, container);
    const el3 = mkEl(500, container);
    const readNodes = vi.fn(async () => [node("m1", el1), node("m2", el2), node("m3", el3)]);
    const s = createStepCapture({ readNodes, container, settleMs: 1 });
    await s.start();
    await s.stepUp();
    // 第 2 条（el2）为步进滚动目标（block:start）；第 1 条保留为重叠不滚动
    const calls = (el2.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => (c[0] as { block?: string })?.block === "start")).toBe(true);
    expect(el1.scrollIntoView).not.toHaveBeenCalled();
  });

  it("stepUp：无渲染节点 → top", async () => {
    const container = mkContainer(2000);
    const readNodes = vi.fn(async () => []);
    const s = createStepCapture({ readNodes, container, settleMs: 1 });
    await s.start();
    expect(await s.stepUp()).toBe("top");
  });
});

describe("findScrollContainer（最小容器探测）", () => {
  it("优先 data-virtuoso-scroller", () => {
    document.body.innerHTML = `<div data-virtuoso-scroller><div id="msg">x</div></div>`;
    const scroller = document.querySelector("[data-virtuoso-scroller]");
    expect(findScrollContainer(document)).toBe(scroller);
  });

  it("从消息元素向上找可滚动祖先", () => {
    document.body.innerHTML = `<div id="outer"><div id="scrollable"><div id="msg">x</div></div></div>`;
    const scrollable = document.getElementById("scrollable")!;
    Object.defineProperty(scrollable, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollable, "clientHeight", { value: 500, configurable: true });
    const msg = document.getElementById("msg")!;
    expect(findScrollContainer(document, msg)).toBe(scrollable);
  });

  it("无可滚容器 → null", () => {
    document.body.innerHTML = `<div id="msg">x</div>`;
    expect(findScrollContainer(document, document.getElementById("msg"))).toBeNull();
  });
});
