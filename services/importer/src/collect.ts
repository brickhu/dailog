// 平台分发 + 错误归一化。平台规则变化只改 platforms/ 下对应文件，
// 服务形态（HTTP/部署）不动——独立服务的核心价值。
// URL 校验三级：http(s) 格式 → 平台域名+路径前缀 → 分享页结构（id 格式）。

import { collectClaudeShare } from "./platforms/claude";
import { collectDeepSeekShare } from "./platforms/deepseek";
import { collectChatgptShare } from "./platforms/chatgpt";
import { collectDoubaoShare } from "./platforms/doubao";
import { collectGeminiShare } from "./platforms/gemini";
import { collectKimiShare } from "./platforms/kimi";
import { HttpError } from "./fetch";
import type { CollectedDialogue, CollectError } from "./types";

type CollectFn = (url: string) => Promise<CollectedDialogue | null>;

interface PlatformRule {
  /** 域名 + 路径前缀（识别平台归属） */
  match: RegExp;
  /** 分享页结构（id 格式）——严格校验，防止伪链接/对话页链接漏进来 */
  shareRe: RegExp;
  collect: CollectFn;
}

const PLATFORMS: PlatformRule[] = [
  { match: /^https?:\/\/(www\.)?claude\.ai\/share\//, shareRe: /^https?:\/\/(www\.)?claude\.ai\/share\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/, collect: collectClaudeShare },
  { match: /^https?:\/\/chat\.deepseek\.com\/share\//, shareRe: /^https?:\/\/chat\.deepseek\.com\/share\/([A-Za-z0-9]+)/, collect: collectDeepSeekShare },
  { match: /^https?:\/\/(www\.)?chatgpt\.com\/share\//, shareRe: /^https?:\/\/(www\.)?chatgpt\.com\/share\/([A-Za-z0-9-]+)/, collect: collectChatgptShare },
  { match: /^https?:\/\/(www\.)?doubao\.com\/thread\//, shareRe: /^https?:\/\/(www\.)?doubao\.com\/thread\/([A-Za-z0-9]+)/, collect: collectDoubaoShare },
  { match: /^https?:\/\/share\.gemini\.google\//, shareRe: /^https?:\/\/share\.gemini\.google\/([A-Za-z0-9]+)/, collect: collectGeminiShare },
  { match: /^https?:\/\/(www\.)?kimi\.com\/share\//, shareRe: /^https?:\/\/(www\.)?kimi\.com\/share\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/, collect: collectKimiShare },
];

/** 统一入口：按 URL 匹配平台 → 采集 → CollectedDialogue 或 CollectError */
export async function collectShareUrl(url: string): Promise<CollectedDialogue | CollectError> {
  if (!/^https?:\/\//.test(url)) {
    return { error: "invalid_url", detail: { message: "必须是 http(s) 链接" } };
  }
  const platform = PLATFORMS.find((p) => p.match.test(url));
  if (!platform) {
    return { error: "unsupported_platform" };
  }
  // 分享页结构校验：域名对但路径/ID 格式不对（如 claude.ai/chat/xxx、share/ 无 id）→
  // 清晰报错而不是落到 parse_failed
  if (!platform.shareRe.test(url)) {
    return { error: "invalid_url", detail: { message: "链接不是有效的分享页" } };
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
