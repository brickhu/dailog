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
  /** 滚动位置稳定等待的轮询间隔 ms（默认 50；测试可传小值加速） */
  settleMs?: number;
}

/** 等滚动位置稳定：受控虚拟列表（Virtuoso/v_list 等）异步响应 wheel 事件，
 *  位置更新有延迟——轮询到不再变化为止 */
async function settleScroll(el: HTMLElement, settleMs: number): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const before = el.scrollTop;
    await new Promise((r) => setTimeout(r, settleMs));
    if (el.scrollTop === before) return;
  }
}

/**
 * 从顶到底步进滚动采集（虚拟列表——只渲染视口窗口，中间段必须被滚动
 * 经过才渲染）。策略（用户定义的滚动条用法）：
 * 1. 容器 = 消息滚动区（findScrollContainer 已排除不滚动容器）
 * 2. 双通道滚动：scrollTop 直接赋值（非受控容器生效）+ wheel 事件
 *    （受控虚拟列表如 Virtuoso 会重置 scrollTop 赋值、只响应 wheel——
 *    合成 wheel 的默认滚动被禁用，但受控列表自己处理事件不检查 isTrusted）
 * 3. 先滚到顶（wheel 上滚循环——受控列表 scrollTop=0 赋值无效）
 * 4. 每次滚一屏，经过的区域触发虚拟列表渲染；每步读节点去重合并进内存
 * 5. 到底后等待渲染稳定（懒加载分批插入）：连续 settleRounds 轮无新增停止
 */
export async function scrollSweep(opts: ScrollSweepOptions): Promise<MessageNode[]> {
  const { container, readNodes, waitForMutation, onNodesRead, maxSteps = 300, settleRounds = 2, settleMs = 50 } = opts;
  const acc: MessageNode[] = [];
  const merge = (nodes: MessageNode[]): void => {
    for (const n of nodes) {
      const idx = acc.findIndex((x) => x.id === n.id);
      if (idx >= 0) acc[idx] = n; // 懒加载插入后旧读数 offsetTop 过期：用最新替换
      else acc.push(n);
    }
  };
  const viewport = Math.max(container.clientHeight, 400);
  /** 双通道滚动一屏：直接赋值 + wheel 事件（受控/非受控容器都覆盖），
   *  然后等位置稳定（受控列表异步响应） */
  const scrollBy = async (deltaY: number): Promise<void> => {
    container.scrollTop += deltaY;
    try {
      container.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));
    } catch {
      // 无 dispatchEvent 的环境（测试 mock 容器）静默
    }
    await settleScroll(container, settleMs);
  };
  // 到顶：受控列表 scrollTop=0 赋值会被框架重置——wheel 上滚循环（大步）直到顶部
  for (let i = 0; i < 30 && container.scrollTop > 0; i++) {
    await scrollBy(-viewport * 2);
  }
  container.scrollTop = 0;
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
      await scrollBy(Math.min(maxTop - container.scrollTop, viewport));
    }
    await waitForMutation();
  }
  return dedupeSort(acc);
}
