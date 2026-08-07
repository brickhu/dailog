import type { CollectedDialogue, CollectRule, CollectRules, DialogueMessage, Platform } from "../shared";
import { collectClaude } from "./claude";
import { collectDeepSeek } from "./deepseek";
import { scrollCollect, scrollSweep, dedupeSort, type MessageNode } from "./core";
import { extractTitle } from "./title";
import { parseByRule } from "./rule-parser";
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
  };
  /** 采集失败时拉取远程规则兜底（content.ts 注入；测试环境可省略） */
  getRules?: () => Promise<CollectRules | null>;
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

/** 远程规则兜底采集：规则缺失 / 无有效消息 → null */
async function collectByRemoteRule(
  ctx: CollectContext,
  platform: Platform,
  rules?: CollectRules | null,
): Promise<CollectedDialogue | null> {
  const rule = rules?.platforms?.[platform] ?? (await ctx.getRules?.())?.platforms?.[platform];
  if (!rule) return null;
  const messages = parseByRule(ctx.root, rule);
  if (!messages) return null;
  const conversationId = conversationIdFromUrl(ctx.url, rule.url?.conversationIdPattern);
  if (!conversationId) return null;
  const title = extractTitle(ctx.root, messages);
  return { platform, conversationId, title, url: ctx.url, messages };
}

/** 虚拟列表/懒加载平台采集：打印式撑开优先（全量渲染），
 *  撑开成功也需等渲染稳定（分批插入）；撑开无效则还原样式走滚动循环。
 *  conversationId 按规则 url.conversationIdPattern 提取（缺省取路径最后一段） */
async function collectByScroll(
  ctx: CollectContext,
  platform: Platform,
  rule: CollectRule | undefined,
): Promise<CollectedDialogue | null> {
  const scroll = ctx.scroll!;
  const onRead = (nodes: MessageNode[]): void => {
    scroll.onNodesRead?.(nodes); // 进度高亮等 UI 回调（幂等）
  };
  // 统一采集方式（所有平台一致）：从顶到底步进滚动扫描——
  // 虚拟列表只渲染视口窗口，滚动经过的区域才渲染（打印全量渲染会让
  // claude 等平台无滚动过程，体验不统一；滚动 + 高亮对所有平台可见）。
  // 事件触发、到底稳定等待内置于 scrollSweep
  const nodes = await scrollSweep({
    container: scroll.container as HTMLElement,
    readNodes: scroll.readNodes,
    waitForMutation: scroll.waitForMutation,
    onNodesRead: onRead,
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
  return { platform, conversationId, title, url: ctx.url, messages, ...(incomplete ? { incomplete: true } : {}) };
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

/** 按 URL 分发到平台采集器；链路：平台解析（滚动/打印媒体模拟）→ 远程规则 → 整页文本兜底。
 *  平台判定由远程规则 url 字段驱动（host + conversationPath），规则缺失回退内置默认表。
 *  结构化结果缺助手回复（助手选择器失效等，如 claude 无 data-testid="assistant-message"）→
 *  视为不完整，落到整页文本兜底（打印媒体下包含全部可见内容） */
export async function collectFromDocument(ctx: CollectContext): Promise<CollectedDialogue | null> {
  const { root, url } = ctx;
  const rules = (await ctx.getRules?.()) ?? null;
  const platform = resolvePlatform(rules, url);
  if (!platform) return null; // 未知主机：不采集（与规则/默认表均无匹配的 URL 无关）
  let d: CollectedDialogue | null = null;
  if (platform === "claude") {
    d = ctx.scroll
      ? await collectByScroll(ctx, "claude", rules?.platforms.claude)
      : collectClaude(root, url);
    // 本地解析结果缺助手回复（新版 DOM 无 data-testid="assistant-message"，
    // 只匹配到 user 也算「部分成功」）→ 仍尝试远程规则补齐
    if (!d || !d.messages.some((m) => m.role === "assistant")) {
      d = (await collectByRemoteRule(ctx, "claude", rules)) ?? d;
    }
  } else if (platform === "deepseek") {
    d = ctx.scroll
      ? await collectByScroll(ctx, "deepseek", rules?.platforms.deepseek)
      : collectDeepSeek(root, url);
    d ??= await collectByRemoteRule(ctx, "deepseek", rules);
  } else if (platform) {
    // 其余平台（chatgpt 等虚拟列表长对话）：有 scroll 上下文（content.ts 注入，
    // 打印撑开 + 滚动循环）→ 滚动采集；否则纯规则静态解析（视口内消息）
    d = ctx.scroll
      ? await collectByScroll(ctx, platform, rules?.platforms[platform])
      : await collectByRemoteRule(ctx, platform, rules);
  }
  // 完整性校验：正常对话必有助手回复；全 user 说明结构化解析漏了（选择器失效/规则不全）
  if (d && !d.messages.some((m) => m.role === "assistant")) d = null;
  if (d) {
    // 内容去重：虚拟列表滚动采集可能重复读到同一消息（同 role + 同 content）——
    // 去重并记录数量（content 侧 toast 提示）
    const seen = new Set<string>();
    let removed = 0;
    const messages: DialogueMessage[] = [];
    for (const m of d.messages) {
      const k = `${m.role}\u0000${m.content}`;
      if (seen.has(k)) removed += 1;
      else {
        seen.add(k);
        messages.push(m);
      }
    }
    if (removed > 0) d = { ...d, messages, duplicatesRemoved: removed };
  }
  return d ?? collectPageText(ctx, platform);
}
