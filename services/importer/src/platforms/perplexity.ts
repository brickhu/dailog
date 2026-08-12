// perplexity 分享：Next.js 分享页（/search/<slug>-<id>，公共路由）。
// 提取策略两级：
//  ① __NEXT_DATA__ 嵌入 JSON → 深度搜索 thread 结构（queries + answers 数组）
//  ② DOM 兜底：data-testid="chat-turn-query"（用户问题）+ "answer-content"（回答），按文档序交替
// 标题：嵌入 title → og:title → <title>
// 通道（对齐 claude 多通道模式）：默认 → ScraperAPI（render）→ CF Worker。
// 注意：perplexity.ai 全站 CF Turnstile 风控 + 分享内容客户端渲染——静态通道拿到的
// 是空壳（实测 ScraperAPI 标准渲染被挑战拦）；需要能过 Turnstile 的通道
// （ScraperAPI ultra_premium / CF Worker 转发）才可能拿到内容。

import { httpGet, httpGetViaScraperApi, httpGetViaWorker } from "../fetch";
import type { CollectedDialogue } from "../types";

export async function collectPerplexityShare(url: string): Promise<CollectedDialogue | null> {
  const shareId = url.match(/perplexity\.ai\/search\/([^/?#]+)/)?.[1];
  if (!shareId) return null;
  // 通道尝试顺序：默认（直连/代理池）→ ScraperAPI（render 需手动加参？fetch.ts 已含）→ CF Worker
  const attempts: Array<{ viaScraper?: boolean; viaWorker?: boolean }> = [{ viaScraper: false, viaWorker: false }];
  if (process.env.SCRAPERAPI_KEY) attempts.push({ viaScraper: true });
  if (process.env.CF_WORKER_URL) attempts.push({ viaWorker: true });

  for (const a of attempts) {
    try {
      const res = a.viaWorker
        ? await httpGetViaWorker(url)
        : a.viaScraper
          ? await httpGetViaScraperApi(url)
          : await httpGet(url);
      const d = parsePerplexityShare(res.body, shareId, url);
      if (d) return d;
      // 解析失败（挑战页/空壳/结构变化）→ 换通道
    } catch {
      // 通道失败 → 换下一个
    }
  }
  return null;
}

/* ---------- 嵌入 JSON 路径 ---------- */

/** 深度搜索：找第一个含 queries（string[]）与 answers（string 或 {text}）的对象 */
interface ThreadLike {
  queries: string[];
  answers: string[];
}

function findThread(node: unknown, depth: number): ThreadLike | null {
  if (depth > 12 || node === null || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.queries) && Array.isArray(obj.answers)) {
    const queries = obj.queries.map((q) => (typeof q === "string" ? q : (q as { query?: unknown })?.query)).filter((x): x is string => typeof x === "string");
    const answers = obj.answers.map((a) => (typeof a === "string" ? a : (a as { text?: unknown })?.text)).filter((x): x is string => typeof x === "string");
    if (queries.length > 0 && answers.length > 0) return { queries, answers };
  }
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        const hit = findThread(item, depth + 1);
        if (hit) return hit;
      }
    } else {
      const hit = findThread(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** __NEXT_DATA__ → thread（{queries, answers} + title），无则 null */
function extractNextDataThread(html: string): { thread: ThreadLike; title: string | null } | null {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const title = (data as { props?: { pageProps?: { title?: unknown } } })?.props?.pageProps?.title ?? null;
  const thread = findThread(data, 0);
  return thread ? { thread, title: typeof title === "string" ? title : null } : null;
}

/* ---------- DOM 兜底路径 ---------- */

/** 按 data-testid 提取（兼容旧路径；perplexity 当前无这些 testid，保留防御） */
function extractByTestId(html: string, testid: string): string[] {
  return extractBalancedDivs(html, new RegExp(`<div[^>]*data-testid=["']${testid}["'][^>]*>`, "g")).map((x) => x.text);
}

/** 平衡 div 提取（按 open 正则匹配开标签，配对闭合）——通用版（class/testid 均可） */
function extractBalancedDivs(html: string, openRe: RegExp): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(html)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < html.length && depth > 0) {
      const open = html.indexOf("<div", i);
      const close = html.indexOf("</div>", i);
      if (close === -1) break;
      if (open !== -1 && open < close) {
        depth++;
        i = open + 4;
      } else {
        depth--;
        i = close + 6;
      }
    }
    const raw = html.slice(start, Math.max(start, i - 6));
    const text = raw
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text) out.push({ text, start });
  }
  return out;
}

