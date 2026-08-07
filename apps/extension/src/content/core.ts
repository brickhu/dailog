export interface MessageNode {
  id: string;          // 消息唯一标识（DOM id / data-message-id / 生成）
  offsetTop: number;   // 容器内排序依据
  role: "user" | "assistant";
  content: string;
  /** DOM 引用（本地解析器填充）——滚动采集进度高亮用；规则兜底节点无此字段 */
  el?: Element;
}

/** 按 id 去重、按 offsetTop 升序 */
export function dedupeSort(nodes: MessageNode[]): MessageNode[] {
  const seen = new Set<string>();
  const unique: MessageNode[] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    unique.push(n);
  }
  return unique.sort((a, b) => a.offsetTop - b.offsetTop);
}

export interface ScrollCollectOptions {
  scrollToTop: () => Promise<void>;
  readNodes: () => Promise<MessageNode[]>;
  waitForMutation: () => Promise<void>;
  maxIterations: number;
  settleRounds: number; // 连续 N 轮无新增即视为稳定
}

/**
 * 虚拟列表滚动采集循环：
 * 滚动到顶 → 读节点 → 等待新节点渲染（MutationObserver）→ 重复，
 * 连续 settleRounds 轮无新增或达 maxIterations 停止。
 * 同 id 节点用最新读取替换：懒加载把历史插到顶部后，旧读数的 offsetTop 已过期，
 * 保留旧值会导致最终排序错乱（历史消息位置在文档中更靠前）。
 */
export async function scrollCollect(opts: ScrollCollectOptions): Promise<MessageNode[]> {
  const acc: MessageNode[] = [];
  let stable = 0;
  for (let i = 0; i < opts.maxIterations; i++) {
    await opts.scrollToTop();
    const nodes = await opts.readNodes();
    const before = acc.length;
    for (const n of nodes) {
      const idx = acc.findIndex((x) => x.id === n.id);
      if (idx >= 0) acc[idx] = n;
      else acc.push(n);
    }
    if (acc.length === before) {
      stable += 1;
      if (stable >= opts.settleRounds) break;
    } else {
      stable = 0;
    }
    if (i < opts.maxIterations - 1) await opts.waitForMutation();
  }
  return dedupeSort(acc);
}

export interface ScrollSweepOptions {
  /** 消息滚动容器（可滚动区域 = 消息序列 DOM 范围） */
  container: HTMLElement;
  readNodes: () => Promise<MessageNode[]>;
  waitForMutation: () => Promise<void>;
  /** 每轮读取到节点后的回调（滚动进度高亮等 UI 用途） */
  onNodesRead?: (nodes: MessageNode[]) => void;
  /** 步数上限（防死循环；默认 300 步 × 一屏 ≈ 超长对话） */
  maxSteps?: number;
  /** 到底后连续无新增轮数即停（默认 2） */
  settleRounds?: number;
}

/**
 * 从顶到底步进滚动采集（chatgpt 等虚拟列表——只渲染视口窗口，中间段
 * 必须被滚动经过才渲染；「回顶循环」只覆盖顶部窗口会导致中间缺失）。
 * 策略（用户定义的滚动条用法）：
 * 1. 容器 = 消息滚动区（findScrollContainer 已排除不滚动容器）
 * 2. 每次滚一屏（viewport 高度）——经过的区域触发虚拟列表渲染
 * 3. 程序化 scrollTop 赋值外补发 wheel/scroll 事件（部分列表监听事件才懒加载）
 * 4. 每步读节点去重合并进内存（虚拟列表回收已滚过节点也不丢）
 * 5. 到底后等待渲染稳定（懒加载分批插入）：连续 settleRounds 轮无新增停止
 */
export async function scrollSweep(opts: ScrollSweepOptions): Promise<MessageNode[]> {
  const { container, readNodes, waitForMutation, onNodesRead, maxSteps = 300, settleRounds = 2 } = opts;
  const acc: MessageNode[] = [];
  const merge = (nodes: MessageNode[]): void => {
    for (const n of nodes) {
      const idx = acc.findIndex((x) => x.id === n.id);
      if (idx >= 0) acc[idx] = n; // 懒加载插入后旧读数 offsetTop 过期：用最新替换
      else acc.push(n);
    }
  };
  const viewport = Math.max(container.clientHeight, 400);
  const dispatchScrollEvents = (): void => {
    try {
      container.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, bubbles: true, cancelable: true }));
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
    } catch {
      // 无 dispatchEvent 的环境（测试 mock 容器）静默
    }
  };
  container.scrollTop = 0;
  dispatchScrollEvents();
  let stable = 0;
  for (let step = 0; step < maxSteps; step++) {
    const before = acc.length;
    const read = await readNodes();
    onNodesRead?.(read); // 进度高亮（幂等）
    merge(read);
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const atBottom = container.scrollTop >= maxTop - 4;
    if (atBottom && acc.length === before) {
      stable += 1;
      if (stable >= settleRounds) break; // 到底且无新增：采集完成
    } else if (atBottom) {
      stable = 0; // 到底但仍有新增（懒加载分批渲染中）：继续等待
    } else {
      stable = 0;
      container.scrollTop = Math.min(maxTop, container.scrollTop + viewport);
      dispatchScrollEvents();
    }
    await waitForMutation();
  }
  return dedupeSort(acc);
}
