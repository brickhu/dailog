// 平台分发 + 错误归一化。平台规则变化只改 platforms/ 下对应文件，
// 服务形态（HTTP/部署）不动——独立服务的核心价值。
// URL 校验三级：http(s) 格式 → 平台域名+路径前缀 → 分享页结构（id 格式）。
// 单平台多域名：domains 数组声明（如 ChatGPT = chatgpt.com + chat.openai.com；
// 通义 = qwen.aliyun.com + tongyi.aliyun.com），match/shareRe 自动生成。

import { collectClaudeShare, parseClaudeSnapshot } from "./platforms/claude";
import { collectDeepSeekShare } from "./platforms/deepseek";
import { collectChatgptShare, parseChatgptShareHtml, parseChatgptShareRsc } from "./platforms/chatgpt";
import { collectDoubaoShare, parseDoubaoShare } from "./platforms/doubao";
import { collectGeminiShare } from "./platforms/gemini";
import { collectKimiShare, parseKimiShare } from "./platforms/kimi";
import { collectPerplexityShare, parsePerplexityShare } from "./platforms/perplexity";
import { httpGet, HttpError } from "./fetch";
import type { CollectedDialogue, CollectError } from "./types";

type CollectFn = (url: string) => Promise<CollectedDialogue | null>;

interface PlatformRule {
  /** 平台标识 + 展示名（规则端点下发用） */
  id: string;
  label: string;
  /** 该平台的分享页域名（单平台可多域名；生成 match/shareRe） */
  domains: string[];
  /** 分享页路径前缀（默认 /share/；豆包为 /thread/） */
  pathPrefix?: string;
  /** 分享页 ID 格式（严格校验，防止伪链接/对话页链接漏进来） */
  shareIdRe: RegExp;
  collect: CollectFn;
  /** HTML 解析器（用户复制源码粘贴兜底）：(html, id, url) → dialogue */
  parse?: (html: string, id: string, url: string) => CollectedDialogue | null;
}

/** 域名列表 → 非捕获 alternation（如 (?:chatgpt\.com|chat\.openai\.com)） */
const domainAlt = (domains: string[]) =>
  `(?:${domains.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;

/** 由 domains + pathPrefix + shareIdRe 生成 match/shareRe（保持 shareRe 单一正则下发，前端零改动） */
const rule = (r: PlatformRule) => {
  const host = domainAlt(r.domains);
  const path = r.pathPrefix ?? "/share/";
  return {
    id: r.id,
    label: r.label,
    /** 域名 + 路径前缀（识别平台归属） */
    match: new RegExp(`^https?:\\/\\/(www\\.)?${host}${path}`),
    /** 分享页结构（id 格式）——严格校验，防止伪链接/对话页链接漏进来 */
    shareRe: new RegExp(`^https?:\\/\\/(www\\.)?${host}${path}(${r.shareIdRe.source})`),
    collect: r.collect,
    /** HTML 解析器（view-source/outerHTML 粘贴兜底用）；无 HTML 结构的平台（gemini/deepseek API）缺省 */
    parse: r.parse,
  };
};

const PLATFORMS: ReturnType<typeof rule>[] = [
  rule({ id: "claude", label: "Claude", domains: ["claude.ai"], shareIdRe: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, collect: collectClaudeShare, parse: parseClaudeSnapshot }),
  rule({ id: "deepseek", label: "DeepSeek", domains: ["chat.deepseek.com"], shareIdRe: /[A-Za-z0-9]+/, collect: collectDeepSeekShare }),
  rule({ id: "chatgpt", label: "ChatGPT", domains: ["chatgpt.com", "chat.openai.com"], shareIdRe: /[A-Za-z0-9-]+/, collect: collectChatgptShare, parse: (html, id, url) => parseChatgptShareRsc(html, id, url) ?? parseChatgptShareHtml(html, id, url) }),
  rule({ id: "doubao", label: "豆包", domains: ["doubao.com"], pathPrefix: "/thread/", shareIdRe: /[A-Za-z0-9]+/, collect: collectDoubaoShare, parse: parseDoubaoShare }),
  rule({ id: "gemini", label: "Gemini", domains: ["share.gemini.google"], shareIdRe: /[A-Za-z0-9]+/, collect: collectGeminiShare }),
  rule({ id: "kimi", label: "Kimi", domains: ["kimi.com"], shareIdRe: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, collect: collectKimiShare, parse: parseKimiShare }),
  rule({ id: "perplexity", label: "Perplexity", domains: ["www.perplexity.ai", "perplexity.ai"], pathPrefix: "/search/", shareIdRe: /[A-Za-z0-9_-]+/, collect: collectPerplexityShare, parse: parsePerplexityShare }),
  // 通义千问：单平台多域名示例（qwen.aliyun.com 为分享页主域名；tongyi.aliyun.com 网页版）。
  // 采集器待适配（无分享页 DOM 样本）——规则已注册（前端识别/预检可用），采集明确失败不写库
  rule({ id: "tongyi", label: "通义千问", domains: ["qwen.aliyun.com", "tongyi.aliyun.com"], shareIdRe: /[A-Za-z0-9-]+/, collect: async () => null }),
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

/** 用户复制源码兜底：按 URL 匹配平台 → 调对应 HTML 解析器（view-source/outerHTML 粘贴）。
 *  返回 null = 平台无 HTML 解析器（gemini/deepseek）或解析失败 */
export function parseHtmlForUrl(html: string, url: string): CollectedDialogue | null {
  const platform = PLATFORMS.find((p) => p.match.test(url));
  if (!platform?.parse) return null;
  const id = url.match(platform.shareRe)?.[1] ?? null;
  if (!id) return null;
  return platform.parse(html, id, url);
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