/** UI 噪音词（问题提取时排除） */
const UI_NOISE = new Set([
  "新建", "搜索", "下载", "折叠", "展开", "复制", "分享", "相关", "来源", "查看更多新闻", "搜索网页",
  "Computer", "整理并分享您的工作", "将文件、记忆和上下文在多个会话中保持集中统一。", "下载 Comet",
  "Steve Jobs: Visionary CEO", "搜狐网",
]);

/**
 * DOM 兜底（实测 2026-08 结构）：回答 = class="prose…" 块（可靠特征）；
 * 用户问题 = 回答块之前最近的短文本（perplexity 无 testid 标记问题，问题紧邻其回答渲染）。
 * 组装：q0,a0,q1,a1…；无 prose 块 → null。
 */
function extractDomMessages(html: string): { role: "user" | "assistant"; content: string }[] | null {
  // ① 回答：prose 块（perplexity 回答容器）
  const answers = extractBalancedDivs(html, /<div[^>]*class="prose[^"]*"[^>]*>/g);
  if (answers.length === 0) return null;
  // ② 问题：每个回答前 8000 字符窗口内——
  //    先剔除 <button> 块（"查看更多新闻/搜索网页/续自"等按钮文本），
  //    优先取最后一个带问号的文本（真实问题最强特征，如"乔布斯为什么伟大？"）；
  //    无问号时取最后一个（真实问题紧邻回答渲染，如"翻译成中文"）
  const questions: string[] = [];
  for (const a of answers) {
    const seg = html.slice(Math.max(0, a.start - 8000), a.start).replace(/<button[\s\S]*?<\/button>/g, "");
    const texts = [...seg.matchAll(/>([^<>{}]{2,400})</g)]
      .map((m) => m[1].trim())
      .filter((t) => t && !UI_NOISE.has(t));
    const withQ = [...texts].reverse().find((t) => /[？?]$/.test(t));
    questions.push(withQ ?? texts[texts.length - 1] ?? "");
  }
  // ③ 交替组装（问题缺失时跳过该轮——首答无问题时接受）
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (let i = 0; i < answers.length; i++) {
    if (questions[i]) messages.push({ role: "user", content: questions[i] });
    messages.push({ role: "assistant", content: answers[i].text });
  }
  return messages.length >= 2 ? messages : null;
}

/* ---------- 统一入口 ---------- */

/** perplexity 分享解析：嵌入 JSON 优先，DOM 兜底；无 assistant 消息 → null */
export function parsePerplexityShare(html: string, id: string, url: string): CollectedDialogue | null {
  // 标题：嵌入 → og:title → <title>
  let title: string | null = null;
  const og = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  const tt = html.match(/<title>([\s\S]*?)<\/title>/i);
  title = og?.[1] ?? (tt?.[1]?.trim() || null);

  // ① 嵌入 JSON（优先；含 title）
  const nextData = extractNextDataThread(html);
  if (nextData) {
    const { queries, answers } = nextData.thread;
    const messages: { role: "user" | "assistant"; content: string }[] = [];
    for (let i = 0; i < Math.max(queries.length, answers.length); i++) {
      if (i < queries.length && queries[i].trim()) messages.push({ role: "user", content: queries[i].trim() });
      if (i < answers.length && answers[i].trim()) messages.push({ role: "assistant", content: answers[i].trim() });
    }
    if (!messages.some((x) => x.role === "assistant")) return null;
    return {
      platform: "perplexity",
      conversationId: id,
      title: nextData.title ?? title ?? "Perplexity 分享对话",
      url,
      messages,
    };
  }

  // ② DOM 兜底
  const domMessages = extractDomMessages(html);
  if (!domMessages) return null;
  return {
    platform: "perplexity",
    conversationId: id,
    title: title ?? "Perplexity 分享对话",
    url,
    messages: domMessages,
  };
}
