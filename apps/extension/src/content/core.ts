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
  /** 候选滚动容器（从内到外；对全部滚动——受控虚拟列表可能重置单一容器的 scrollTop） */
  containers: HTMLElement[];
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

/**
 * 从顶到底步进滚动采集（虚拟列表——只渲染视口窗口，中间段必须被滚动
 * 经过才渲染）。策略（用户定义的滚动条用法）：
 * 1. 候选容器 = 消息滚动区全集（平台专有 + 消息祖先链 overflow + Virtuoso
 *    scroller + 页面级）——对全部候选滚动，真正的 scroller 一定在其中
 * 2. 双通道：scrollTop 直接赋值（非受控容器生效）+ scrollIntoView 原生滚动
 *   （受控虚拟列表必须响应原生滚动，scrollTop 赋值会被异步重置）
 * 3. 先滚到顶（循环上滚直到全部候选 scrollTop=0）
 * 4. 每次滚一屏，经过的区域触发虚拟列表渲染；每步读节点去重合并进内存
 * 5. 全部可滚候选到底后等待渲染稳定：连续 settleRounds 轮无新增停止
 */
export async function scrollSweep(opts: ScrollSweepOptions): Promise<MessageNode[]> {
  const { containers, readNodes, waitForMutation, onNodesRead, maxSteps = 300, settleRounds = 2, settleMs = 50 } = opts;
  const acc: MessageNode[] = [];
  const merge = (nodes: MessageNode[]): void => {
    for (const n of nodes) {
      const idx = acc.findIndex((x) => x.id === n.id);
      if (idx >= 0) acc[idx] = n; // 懒加载插入后旧读数 offsetTop 过期：用最新替换
      else acc.push(n);
    }
  };
  const viewport = Math.max(containers[0]?.clientHeight ?? 0, 400);
  const scrollables = (): HTMLElement[] => containers.filter((c) => c.scrollHeight > c.clientHeight + 4);
  const maxTopOf = (c: HTMLElement): number => Math.max(0, c.scrollHeight - c.clientHeight);
  /** 当前滚动进度（所有可滚候选的最大 scrollTop） */
  const progress = (): number => Math.max(0, ...scrollables().map((c) => c.scrollTop));
  /** 浏览器原生滚动到元素顶部（不受 isTrusted 限制——自研虚拟列表对 scrollTop
   *  赋值会异步重置，但必须响应原生滚动产生的 scroll 事件） */
  const scrollIntoViewTop = (el: Element): void => {
    try {
      el.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
    } catch {
      try {
        el.scrollIntoView();
      } catch {
        // 无 scrollIntoView 的环境（测试 mock 元素）静默
      }
    }
  };
  /** 双通道滚动：scrollTop 赋值（非受控/mock 生效）+ scrollIntoView
   *  （真实浏览器受控虚拟列表生效）；hintEl = 目标消息元素 */
  const scrollBy = async (deltaY: number, hintEl?: Element): Promise<void> => {
    for (const c of scrollables()) c.scrollTop += deltaY;
    if (hintEl) scrollIntoViewTop(hintEl);
    await new Promise((r) => setTimeout(r, settleMs));
  };
  // 到顶：反复把「当前视口第一条消息」滚到顶部（原生滚动驱动受控列表），
  // 直到位置不再上移（到顶）或达上限
  for (let i = 0; i < 50; i++) {
    const before = progress();
    const first = (await readNodes())[0]?.el;
    if (!first) break;
    await scrollBy(-viewport * 2, first);
    if (progress() >= before - 2) break; // 不再上移 = 到顶（或元素已到顶）
  }
  for (const c of containers) c.scrollTop = 0;
  let stable = 0;
  for (let step = 0; step < maxSteps; step++) {
    const before = acc.length;
    const read = await readNodes();
    onNodesRead?.(read); // 进度高亮（幂等）
    merge(read);
    const sc = scrollables();
    const atBottom = sc.length === 0 || sc.every((c) => c.scrollTop >= maxTopOf(c) - 4);
    if (atBottom && acc.length === before) {
      stable += 1;
      if (stable >= settleRounds) break; // 到底且无新增：采集完成
    } else if (atBottom) {
      stable = 0; // 到底但仍有新增（懒加载分批渲染中）：继续等待
    } else {
      stable = 0;
      // 向下步进：把「当前视口最后一条消息」滚到顶部（原生滚动驱动受控列表下移）
      const last = read[read.length - 1]?.el;
      await scrollBy(viewport, last);
    }
    await waitForMutation();
  }
  return dedupeSort(acc);
}
