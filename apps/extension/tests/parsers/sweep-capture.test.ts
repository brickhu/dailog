import { describe, expect, it, vi } from "vitest";
import { createSweepCapture, findScrollContainer } from "../../src/content/sweep-capture";
import type { MessageNode } from "../../src/content/core";

// 模拟容器：scrollTop 可写，rect 恒为 {top: 0}
const mkContainer = (scrollTop: number) =>
  ({
    scrollTop,
    scrollHeight: 2800,
    clientHeight: 800,
    getBoundingClientRect: () => ({ top: 0 }),
  }) as unknown as HTMLElement;

const node = (id: string, el: HTMLElement, role: MessageNode["role"] = "user"): MessageNode => ({
  id,
  offsetTop: 0,
  role,
  content: id,
  el,
});

describe("createSweepCapture（自动自下而上截取）", () => {
  it("虚拟列表：自动逐屏向上，新窗口渲染后合并，到顶完成，顺序顶→底", async () => {
    const container = mkContainer(2000);
    const c = container as unknown as { scrollTop: number };
    // 连续窗口模型：15 条消息（间距 200px），渲染窗口 = [scrollTop-300, scrollTop+900]，
    // rect.top = 位置 - scrollTop（真实滚动语义）；scrollTop 赋值即驱动窗口上移
    const els: HTMLElement[] = [];
    for (let i = 0; i < 15; i++) {
      const el = document.createElement("div");
      el.getBoundingClientRect = (() => ({ top: i * 200 - c.scrollTop })) as unknown as typeof el.getBoundingClientRect;
      el.scrollIntoView = vi.fn() as unknown as typeof el.scrollIntoView;
      els.push(el);
    }
    const readNodes = vi.fn(async (): Promise<MessageNode[]> => {
      const st = c.scrollTop;
      const out: MessageNode[] = [];
      for (let i = 0; i < 15; i++) {
        const t = i * 200;
        if (t >= st - 300 && t <= st + 900) out.push(node(`m${i}`, els[i], i % 2 === 0 ? "user" : "assistant"));
      }
      return out;
    });
    const onProgress = vi.fn();
    const s = createSweepCapture({ readNodes, container, settleMs: 1, windowTimeoutMs: 30, onProgress });
    const r = await s.run();
    expect(r.status).toBe("done");
    // 自下而上合并（前插）→ 对话顺序顶→底，全部采到
    expect(s.nodes().map((n) => n.id)).toEqual(Array.from({ length: 15 }, (_, i) => `m${i}`));
    expect(onProgress).toHaveBeenCalledWith(15);
  });

  it("全文渲染平台（deepseek/doubao）：滚动后窗口不变 → 单步完成", async () => {
    const container = mkContainer(2000);
    const el1 = document.createElement("div");
    el1.getBoundingClientRect = (() => ({ top: 100 })) as unknown as typeof el1.getBoundingClientRect;
    el1.scrollIntoView = vi.fn() as unknown as typeof el1.scrollIntoView;
    const el2 = document.createElement("div");
    el2.getBoundingClientRect = (() => ({ top: 300 })) as unknown as typeof el2.getBoundingClientRect;
    el2.scrollIntoView = vi.fn() as unknown as typeof el2.scrollIntoView;
    // 全文渲染：任何滚动位置读到的都是全部消息（窗口永不"变化"）
    const readNodes = vi.fn(async () => [node("m1", el1), node("m2", el2)]);
    const s = createSweepCapture({ readNodes, container, settleMs: 1, windowTimeoutMs: 30 });
    const r = await s.run();
    expect(r.status).toBe("done");
    expect(s.count()).toBe(2);
  });

  it("短对话（容器不可滚）：首次截取即全量 → done", async () => {
    const container = mkContainer(0); // 已在顶部
    const el1 = document.createElement("div");
    el1.getBoundingClientRect = (() => ({ top: 100 })) as unknown as typeof el1.getBoundingClientRect;
    el1.scrollIntoView = vi.fn() as unknown as typeof el1.scrollIntoView;
    const readNodes = vi.fn(async () => [node("m1", el1)]);
    const s = createSweepCapture({ readNodes, container, settleMs: 1, windowTimeoutMs: 30 });
    const r = await s.run();
    expect(r.status).toBe("done");
    expect(s.count()).toBe(1);
  });

  it("滚动被页面拦截（scrollTop 赋值被重置但有内容）→ stuck", async () => {
    // 容器 scrollTop getter 恒 1000、setter 无效（模拟虚拟列表异步渲染重置）
    const container = {
      scrollHeight: 4000,
      clientHeight: 800,
      getBoundingClientRect: () => ({ top: 0 }),
      get scrollTop() {
        return 1000;
      },
      set scrollTop(_v: number) {
        /* 重置：赋值无效 */
      },
    } as unknown as HTMLElement;
    const el1 = document.createElement("div");
    el1.getBoundingClientRect = (() => ({ top: 100 })) as unknown as typeof el1.getBoundingClientRect;
    el1.scrollIntoView = vi.fn() as unknown as typeof el1.scrollIntoView;
    const readNodes = vi.fn(async () => [node("m1", el1)]);
    const s = createSweepCapture({ readNodes, container, settleMs: 1, windowTimeoutMs: 30 });
    const r = await s.run();
    expect(r.status).toBe("stuck");
  });

  it("abort：中途取消停止扫描", async () => {
    const container = mkContainer(2000);
    const el1 = document.createElement("div");
    el1.getBoundingClientRect = (() => ({ top: 100 })) as unknown as typeof el1.getBoundingClientRect;
    el1.scrollIntoView = vi.fn() as unknown as typeof el1.scrollIntoView;
    const readNodes = vi.fn(async () => [node("m1", el1)]);
    const s = createSweepCapture({ readNodes, container, settleMs: 1, windowTimeoutMs: 50 });
    const p = s.run();
    s.abort();
    const r = await p;
    expect(["done", "stuck"].includes(r.status)).toBe(true);
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
