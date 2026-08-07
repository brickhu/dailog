import type { CollectedDialogue, CollectRule, CollectRules, Platform } from "../shared";
import { collectClaude, parseClaudePage } from "./claude";
import { collectDeepSeek, parseDeepSeekPage } from "./deepseek";
import { scrollSweep, dedupeSort, type MessageNode } from "./core";
import { extractTitle } from "./title";
import { parseByRuleWithEl } from "./rule-parser";
import { extractPageText } from "./page-text";
import { conversationIdFromUrl } from "../shared";

export interface CollectContext {
  root: ParentNode;
  url: string;
  scroll?: {
    container: Element;
    readNodes: () => Promise<MessageNode[]>;
    waitForMutation: () => Promise<void>;
    /** 采集结束清理（如清除滚动进度高亮） */
    restore?: () => void;
    /** 每轮读取到消息节点后的回调（滚动采集进度高亮等 UI 用途） */
    onNodesRead?: (nodes: MessageNode[]) => void;
    /** 滚动位置稳定等待轮询间隔 ms（默认 50；测试可传小值加速） */
    settleMs?: number;
  };
  /** 采集失败时拉取远程规则兜底（content.ts 注入；测试环境可省略） */
  getRules?: () => Promise<CollectRules | null>;
  /** 采集完成（内容去重后）回调最终节点集（带 el 引用）——确认态勾选框用；
   *  整页文本兜底（lowConfidence）无节点不回调 */
  onCollected?: (nodes: MessageNode[]) => void;
}

/** 平台 URL 默认表（远程规则缺失/未覆盖时兜底；域名级匹配）。
 *  规则数据化的 fallback——CDN 规则里的 url.host 优先于本表；
 *  对话页判定已通用化（启发式 + DOM），此处只管 host → 平台分发 */
const DEFAULT_PLATFORM_HOSTS: ReadonlyArray<{ host: string; platform: Platform }> = [
  { host: "claude.ai", platform: "claude" },
  { host: "chat.deepseek.com", platform: "deepseek" },
  { host: "chatgpt.com", platform: "chatgpt" },
  { host: "www.doubao.com", platform: "doubao" },
  { host: "gemini.google.com", platform: "gemini" },
  { host: "kimi.moonshot.cn", platform: "kimi" },
  { host: "www.tongyi.com", platform: "tongyi" },
];

/** 按 URL 解析平台：远程规则 url.host 域名匹配优先，无命中回退默认表；非法 URL → null */
export function resolvePlatform(rules: CollectRules | null | undefined, url: string): Platform | null {
  let hostname = "";
  try {
    ({ hostname } = new URL(url));
  } catch {
    return null;
  }
  if (rules) {
    for (const [platform, rule] of Object.entries(rules.platforms)) {
      if (rule?.url?.host === hostname) return platform as Platform;
    }
  }
  return DEFAULT_PLATFORM_HOSTS.find(({ host }) => host === hostname)?.platform ?? null;
}

/** 远程规则兜底采集：规则缺失 / 无有效消息 → null（带 el 节点，确认态可用） */
async function collectByRemoteRule(
  ctx: CollectContext,
  platform: Platform,
  rules?: CollectRules | null,
): Promise<{ dialogue: CollectedDialogue; nodes: MessageNode[] } | null> {
  const rule = rules?.platforms?.[platform] ?? (await ctx.getRules?.())?.platforms?.[platform];
  if (!rule) return null;
  const msgs = parseByRuleWithEl(ctx.root, rule);
  if (!msgs) return null;
  const nodes: MessageNode[] = msgs.map((m, i) => ({
    id: `rule-${i}`,
    offsetTop: i,
    role: m.role,
    content: m.content,
    el: m.el,
  }));
  const conversationId = conversationIdFromUrl(ctx.url, rule.url?.conversationIdPattern);
  if (!conversationId) return null;
  const messages = msgs.map(({ role, content }) => ({ role, content }));
  const title = extractTitle(ctx.root, messages);
  return { dialogue: { platform, conversationId, title, url: ctx.url, messages }, nodes };
}

/** 虚拟列表/懒加载平台采集：统一滚动扫描（从顶到底步进，见 scrollSweep）。
 *  conversationId 按规则 url.conversationIdPattern 提取（缺省取路径最后一段） */
async function collectByScroll(
  ctx: CollectContext,
  platform: Platform,
  rule: CollectRule | undefined,
): Promise<{ dialogue: CollectedDialogue; nodes: MessageNode[] } | null> {
  const scroll = ctx.scroll!;
  const onRead = (nodes: MessageNode[]): void => {
    scroll.onNodesRead?.(nodes); // 进度高亮等 UI 回调（幂等）
  };
  // 统一采集方式（所有平台一致）：从顶到底步进滚动扫描——
  // 虚拟列表只渲染视口窗口，滚动经过的区域才渲染；事件触发与到底稳定等待内置于 scrollSweep
  const nodes = await scrollSweep({
    container: scroll.container as HTMLElement,
    readNodes: scroll.readNodes,
    waitForMutation: scroll.waitForMutation,
    onNodesRead: onRead,
    settleMs: scroll.settleMs,
  });
  // 未滚到底（步数上限耗尽）→ 可能未采全（对话过长）
  const el = scroll.container as HTMLElement;
  const maxTop = Math.max(0, (el.scrollHeight ?? 0) - (el.clientHeight ?? 0));
  const incomplete = el.scrollTop < maxTop - 4;
  scroll.restore?.();
  if (nodes.length === 0) return null;
  const conversationId = conversationIdFromUrl(ctx.url, rule?.url?.conversationIdPattern);
  if (!conversationId) return null;
  const messages = nodes.map(({ role, content }) => ({ role, content }));
  const title = extractTitle(ctx.root, messages);
  return {
    dialogue: { platform, conversationId, title, url: ctx.url, messages, ...(incomplete ? { incomplete: true } : {}) },
    nodes,
  };
}

