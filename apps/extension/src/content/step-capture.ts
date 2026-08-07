// 步进截取采集核心：蒙层接管滚动，用户点「上」从底部逐屏向上截取。
// 虚拟列表只渲染视口窗口——每步滚动后等待渲染稳定再读取合并（内容键去重）；
// 滚动优先 scrollIntoView 原生驱动（虚拟列表必须响应原生滚动），位置未动时
// 回退容器 scrollTop 赋值并重试（对抗列表异步渲染重置 scrollTop）。

import { mergeMessageNodes, type MessageNode } from "./core";

export interface StepCaptureOptions {
  readNodes: () => Promise<MessageNode[]>;
  /** 滚动容器（测试注入；缺省自动探测） */
  container?: HTMLElement | null;
  /** 每步滚动稳定等待 ms（默认 180；测试可传小值加速） */
  settleMs?: number;
  /** 滚动位置校验重试上限（默认 8；虚拟列表异步渲染重置时对抗） */
  maxRetries?: number;
  /** 截取合并后的进度回调（计数等 UI 用） */
  onProgress?: (count: number) => void;
}

export interface StepCapture {
  /** 滚到底部并做首次截取 */
  start(): Promise<void>;
  /** 上移一屏并截取：moved=成功移动 / top=到顶或全文已取 / stuck=滚动被页面拦截 */
  stepUp(): Promise<"moved" | "top" | "stuck">;
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

export function createStepCapture(opts: StepCaptureOptions): StepCapture {
  const { readNodes, onProgress, settleMs = 180, maxRetries = 8 } = opts;
  let container = opts.container === undefined ? null : opts.container;
  const acc: MessageNode[] = [];

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  /** 原生滚动到元素（block: start=上移一屏 / end=滚到底部）；无 scrollIntoView 环境静默 */
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

  const merge = (nodes: MessageNode[]): void => {
    const before = acc.length;
    mergeMessageNodes(acc, nodes);
    if (acc.length !== before) onProgress?.(acc.length);
  };

  const capture = async (): Promise<void> => {
    merge(await readNodes());
  };

  /** 滚动目标：视口内第 2 条消息（与上一步留重叠，防交界消息被跳过）；
   *  无渲染节点 → null（到顶） */
  const pickTarget = (read: MessageNode[]): Element | null => {
    const top = container?.getBoundingClientRect().top ?? 0;
    const below = read.filter((n) => n.el && n.el.getBoundingClientRect().top >= top - 2);
    return below[1]?.el ?? below[0]?.el ?? null;
  };

  return {
    async start() {
      if (!container) container = findScrollContainer(document);
      const init = await readNodes();
      merge(init); // 当前已渲染内容先并入（全文渲染平台首次即全量）
      // 滚到底部（虚拟列表初始即底部；全文渲染页面滚到最新消息）
      const last = init[init.length - 1]?.el;
      if (last) scrollIntoView(last, "end");
      else if (container) container.scrollTop = container.scrollHeight;
      await sleep(settleMs * 2);
      await capture();
    },
    count: () => acc.length,
    nodes: () => [...acc],
    async stepUp() {
      const pre = await readNodes();
      merge(pre); // 滚动前窗口先并入（防滚动后元素被虚拟列表回收丢失）
      if (!container) container = findScrollContainer(document, pre[0]?.el);
      const target = pickTarget(pre);
      if (!target) return "top"; // 无渲染节点
      const beforeTop = target.getBoundingClientRect().top;
      let moved = false;
      for (let i = 0; i < maxRetries && !moved; i++) {
        if (i < 3) {
          // 原生滚动驱动：虚拟列表必须响应
          scrollIntoView(target);
        } else if (container) {
          // 回退：按目标到容器顶的距离做 scrollTop 赋值（对抗列表重置）
          const top = container.getBoundingClientRect().top;
          const delta = Math.round(target.getBoundingClientRect().top - top - 8);
          if (delta > 4) container.scrollTop -= delta;
        }
        await sleep(settleMs);
        const now = target.getBoundingClientRect().top;
        // 位置变化（含元素被回收 rect 归零）→ 滚动生效
        if (!Number.isFinite(now) || Math.abs(now - beforeTop) > 2) moved = true;
      }
      if (!moved) {
        // 位置始终未动：容器顶部已到（或不可滚）→ top；还有内容但滚不动 → stuck
        const canUp = container ? container.scrollTop > 2 : false;
        return canUp ? "stuck" : "top";
      }
      await sleep(settleMs); // 滚动后等待虚拟列表渲染稳定
      const before = acc.length;
      await capture();
      // 位置动了但无新增 → 全文渲染平台（deepseek/doubao 全文在 DOM）→ 已完成
      return acc.length === before ? "top" : "moved";
    },
  };
}
