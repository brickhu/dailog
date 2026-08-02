import type { CollectedDialogue } from "../shared";
import { collectClaude } from "./claude";
import { collectDeepSeek } from "./deepseek";
import { scrollCollect, type MessageNode } from "./core";

export interface CollectContext {
  root: ParentNode;
  url: string;
  scroll?: {
    container: Element;
    readNodes: () => Promise<MessageNode[]>;
    waitForMutation: () => Promise<void>;
  };
}

/** 按 URL 分发到平台采集器；DeepSeek 等虚拟列表平台接入滚动采集 */
export async function collectFromDocument(ctx: CollectContext): Promise<CollectedDialogue | null> {
  const { root, url } = ctx;
  if (url.startsWith("https://claude.ai/chat/")) return collectClaude(root, url);
  if (url.startsWith("https://chat.deepseek.com/chat/")) {
    if (ctx.scroll) {
      const nodes = await scrollCollect({
        scrollToTop: async () => { ctx.scroll!.container.scrollTop = 0; },
        readNodes: ctx.scroll.readNodes,
        waitForMutation: ctx.scroll.waitForMutation,
        maxIterations: 20,
        settleRounds: 2,
      });
      if (nodes.length === 0) return null;
      const conv = /\/chat\/([^/?#]+)/.exec(url)?.[1];
      if (!conv) return null;
      const title = (root.ownerDocument?.title ?? "").replace(/\s*[-·]\s*DeepSeek\s*$/, "").trim();
      return {
        platform: "deepseek", conversationId: conv, title, url,
        messages: nodes.map(({ role, content }) => ({ role, content })),
      };
    }
    return collectDeepSeek(root, url);
  }
  return null;
}