/** 最终兜底：整页文本采集（结构化解析 + 远程规则全失败时；低置信度由确认页提示） */
function collectPageText(ctx: CollectContext, platform: Platform | null): CollectedDialogue | null {
  const p = platform ?? "plain";
  const conversationId = conversationIdFromUrl(ctx.url);
  if (!conversationId) return null;
  const text = extractPageText(ctx.root);
  if (!text) return null;
  const messages = [{ role: "user" as const, content: text }];
  const title = extractTitle(ctx.root, messages);
  return { platform: p, conversationId, title, url: ctx.url, messages, lowConfidence: true };
}

/** 按 URL 分发到平台采集器；链路：平台解析（滚动扫描）→ 远程规则 → 整页文本兜底。
 *  平台判定由远程规则 url.host 驱动，规则缺失回退内置默认表。
 *  结构化结果缺助手回复（助手选择器失效等，如 claude 无 data-testid="assistant-message"）→
 *  视为不完整，落到整页文本兜底。
 *  采集完成（去重后）通过 onCollected 回调带 el 的最终节点集（确认态勾选框用） */
export async function collectFromDocument(ctx: CollectContext): Promise<CollectedDialogue | null> {
  const { root, url } = ctx;
  const rules = (await ctx.getRules?.()) ?? null;
  const platform = resolvePlatform(rules, url);
  if (!platform) return null; // 未知主机：不采集（与规则/默认表均无匹配的 URL 无关）
  let d: CollectedDialogue | null = null;
  let nodes: MessageNode[] = [];
  if (platform === "claude") {
    if (ctx.scroll) {
      const r = await collectByScroll(ctx, "claude", rules?.platforms.claude);
      d = r?.dialogue ?? null;
      nodes = r?.nodes ?? [];
    } else {
      d = collectClaude(root, url);
      nodes = d ? parseClaudePage(root) : [];
    }
    // 本地解析结果缺助手回复/失败（新版 DOM 无 data-testid="assistant-message"，
    // 只匹配到 user 也算「部分成功」）→ 仍尝试远程规则补齐
    if (!d || !d.messages.some((m) => m.role === "assistant")) {
      const rr = await collectByRemoteRule(ctx, "claude", rules);
      if (rr) {
        d = rr.dialogue;
        nodes = rr.nodes;
      }
    }
  } else if (platform === "deepseek") {
    if (ctx.scroll) {
      const r = await collectByScroll(ctx, "deepseek", rules?.platforms.deepseek);
      d = r?.dialogue ?? null;
      nodes = r?.nodes ?? [];
    } else {
      d = collectDeepSeek(root, url);
      nodes = d ? parseDeepSeekPage(root) : [];
    }
    // 本地解析失败 → 远程规则补齐
    if (!d) {
      const rr = await collectByRemoteRule(ctx, "deepseek", rules);
      if (rr) {
        d = rr.dialogue;
        nodes = rr.nodes;
      }
    }
  } else if (platform) {
    // 其余平台（chatgpt 等）：有 scroll 上下文 → 滚动扫描；否则规则静态解析
    const r = ctx.scroll
      ? await collectByScroll(ctx, platform, rules?.platforms[platform])
      : await collectByRemoteRule(ctx, platform, rules);
    d = r?.dialogue ?? null;
    nodes = r?.nodes ?? [];
  }
  // 完整性校验：正常对话必有助手回复；全 user 说明结构化解析漏了（选择器失效/规则不全）
  if (d && !d.messages.some((m) => m.role === "assistant")) d = null;
  if (d) {
    // 内容去重（nodes 层）：虚拟列表滚动采集可能重复读到同一消息（同 role + 同 content）
    const seen = new Set<string>();
    let removed = 0;
    const kept: MessageNode[] = [];
    for (const n of nodes) {
      const k = `${n.role}\u0000${n.content}`;
      if (seen.has(k)) removed += 1;
      else {
        seen.add(k);
        kept.push(n);
      }
    }
    nodes = kept;
    d = { ...d, messages: nodes.map(({ role, content }) => ({ role, content })), ...(removed > 0 ? { duplicatesRemoved: removed } : {}) };
    // 确认态回调（带 el 的最终节点；整页文本兜底无 nodes 不回调）
    if (nodes.length > 0) ctx.onCollected?.(nodes);
  }
  return d ?? collectPageText(ctx, platform);
}
