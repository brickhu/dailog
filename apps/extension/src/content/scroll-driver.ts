// 匀速自动滚动驱动：rAF 每帧给滚动容器一个固定增量（向上滚），模拟用户按住
// 滚轮匀速滚动。虚拟列表收到密集 scroll 事件后按位置持续渲染窗口——监测模式
// 照常轮询暂存，驱动只负责"滚动"。
// 失效处理（不做无谓对抗）：
// - 位置被重置/用户向下滚（pos 变大）→ 停止 + onStall（降级手动监测）
// - 用户自己向上滚（快于驱动）→ 停止驱动，用户接管
// - 连续无进展（到顶 / 容器不可滚）→ 停止；可滚容器到顶 → onTop（自动完成）

export interface ScrollDriverOptions {
  /** 滚动容器（测试注入；缺省用消息元素向上探测） */
  container?: HTMLElement | null;
  /** 每帧滚动像素（默认 20px @60fps ≈ 1200px/s） */
  pxPerFrame?: number;
  /** 连续无进展判定阈值 ms（默认 1000） */
  stallMs?: number;
  /** 滚动失效（容器错/被重置/用户向下滚）→ 降级为手动监测 */
  onStall?: () => void;
  /** 位置到顶（自动滚完） */
  onTop?: () => void;
}

export interface ScrollDriver {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

/** 最小化滚动容器探测：优先 data-virtuoso-scroller，其次从消息元素向上找
 *  可滚动祖先（scrollHeight > clientHeight），兜底页面级滚动元素 */
export function findScrollContainer(root: ParentNode, from?: Element | null): HTMLElement | null {
  const scroller = root.querySelector?.("[data-virtuoso-scroller]");
  if (scroller instanceof HTMLElement) return scroller;
  let el: Element | null = from ?? null;
  while (el) {
    const h = el as HTMLElement;
    if (h.scrollHeight > h.clientHeight + 4) return h;
    el = el.parentElement;
  }
  const se = root.ownerDocument?.scrollingElement;
  return se instanceof HTMLElement && se.scrollHeight > se.clientHeight + 4 ? se : null;
}

export function createScrollDriver(opts: ScrollDriverOptions): ScrollDriver {
  const { container, pxPerFrame = 20, stallMs = 1000, onStall, onTop } = opts;
  let raf = 0;
  let running = false;
  let lastPos = 0;
  let stallSince = -1; // -1 = 尚未开始计时（与 ts=0 区分）

  const frame = (ts: number): void => {
    if (!running || !container) {
      stop();
      if (!container) onStall?.();
      return;
    }
    const pos = container.scrollTop;
    // 被重置 / 用户向下滚：无法对抗 → 降级
    if (pos > lastPos + 2) {
      stop();
      onStall?.();
      return;
    }
    // 用户自己向上滚（快于驱动）：用户接管，静默停止
    if (pos < lastPos - pxPerFrame - 2) {
      stop();
      return;
    }
    // 施加步进（向上滚 = scrollTop 减小）
    container.scrollTop = Math.max(0, pos - pxPerFrame);
    if (container.scrollTop === pos) {
      // 滚不动：连续 stallMs 无进展才判定（持续排帧检测）
      if (stallSince < 0) stallSince = ts;
      if (ts - stallSince >= stallMs) {
        stop();
        // 可滚容器已到顶 → 自动完成；容器本就不可滚（短对话/容器探测错）→ 手动降级
        if (container.scrollHeight > container.clientHeight + 4 && pos <= 0) onTop?.();
        else onStall?.();
        return;
      }
    } else {
      stallSince = -1;
      lastPos = container.scrollTop;
    }
    raf = requestAnimationFrame(frame);
  };

  function stop(): void {
    running = false;
    cancelAnimationFrame(raf);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastPos = container?.scrollTop ?? 0;
      stallSince = -1;
      raf = requestAnimationFrame(frame);
    },
    stop,
    isRunning: () => running,
  };
}
