import type { CollectedDialogue, CollectRule, CollectRules, Platform } from "../shared";
import { collectClaude, parseClaudePage } from "./claude";
import { collectDeepSeek, parseDeepSeekPage } from "./deepseek";
import { collectDoubao, parseDoubaoPage } from "./doubao";
import type { MessageNode } from "./core";
import { extractTitle } from "./title";
import { parseByRuleWithEl } from "./rule-parser";
import { extractPageText } from "./page-text";
import { conversationIdFromUrl } from "../shared";

export interface CollectContext {
  root: ParentNode;
  url: string;
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

/** 手动采集组装（用户滚动驱动渲染，节点由 content.ts 轮询累积传入）：
 *  platform 解析 + conversationId（含规则 pattern）+ title。
 *  不丢弃任何已捕获内容（"变绿就要获取"）：重复合并由 mergeMessageNodes 在
 *  采集层完成（序列 id 按内容键、稳定 id 按 id），组装层原样保留——
 *  内容相同但确实是不同消息（如连续相同的追问）不会被误删；
 *  缺助手回复（选择器失效）→ null */
export async function buildManualDialogue(
  ctx: { root: ParentNode; url: string; getRules?: () => Promise<CollectRules | null> },
  nodes: MessageNode[],
): Promise<CollectedDialogue | null> {
  if (nodes.length === 0) return null;
  const rules = (await ctx.getRules?.()) ?? null;
  const platform = resolvePlatform(rules, ctx.url);
  if (!platform) return null;
  if (!nodes.some((m) => m.role === "assistant")) return null;
  const messages = nodes.map(({ role, content }) => ({ role, content }));
  const conversationId = conversationIdFromUrl(ctx.url, rules?.platforms?.[platform]?.url?.conversationIdPattern);
  if (!conversationId) return null;
  const title = extractTitle(ctx.root, messages);
  return {
    platform,
    conversationId,
    title,
    url: ctx.url,
    messages,
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

/** 按 URL 分发到平台采集器；链路：平台解析（静态解析）→ 远程规则 → 整页文本兜底。
 *  平台判定由远程规则 url.host 驱动，规则缺失回退内置默认表。
 *  结构化结果缺助手回复（助手选择器失效等，如 claude 无 data-testid="assistant-message"）→
 *  视为不完整，落到整页文本兜底。
 *  交互式长对话采集走 buildManualDialogue（content.ts 手动采集状态机），本函数
 *  用于 popup 触发 / 全文渲染平台的静态 one-shot 采集 */
export async function collectFromDocument(ctx: CollectContext): Promise<CollectedDialogue | null> {
  const { root, url } = ctx;
  const rules = (await ctx.getRules?.()) ?? null;
  const platform = resolvePlatform(rules, url);
  if (!platform) return null; // 未知主机：不采集（与规则/默认表均无匹配的 URL 无关）
  let d: CollectedDialogue | null = null;
  let nodes: MessageNode[] = [];
  if (platform === "claude") {
    d = collectClaude(root, url);
    nodes = d ? parseClaudePage(root) : [];
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
    d = collectDeepSeek(root, url);
    nodes = d ? parseDeepSeekPage(root) : [];
    // 本地解析失败 → 远程规则补齐
    if (!d) {
      const rr = await collectByRemoteRule(ctx, "deepseek", rules);
      if (rr) {
        d = rr.dialogue;
        nodes = rr.nodes;
      }
    }
  } else if (platform === "doubao") {
    // doubao 本地解析器（不依赖 CDN 规则——规则缓存滞后会导致提取为空直接跳转）
    d = collectDoubao(root, url);
    nodes = d ? parseDoubaoPage(root) : [];
    // 本地解析失败 → 远程规则补齐
    if (!d) {
      const rr = await collectByRemoteRule(ctx, "doubao", rules);
      if (rr) {
        d = rr.dialogue;
        nodes = rr.nodes;
      }
    }
  } else if (platform) {
    // 其余平台（chatgpt 等）：规则静态解析
    const rr = await collectByRemoteRule(ctx, platform, rules);
    d = rr?.dialogue ?? null;
    nodes = rr?.nodes ?? [];
  }
  // 完整性校验：正常对话必有助手回复；全 user 说明结构化解析漏了（选择器失效/规则不全）
  if (d && !d.messages.some((m) => m.role === "assistant")) d = null;
  if (d) {
    // 内容去重（nodes 层）：规则兜底节点可能重复读到同一消息（同 role + 同 content）
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
  }
  return d ?? collectPageText(ctx, platform);
}
