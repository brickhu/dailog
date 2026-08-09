// 平台分发 + 错误归一化。平台规则变化只改 platforms/ 下对应文件，
// 服务形态（HTTP/部署）不动——独立服务的核心价值。

import { collectClaudeShare } from "./platforms/claude";
import { collectDeepSeekShare } from "./platforms/deepseek";
import { collectChatgptShare } from "./platforms/chatgpt";
import { collectDoubaoShare } from "./platforms/doubao";
import { collectGeminiShare } from "./platforms/gemini";
import { collectKimiShare } from "./platforms/kimi";
import { HttpError } from "./fetch";
import type { CollectedDialogue, CollectError } from "./types";

type CollectFn = (url: string) => Promise<CollectedDialogue | null>;

const PLATFORMS: Array<{ match: RegExp; collect: CollectFn }> = [
  { match: /claude\.ai\/share\//, collect: collectClaudeShare },
  { match: /chat\.deepseek\.com\/share\//, collect: collectDeepSeekShare },
  { match: /chatgpt\.com\/share\//, collect: collectChatgptShare },
  { match: /doubao\.com\/thread\//, collect: collectDoubaoShare },
  { match: /share\.gemini\.google\//, collect: collectGeminiShare },
  { match: /kimi\.com\/share\//, collect: collectKimiShare },
];

/** 统一入口：按 URL 匹配平台 → 采集 → CollectedDialogue 或 CollectError */
export async function collectShareUrl(url: string): Promise<CollectedDialogue | CollectError> {
  if (!/^https?:\/\//.test(url)) {
    return { error: "invalid_url" };
  }
  const platform = PLATFORMS.find((p) => p.match.test(url));
  if (!platform) {
    return { error: "unsupported_platform" };
  }
  try {
    const d = await platform.collect(url);
    if (!d) {
      return { error: "parse_failed", platform: (d as any)?.platform };
    }
    return d;
  } catch (e) {
    if (e instanceof HttpError) {
      return {
        error: "platform_unreachable",
        detail: { status: e.status, cf: e.cf },
      };
    }
    return {
      error: "platform_unreachable",
      detail: { message: e instanceof Error ? e.message : String(e) },
    };
  }
}
