import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createScrollDriver, findScrollContainer } from "../../src/content/scroll-driver";

let rafCb: FrameRequestCallback | null = null;

/** 手动驱动 rAF 帧（每步只触发一帧，避免循环） */
const frame = (ts: number): void => {
  const cb = rafCb;
  rafCb = null;
  cb?.(ts);
};

beforeEach(() => {
  rafCb = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCb = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    rafCb = null;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const mkContainer = (scrollTop: number, scrollHeight = 2000, clientHeight = 800) =>
  ({ scrollTop, scrollHeight, clientHeight }) as unknown as HTMLElement;

describe("createScrollDriver（匀速自动向上滚动）", () => {
  it("每帧按固定步长向上滚动（scrollTop 递减）", () => {
    const container = mkContainer(1000);
    const d = createScrollDriver({ container, pxPerFrame: 20, stallMs: 100 });
    d.start();
    frame(16);
    expect(container.scrollTop).toBe(980);
    frame(32);
    expect(container.scrollTop).toBe(960);
    d.stop();
    expect(d.isRunning()).toBe(false);
  });

  it("到顶（可滚容器 scrollTop 到 0）→ onTop", () => {
    const container = mkContainer(20);
    const onTop = vi.fn();
    const onStall = vi.fn();
    const d = createScrollDriver({ container, pxPerFrame: 20, stallMs: 100, onTop, onStall });
    d.start();
    frame(0); // 20 → 0
    frame(100); // 开始 stall 计时
    frame(200); // 计时满 100ms → 到顶
    expect(onTop).toHaveBeenCalledTimes(1);
    expect(onStall).not.toHaveBeenCalled();
    expect(d.isRunning()).toBe(false);
  });

  it("容器不可滚（短对话/探测错）→ onStall 降级手动", () => {
    const container = mkContainer(0, 800, 800); // scrollHeight === clientHeight
    const onTop = vi.fn();
    const onStall = vi.fn();
    const d = createScrollDriver({ container, pxPerFrame: 20, stallMs: 100, onTop, onStall });
    d.start();
    frame(0);
    frame(100);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(onTop).not.toHaveBeenCalled();
  });

  it("位置被重置（pos 变大）→ onStall，不硬撑", () => {
    // 模拟虚拟列表重置：scrollTop getter 恒 1500，赋值无效
    const container = {
      scrollHeight: 3000,
      clientHeight: 800,
      get scrollTop() {
        return 1500;
      },
      set scrollTop(_v: number) {
        /* 重置 */
      },
    } as unknown as HTMLElement;
    const onStall = vi.fn();
    const d = createScrollDriver({ container, pxPerFrame: 20, stallMs: 100, onStall });
    d.start();
    frame(0);
    frame(100);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(d.isRunning()).toBe(false);
  });

  it("用户自己向上滚（快于驱动）→ 静默停止，用户接管", () => {
    const container = mkContainer(1000);
    const onStall = vi.fn();
    const d = createScrollDriver({ container, pxPerFrame: 20, stallMs: 100, onStall });
    d.start();
    frame(16); // 1000 → 980
    container.scrollTop = 500; // 用户快速上滚
    frame(32);
    expect(d.isRunning()).toBe(false); // 停止驱动
    expect(onStall).not.toHaveBeenCalled(); // 不提示降级（用户在滚）
  });

  it("无容器 → 立即 onStall", () => {
    const onStall = vi.fn();
    const d = createScrollDriver({ container: null, onStall });
    d.start();
    frame(0);
    expect(onStall).toHaveBeenCalled();
  });
});

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
