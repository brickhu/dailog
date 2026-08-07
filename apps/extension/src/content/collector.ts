import type { CollectedDialogue, CollectRule, CollectRules, Platform } from "../shared";
import { collectClaude } from "./claude";
import { collectDeepSeek } from "./deepseek";
import { scrollCollect, dedupeSort, type MessageNode } from "./core";
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
    /** 打印式撑开：虚拟列表全量渲染尝试（成功 = 节点显著增多） */
    expand?: () => Promise<boolean>;
    /** 还原撑开时改动的内联样式 */
    restore?: () => void;
  };
  /** 采集失败时拉取远程规则兜底（content.ts 注入；测试环境可省略） */
  getRules?: () => Promise<CollectRules | null>;
}

/** 平台 URL 默认表（远程规则缺失/未覆盖时兜底；host + 对话页路径前缀）。
 *  规则数据化的 fallback——CDN 规则里的 url 字段优先于本表 */
const DEFAULT_PLATFORM_URLS: ReadonlyArray<{ host: string; path: string; platform: Platform }> = [
  { host: "claude.ai", path: "/chat/", platform: "claude" },
  { host: "chat.deepseek.com", path: "/a/chat/", platform: "deepseek" }, // 2026-08-07 实测：新版对话页 /a/chat/s/{uuid}
  { host: "chatgpt.com", path: "/c/", platform: "chatgpt" },
  { host: "www.doubao.com", path: "/chat/", platform: "doubao" },
  { host: "gemini.google.com", path: "/app/", platform: "gemini" },
  { host: "kimi.moonshot.cn", path: "/chat/", platform: "kimi" },
  { host: "www.tongyi.com", path: "/", platform: "tongyi" },
];

/** 按 URL 解析平台：远程规则 url 字段优先（host 匹配 + conversationPath 前缀），
 *  无命中回退默认表；非法 URL → null */
export function resolvePlatform(rules: CollectRules | null | undefined, url: string): Platform | null {
  let hostname = "";
  let pathname = "";
  try {
    ({ hostname, pathname } = new URL(url));
  } catch {
    return null;
  }
  if (rules) {
    for (const [platform, rule] of Object.entries(rules.platforms)) {
      const u = rule?.url;
      if (!u?.host || u.host !== hostname) continue;
      // conversationPath 缺省 = 仅域名命中即归属该平台
      if (!u.conversationPath || pathname.startsWith(u.conversationPath)) return platform as Platform;
    }
  }
  return (
    DEFAULT_PLATFORM_URLS.find(({ host, path }) => host === hostname && pathname.startsWith(path))
      ?.platform ?? null
  );
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
  let expanded = false;
  if (scroll.expand) {
    expanded = await scroll.expand();
    if (!expanded) scroll.restore?.(); // 撑开无效：还原样式，滚动循环才有意义
  }
  let nodes: MessageNode[];
  if (expanded) {
    // 全量渲染可能是逐批插入：读到节点数稳定为止（最多 3 轮）
    nodes = dedupeSort(await scroll.readNodes());
    for (let i = 0; i < 3; i++) {
      await scroll.waitForMutation();
      const next = dedupeSort(await scroll.readNodes());
      if (next.length <= nodes.length) break;
      nodes = next;
    }
  } else {
    nodes = await scrollCollect({
      scrollToTop: async () => { scroll.container.scrollTop = 0; },
      readNodes: scroll.readNodes,
      waitForMutation: scroll.waitForMutation,
      maxIterations: 20,
      settleRounds: 2,
    });
  }
  scroll.restore?.();
  if (nodes.length === 0) return null;
  const conversationId = conversationIdFromUrl(ctx.url, rule?.url?.conversationIdPattern);
  if (!conversationId) return null;
  const messages = nodes.map(({ role, content }) => ({ role, content }));
  const title = extractTitle(ctx.root, messages);
  return { platform, conversationId, title, url: ctx.url, messages };
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
    // 其余平台：无专有解析器，直接走远程规则
    d = await collectByRemoteRule(ctx, platform, rules);
  }
  // 完整性校验：正常对话必有助手回复；全 user 说明结构化解析漏了（选择器失效/规则不全）
  if (d && !d.messages.some((m) => m.role === "assistant")) d = null;
  return d ?? collectPageText(ctx, platform);
}
