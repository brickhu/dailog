import type { CollectedDialogue, CollectRules, Platform } from "../shared";
import { collectClaude } from "./claude";
import { collectDeepSeek } from "./deepseek";
import { scrollCollect, dedupeSort, type MessageNode } from "./core";
import { extractTitle } from "./title";
import { parseByRule } from "./rule-parser";
import { extractPageText } from "./page-text";

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

/** 支持平台的 URL 判定（与 manifest matches 保持一致；规则 fallback 的分发依据） */
const URL_PLATFORM: Array<[RegExp, Platform]> = [
  [/^https:\/\/claude\.ai\/chat\//, "claude"],
  [/^https:\/\/chat\.deepseek\.com\/chat\//, "deepseek"],
  [/^https:\/\/chatgpt\.com\/c\//, "chatgpt"],
  [/^https:\/\/www\.doubao\.com\/chat\//, "doubao"],
  [/^https:\/\/gemini\.google\.com\/app\//, "gemini"],
  [/^https:\/\/kimi\.moonshot\.cn\/chat\//, "kimi"],
  [/^https:\/\/www\.tongyi\.com\//, "tongyi"],
];

/** 从 URL 取会话 id（最后一段路径） */
function conversationIdFromUrl(url: string): string | null {
  return url.match(/\/([^/?#]+)\/?$/)?.[1] ?? null;
}

/** 远程规则兜底采集：规则缺失 / 无有效消息 → null */
async function collectByRemoteRule(ctx: CollectContext, platform: Platform): Promise<CollectedDialogue | null> {
  const rule = (await ctx.getRules?.())?.platforms?.[platform];
  if (!rule) return null;
  const messages = parseByRule(ctx.root, rule);
  if (!messages) return null;
  const conversationId = conversationIdFromUrl(ctx.url);
  if (!conversationId) return null;
  const title = extractTitle(ctx.root, messages);
  return { platform, conversationId, title, url: ctx.url, messages };
}

/** 虚拟列表/懒加载平台采集：打印式撑开优先（全量渲染），
 *  撑开成功也需等渲染稳定（分批插入）；撑开无效则还原样式走滚动循环。
 *  conversationId 从 URL 提取 */
async function collectByScroll(
  ctx: CollectContext,
  platform: Platform,
  convPattern: RegExp,
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
  const conversationId = convPattern.exec(ctx.url)?.[1];
  if (!conversationId) return null;
  const messages = nodes.map(({ role, content }) => ({ role, content }));
  const title = extractTitle(ctx.root, messages);
  return { platform, conversationId, title, url: ctx.url, messages };
}

/** 最终兜底：整页文本采集（结构化解析 + 远程规则全失败时；低置信度由确认页提示） */
function collectPageText(ctx: CollectContext): CollectedDialogue | null {
  const platform = URL_PLATFORM.find(([re]) => re.test(ctx.url))?.[1] ?? "plain";
  const conversationId = conversationIdFromUrl(ctx.url);
  if (!conversationId) return null;
  const text = extractPageText(ctx.root);
  if (!text) return null;
  const messages = [{ role: "user" as const, content: text }];
  const title = extractTitle(ctx.root, messages);
  return { platform, conversationId, title, url: ctx.url, messages, lowConfidence: true };
}

/** 按 URL 分发到平台采集器；链路：本地解析（滚动/打印媒体模拟）→ 远程规则 → 整页文本兜底。
 *  claude/deepseek：专有解析器优先（滚动/虚拟列表质量最高）；chatgpt/doubao 等：规则即首选路径。
 *  结构化结果缺助手回复（助手选择器失效等，如 claude 无 data-testid="assistant-message"）→
 *  视为不完整，落到整页文本兜底（打印媒体下包含全部可见内容） */
export async function collectFromDocument(ctx: CollectContext): Promise<CollectedDialogue | null> {
  const { root, url } = ctx;
  let d: CollectedDialogue | null = null;
  if (url.startsWith("https://claude.ai/chat/")) {
    d = ctx.scroll
      ? await collectByScroll(ctx, "claude", /\/chat\/([a-f0-9-]+)/)
      : collectClaude(root, url);
    // 本地解析结果缺助手回复（新版 DOM 无 data-testid="assistant-message"，
    // 只匹配到 user 也算「部分成功」）→ 仍尝试远程规则补齐
    if (!d || !d.messages.some((m) => m.role === "assistant")) {
      d = (await collectByRemoteRule(ctx, "claude")) ?? d;
    }
  } else if (url.startsWith("https://chat.deepseek.com/chat/")) {
    d = ctx.scroll
      ? await collectByScroll(ctx, "deepseek", /\/chat\/([^/?#]+)/)
      : collectDeepSeek(root, url);
    d ??= await collectByRemoteRule(ctx, "deepseek");
  } else {
    // 其余平台：无专有解析器，直接走远程规则
    const platform = URL_PLATFORM.find(([re]) => re.test(url))?.[1];
    if (!platform) return null;
    d = await collectByRemoteRule(ctx, platform);
  }
  // 完整性校验：正常对话必有助手回复；全 user 说明结构化解析漏了（选择器失效/规则不全）
  if (d && !d.messages.some((m) => m.role === "assistant")) d = null;
  return d ?? collectPageText(ctx);
}
