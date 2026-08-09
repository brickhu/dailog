// 平台分发 + 错误归一化。平台规则变化只改 platforms/ 下对应文件，
// 服务形态（HTTP/部署）不动——独立服务的核心价值。
// URL 校验三级：http(s) 格式 → 平台域名+路径前缀 → 分享页结构（id 格式）。

import { collectClaudeShare } from "./platforms/claude";
import { collectDeepSeekShare } from "./platforms/deepseek";
import { collectChatgptShare } from "./platforms/chatgpt";
import { collectDoubaoShare } from "./platforms/doubao";
import { collectGeminiShare } from "./platforms/gemini";
import { collectKimiShare } from "./platforms/kimi";
import { httpGet, HttpError } from "./fetch";
import type { CollectedDialogue, CollectError } from "./types";

type CollectFn = (url: string) => Promise<CollectedDialogue | null>;

interface PlatformRule {
  /** 平台标识 + 展示名（规则端点下发用） */
  id: string;
  label: string;
  /** 域名 + 路径前缀（识别平台归属） */
  match: RegExp;
  /** 分享页结构（id 格式）——严格校验，防止伪链接/对话页链接漏进来 */
  shareRe: RegExp;
  collect: CollectFn;
}

const PLATFORMS: PlatformRule[] = [
  { id: "claude", label: "Claude", match: /^https?:\/\/(www\.)?claude\.ai\/share\//, shareRe: /^https?:\/\/(www\.)?claude\.ai\/share\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/, collect: collectClaudeShare },
  { id: "deepseek", label: "DeepSeek", match: /^https?:\/\/chat\.deepseek\.com\/share\//, shareRe: /^https?:\/\/chat\.deepseek\.com\/share\/([A-Za-z0-9]+)/, collect: collectDeepSeekShare },
  { id: "chatgpt", label: "ChatGPT", match: /^https?:\/\/(www\.)?chatgpt\.com\/share\//, shareRe: /^https?:\/\/(www\.)?chatgpt\.com\/share\/([A-Za-z0-9-]+)/, collect: collectChatgptShare },
  { id: "doubao", label: "豆包", match: /^https?:\/\/(www\.)?doubao\.com\/thread\//, shareRe: /^https?:\/\/(www\.)?doubao\.com\/thread\/([A-Za-z0-9]+)/, collect: collectDoubaoShare },
  { id: "gemini", label: "Gemini", match: /^https?:\/\/share\.gemini\.google\//, shareRe: /^https?:\/\/share\.gemini\.google\/([A-Za-z0-9]+)/, collect: collectGeminiShare },
  { id: "kimi", label: "Kimi", match: /^https?:\/\/(www\.)?kimi\.com\/share\//, shareRe: /^https?:\/\/(www\.)?kimi\.com\/share\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/, collect: collectKimiShare },
];

/** 校验规则（下发给前端做本地预检——单一来源，前端不双写规则） */
export interface PlatformRuleDto {
  id: string;
  label: string;
  /** 分享页结构正则（source 字符串，前端 new RegExp 使用） */
  sharePattern: string;
}

export function getPlatformRules(): PlatformRuleDto[] {
  return PLATFORMS.map((p) => ({ id: p.id, label: p.label, sharePattern: p.shareRe.source }));
}

/** 统一入口：按 URL 匹配平台 → 触达预检 → 采集 → CollectedDialogue 或 CollectError */
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
  // 触达预检：分享链接可能随时被平台取消——解码前先确认可达，
  // 失效直接快速失败（不浪费 ScraperAPI 额度/通道重试）
  const reach = await checkReachable(url);
  if (reach === "gone") {
    return { error: "share_unavailable", detail: { message: "分享链接已失效或被取消" } };
  }
  try {
    const d = await platform.collect(url);
    if (!d) {
      return { error: "parse_failed", platform: (d as any)?.platform };
    }
    return d;
  } catch (e) {
    if (e instanceof HttpError) {
      // 平台 API/页面 404/410 = 分享被取消（触达预检漏网的软失效）
      if (e.status === 404 || e.status === 410) {
        return { error: "share_unavailable", detail: { status: e.status, message: "分享链接已失效或被取消" } };
      }
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

/** 触达预检：直连 GET 分享页（轻量、不花 ScraperAPI）。
 *  gone = 明确失效（404/410）；ok = 可达（2xx/3xx/4xx 非 404——403 是 CF
 *  挑战但链接存在，不算失效）；unknown = 无法判断（网络错/超时）→ 继续解码 */
async function checkReachable(url: string): Promise<"ok" | "gone" | "unknown"> {
  try {
    const res = await httpGet(url);
    if (res.status === 404 || res.status === 410) return "gone";
    if (res.status >= 200 && res.status < 500) return "ok";
    return "unknown";
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 410)) return "gone";
    return "unknown";
  }
}
