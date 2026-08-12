// perplexity 分享：Next.js 分享页（/search/<slug>-<id>，公共路由无需登录）。
// 提取策略两级：
//  ① __NEXT_DATA__ 嵌入 JSON → 深度搜索 thread 结构（queries + answers 数组）
//  ② DOM 兜底：data-testid="chat-turn-query"（用户问题）+ "answer-content"（回答），按文档序交替
// 标题：嵌入 title → og:title → <title>

import { httpGet } from "../fetch";
import type { CollectedDialogue } from "../types";

export async function collectPerplexityShare(url: string): Promise<CollectedDialogue | null> {
  const shareId = url.match(/perplexity\.ai\/search\/([^/?#]+)/)?.[1];
  if (!shareId) return null;
  const res = await httpGet(url);
  return parsePerplexityShare(res.body, shareId, url);
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

/** 按 data-testid 提取第一个匹配标签的平衡 div 内容（处理嵌套 div） */
function extractByTestId(html: string, testid: string): string[] {
  const out: string[] = [];
  const openRe = new RegExp(`<div[^>]*data-testid=["']${testid}["'][^>]*>`, "g");
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
    if (text) out.push(text);
  }
  return out;
}

/** DOM 兜底：chat-turn-query（用户）+ answer-content（回答）按文档序交替 */
function extractDomMessages(html: string): { role: "user" | "assistant"; content: string }[] | null {
  const queries = extractByTestId(html, "chat-turn-query");
  const answers = extractByTestId(html, "answer-content");
  if (queries.length === 0 && answers.length === 0) return null;
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  let qi = 0;
  let ai = 0;
  // 按出现顺序合并：取第一个 testid 出现位置决定交替起点
  const qPos = html.indexOf('data-testid="chat-turn-query"');
  const aPos = html.indexOf('data-testid="answer-content"');
  const firstIsQuery = qPos !== -1 && (aPos === -1 || qPos < aPos);
  let userTurn = firstIsQuery;
  while (qi < queries.length || ai < answers.length) {
    if (userTurn && qi < queries.length) {
      messages.push({ role: "user", content: queries[qi++] });
    } else if (!userTurn && ai < answers.length) {
      messages.push({ role: "assistant", content: answers[ai++] });
    } else if (qi < queries.length) {
      messages.push({ role: "user", content: queries[qi++] });
    } else if (ai < answers.length) {
      messages.push({ role: "assistant", content: answers[ai++] });
    }
    userTurn = !userTurn;
  }
  return messages.some((x) => x.role === "assistant") ? messages : null;
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
