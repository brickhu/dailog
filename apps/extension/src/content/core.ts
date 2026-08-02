export interface MessageNode {
  id: string;          // 消息唯一标识（DOM id / data-message-id / 生成）
  offsetTop: number;   // 容器内排序依据
  role: "user" | "assistant";
  content: string;
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
 */
export async function scrollCollect(opts: ScrollCollectOptions): Promise<MessageNode[]> {
  const acc: MessageNode[] = [];
  let stable = 0;
  for (let i = 0; i < opts.maxIterations; i++) {
    await opts.scrollToTop();
    const nodes = await opts.readNodes();
    const before = acc.length;
    for (const n of nodes) {
      if (!acc.some((x) => x.id === n.id)) acc.push(n);
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
