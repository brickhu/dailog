// 自动步进截取采集核心：蒙层接管滚动，从底部自动逐屏向上截取（自下而上——
// 避开"滚不到顶"死结，虚拟列表初始即底部）。
// 关键点：
// 1. 滚动优先 scrollIntoView 原生驱动（虚拟列表必须响应原生滚动），位置未动时
//    回退容器 scrollTop 赋值并重试（对抗列表异步渲染重置）
// 2. 每步滚动后**等待新窗口渲染**（轮询读取直到出现新内容，超时 = 全文渲染平台
//    或已取完）——杜绝"滚动后立刻截取旧窗口 → 误判到顶"
// 3. 合并前插（自下而上，新内容在已采内容上方）→ 最终顺序 = 对话顺序（顶→底）

import { mergeMessageNodes, type MessageNode } from "./core";

export interface SweepCaptureOptions {
  readNodes: () => Promise<MessageNode[]>;
  /** 滚动容器（测试注入；缺省自动探测） */
  container?: HTMLElement | null;
  /** 每步滚动/轮询等待 ms（默认 120；测试可传小值加速） */
  settleMs?: number;
  /** 滚动后等待新窗口渲染的超时 ms（默认 2000；超时未变 = 全文渲染/已取完） */
  windowTimeoutMs?: number;
  /** 步数上限（默认 500；防死循环） */
  maxSteps?: number;
  /** 截取合并后的进度回调（计数等 UI 用） */
  onProgress?: (count: number) => void;
  /** 每轮读取到的渲染消息（进度高亮反馈用） */
  onWindow?: (nodes: MessageNode[]) => void;
}

export interface SweepCapture {
  /** 自动从底部逐屏向上截取直到到顶；stuck = 滚动被页面拦截（可能未采全） */
  run(): Promise<{ status: "done" | "stuck"; count: number }>;
  abort(): void;
  count(): number;
  nodes(): MessageNode[];
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

export function createSweepCapture(opts: SweepCaptureOptions): SweepCapture {
  const { readNodes, onProgress, onWindow, settleMs = 120, windowTimeoutMs = 2000, maxSteps = 500 } = opts;
  let container = opts.container === undefined ? null : opts.container;
  const acc: MessageNode[] = [];
  let aborted = false;

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  /** 原生滚动到元素（block: start=上移 / end=滚到底部）；无 scrollIntoView 环境静默 */
  const scrollIntoView = (el: Element, block: "start" | "end" = "start"): void => {
    try {
      el.scrollIntoView({ block, behavior: "instant" as ScrollBehavior });
    } catch {
      try {
        el.scrollIntoView();
      } catch {
        // 无 scrollIntoView 环境（测试 mock 元素）静默
      }
    }
  };

  const containerScrollTop = (): number => container?.scrollTop ?? 0;

  const merge = (nodes: MessageNode[]): void => {
    const before = acc.length;
    mergeMessageNodes(acc, nodes);
    onWindow?.(nodes);
    if (acc.length !== before) onProgress?.(acc.length);
  };

  const keyOf = (n: MessageNode): string => `${n.role}\u0000${n.content}`;

  /** 与滚动前窗口相比是否出现新内容（虚拟列表渲染出新窗口的标志） */
  const differsFrom = (now: MessageNode[], pre: MessageNode[]): boolean => {
    const preKeys = new Set(pre.map(keyOf));
    return now.some((n) => !preKeys.has(keyOf(n)));
  };

  /** 滚动目标：视口内第 2 条消息（与上一步留重叠，防交界消息被跳过）；无 → null（到顶） */
  const pickTarget = (read: MessageNode[]): Element | null => {
    const top = container?.getBoundingClientRect().top ?? 0;
    const below = read.filter((n) => n.el && n.el.getBoundingClientRect().top >= top - 2);
    return below[1]?.el ?? below[0]?.el ?? null;
  };

  /** 上移一屏并校验位置真的动了（scrollIntoView 优先，回退 scrollTop 赋值重试） */
  const scrollUpVerified = async (target: Element): Promise<boolean> => {
    if (!container) container = findScrollContainer(document, target);
    const before = containerScrollTop();
    for (let i = 0; i < 6; i++) {
      if (i < 3) {
        scrollIntoView(target);
      } else if (container) {
        const delta = Math.round(target.getBoundingClientRect().top - (container.getBoundingClientRect().top ?? 0) - 8);
        if (delta > 4) container.scrollTop -= delta;
      }
      await sleep(settleMs);
      if (containerScrollTop() < before - 2) return true; // 真的上移了
    }
    return false;
  };

  /** 单步：滚动上移一屏 → 等新窗口渲染 → 合并；返回是否继续 */
  const stepOnce = async (): Promise<"continue" | "done" | "stuck"> => {
    const pre = await readNodes();
    merge(pre); // 滚动前窗口先并入（防滚动后元素被虚拟列表回收丢失）
    if (pre.length === 0) return "done";
    const target = pickTarget(pre);
    if (!target) return "done";
    const scrolled = await scrollUpVerified(target);
    if (!scrolled) {
      // 位置始终未动：容器顶部已到（或不可滚）→ done；还有内容但滚不动 → stuck
      return containerScrollTop() > 2 ? "stuck" : "done";
    }
    // 等待虚拟列表渲染出新窗口；超时未变 = 全文渲染（deepseek/doubao 全文在 DOM）或已取完
    const deadline = Date.now() + windowTimeoutMs;
    while (Date.now() < deadline && !aborted) {
      await sleep(settleMs);
      const now = await readNodes();
      if (differsFrom(now, pre)) {
        merge(now);
        return "continue";
      }
    }
    return "done";
  };

  return {
    async run() {
      if (!container) container = findScrollContainer(document);
      // 滚到底部 + 首次截取（虚拟列表初始即底部；全文渲染页面滚到最新消息）
      const init = await readNodes();
      merge(init);
      const last = init[init.length - 1]?.el;
      if (last) scrollIntoView(last, "end");
      else if (container) container.scrollTop = container.scrollHeight;
      await sleep(settleMs * 2);
      const bottom = await readNodes();
      merge(bottom);
      let steps = 0;
      while (!aborted && steps < maxSteps) {
        steps += 1;
        const r = await stepOnce();
        if (r !== "continue") return { status: r, count: acc.length };
      }
      return { status: "stuck", count: acc.length }; // 步数上限
    },
    abort: () => {
      aborted = true;
    },
    count: () => acc.length,
    nodes: () => [...acc],
  };
}
