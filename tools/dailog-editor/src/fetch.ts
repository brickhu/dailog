// 采集 + 内容解码（编辑本地管线的一环）：从投稿 URL 拉取页面并解码落盘
//   pnpm editor fetch <submissionId>
//   ① 详情拿 URL → 按平台分派：
//      · deepseek/doubao：分享 API 直取（SSR 壳无内容的平台——结构化 dialogue 最快）
//      · chatgpt：SSR 流解码（分享页对话在 React Router 流式数据里，不在 DOM）
//      · 其余：HTML 拉取（直连失败且有本地代理 → 自动走 SOCKS5 重试）→ 规则/嗅探
//   ② 解码落盘草稿目录：
//      · page.html      原始 HTML（保留供排查/规则沉淀）
//      · page.txt       清洗后正文（去 script/style/导航壳，规范化空白）
//      · dialogue.json  提取的消息 [{role, content}]
//   ③ HTML 提取策略（自进化，规则在 .dailog-editor/rules.json——本地读写，无需 build）：
//      1. 规则库匹配（host+pathPrefix → user/assistant/content 选择器）；命中 hits+1 写回
//      2. 无规则命中 → 通用嗅探（data-message-author-role 容器）
//      3. 都失败 → 提示沉淀新规则（浏览器兜底后直接更新 .dailog-editor/rules.json，下次生效）
//   首次使用：从工程种子（assets/rules.json）自动初始化复制到 .dailog-editor/rules.json
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { load as loadHtml } from "cheerio";
import type { EditorConfig } from "./lib.js";
import { api, defaultAssetsDir, draftDir, rulesPath, writeProgress } from "./lib.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 30_000;
const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5MB 上限（超长页截断）

export interface DecodeRule {
  platform: string;
  host: string;
  pathPrefix?: string;
  userSelector: string;
  assistantSelector: string;
  contentSelector?: string | null;
  note?: string;
  hits?: number;
}

/** 规范化文本：折叠多余空白、去行尾空格、清空行 */
function normalizeText(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** 读取规则库 JSON；解析失败 → 空 */
function readRulesFile(path: string): DecodeRule[] | null {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as { rules?: DecodeRule[] } | null;
    return Array.isArray(data?.rules) ? data.rules : [];
  } catch {
    return null;
  }
}

/** 加载规则库（本地优先，产物 fallback）：
 *  ① .dailog-editor/rules.json（自进化主文件）
 *  ② 缺失 → fallback 产物 assets/rules.json（工程种子随构建分发，只读）
 *  命中后进化落本地（bumpHits 会把 fallback 规则初始化到本地再写回） */
function loadRules(): { rules: DecodeRule[]; fromLocal: boolean } {
  const local = rulesPath();
  const localRules = readRulesFile(local);
  if (localRules) return { rules: localRules, fromLocal: true };
  const fallback = readRulesFile(join(defaultAssetsDir(), "rules.json"));
  if (fallback) {
    console.log(`[fetch] 规则库：本地无 → fallback 产物种子（${fallback.length} 条）`);
    return { rules: fallback, fromLocal: false };
  }
  return { rules: [], fromLocal: true };
}

/** 命中规则 hits+1 写回（进化落本地）：本地已有 → 直接写；本地缺失（fallback 命中）→ 先初始化本地再写 */
function bumpHits(rule: DecodeRule): void {
  const local = rulesPath();
  let rules = readRulesFile(local);
  if (!rules) {
    // fallback 命中首次进化：把产物种子复制到本地（hits 统计从种子基线开始）
    const seed = readRulesFile(join(defaultAssetsDir(), "rules.json"));
    rules = seed ?? [];
    if (seed) console.log(`[fetch] 规则库已初始化到本地：${local}（${seed.length} 条）`);
  }
  const target = rules.find((r) => r.platform === rule.platform && r.host === rule.host);
  if (target) target.hits = (target.hits ?? 0) + 1;
  writeFileSync(local, JSON.stringify({ version: 1, note: "dailog 编辑解码规则库（本地自进化）——运行时读写，无需 build", rules }, null, 2));
}

/** URL 匹配规则（host + pathPrefix） */
function matchRule(rules: DecodeRule[], url: string): DecodeRule | null {
  try {
    const u = new URL(url);
    return rules.find((r) => {
      if (r.host && u.hostname !== r.host && !u.hostname.endsWith(`.${r.host}`)) return false;
      if (r.pathPrefix && !u.pathname.startsWith(r.pathPrefix)) return false;
      return true;
    }) ?? null;
  } catch {
    return null;
  }
}

/** 按规则提取（user/assistant 选择器联合匹配，matches 判定角色；内容取 contentSelector 或自身） */
function extractByRule($: ReturnType<typeof loadHtml>, rule: DecodeRule): { role: string; content: string }[] {
  const messages: { role: string; content: string }[] = [];
  const joined = `${rule.userSelector}, ${rule.assistantSelector}`;
  $(joined).each((_, el) => {
    const $el = $(el);
    const isUser = $el.is(rule.userSelector);
    const $content = rule.contentSelector ? $el.find(rule.contentSelector).first() : $el;
    const text = normalizeText($content.length > 0 ? $content.text() : $el.text());
    if (text) messages.push({ role: isUser ? "user" : "assistant", content: text });
  });
  return messages;
}

/** 通用嗅探（无规则命中时的兜底）：data-message-author-role 容器 → 消息；未命中 → null */
function sniffMessages($: ReturnType<typeof loadHtml>): { role: string; content: string }[] | null {
  const roleEls = $("[data-message-author-role]");
  if (roleEls.length === 0) return null;
  const messages: { role: string; content: string }[] = [];
  roleEls.each((_, el) => {
    const $el = $(el);
    const roleRaw = String($el.attr("data-message-author-role") ?? "").toLowerCase();
    if (roleRaw !== "user" && roleRaw !== "assistant") return;
    const $content = $el.find(".markdown, .markdown-body, .ds-markdown, [class*='markdown']").first();
    const text = normalizeText($content.length > 0 ? $content.text() : $el.text());
    if (text) messages.push({ role: roleRaw, content: text });
  });
  return messages.length > 0 ? messages : null;
}

// ─────────────────────────────────────────────────────────────
// 平台直取（结构化对话，优于 HTML 提取）——SKILL ③「平台经验库」
// 接口逆向法：SPA 分享页拉不到内容时先找数据接口（deepseek/doubao 已验证）
// ─────────────────────────────────────────────────────────────

interface PlatformInfo { api?: "deepseek" | "doubao"; ssr?: "chatgpt" }

/** 平台识别（host + pathPrefix）——命中则优先走对应直取路径 */
function detectPlatform(url: string): PlatformInfo | null {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const path = u.pathname;
    if (host === "chat.deepseek.com" && path.startsWith("/share/")) return { api: "deepseek" };
    if (host === "www.doubao.com" && path.startsWith("/share/")) return { api: "doubao" };
    if (host === "chatgpt.com" && path.startsWith("/share/")) return { ssr: "chatgpt" };
    return null;
  } catch {
    return null;
  }
}

/** 分享 URL 取 share id（/share/<id> 路径段） */
function shareIdOf(url: string, pathPrefix: string): string | null {
  try {
    const m = new URL(url).pathname.match(new RegExp(`^${pathPrefix.replace(/\//g, "\\/")}([^/?#]+)`));
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** deepseek 分享 API（2026-08-13/16 实测）：GET /api/v0/share/content?share_id=<id>（UA + Referer） */
async function extractDeepseekApi(url: string): Promise<{ role: string; content: string }[] | null> {
  const id = shareIdOf(url, "/share/");
  if (!id) return null;
  let res: Response;
  try {
    res = await fetch(`https://chat.deepseek.com/api/v0/share/content?share_id=${id}`, {
      headers: {
        "user-agent": UA,
        referer: `https://chat.deepseek.com/share/${id}`,
        accept: "application/json, text/plain, */*",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    data?: { biz_data?: { messages?: Array<{ role?: string; content?: string }> } };
  } | null;
  const messages = data?.data?.biz_data?.messages ?? [];
  const out = messages
    .filter((m) => m.role === "USER" || m.role === "ASSISTANT")
    .map((m) => ({ role: m.role!.toLowerCase(), content: (m.content ?? "").trim() }))
    .filter((m) => m.content.length > 0);
  return out.length > 0 ? out : null;
}

/** doubao 分享 API（2026-08-13 实测）：POST /im/message/share/get，body {"share_id": <id>}
 *  （alice 变体报 710020202，用 im 变体；消息 content 是 JSON 字符串 {"text": "..."}） */
async function extractDoubaoApi(url: string): Promise<{ role: string; content: string }[] | null> {
  const id = shareIdOf(url, "/share/");
  if (!id) return null;
  let res: Response;
  try {
    res = await fetch("https://www.doubao.com/im/message/share/get", {
      method: "POST",
      headers: {
        "user-agent": UA,
        "content-type": "application/json",
        origin: "https://www.doubao.com",
        referer: `https://www.doubao.com/share/${id}`,
      },
      body: JSON.stringify({ share_id: id }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    data?: { message_snapshot?: { message_list?: Array<{ user_type?: number; content?: string; index_in_conv?: number }> } };
  } | null;
  const list = data?.data?.message_snapshot?.message_list ?? [];
  const out = list
    .filter((m) => m.user_type === 1 || m.user_type === 2)
    .map((m) => {
      let text = m.content ?? "";
      try {
        text = (JSON.parse(text) as { text?: string }).text ?? text; // content 是 {"text": "..."}
      } catch { /* 非 JSON 内容原样用 */ }
      return { role: m.user_type === 1 ? "user" : "assistant", content: text.trim(), index: m.index_in_conv ?? 0 };
    })
    .filter((m) => m.content.length > 0)
    .sort((a, b) => a.index - b.index)
    .map(({ role, content }) => ({ role, content }));
  return out.length > 0 ? out : null;
}

/** 提取页面中所有 streamController.enqueue("...") 的 JS 字符串字面量（按转义规则找终止引号，反义还原） */
function extractEnqueuePayloads(html: string): string[] {
  const out: string[] = [];
  const marker = 'streamController.enqueue("';
  let pos = 0;
  while (true) {
    const start = html.indexOf(marker, pos);
    if (start < 0) break;
    let i = start + marker.length;
    let end = -1;
    while (i < html.length) {
      if (html[i] === "\\") {
        i += 2;
        continue;
      }
      if (html[i] === '"') {
        end = i;
        break;
      }
      i += 1;
    }
    if (end > start) {
      try {
        out.push(JSON.parse('"' + html.slice(start + marker.length, end) + '"'));
      } catch { /* 非法 JS 字符串跳过 */ }
    }
    pos = Math.max(end + 1, start + marker.length);
  }
  return out;
}

/** React Router 流式 SSR 引用编码解码（chatgpt 分享页，2026-08-16 实测）：
 *  顶层扁平表：dict 的 key/value 与 list 元素均为表索引；负值为 null；表内原始值即字面量
 *  （list 自引用如 ['P', n] 补丁标记 → 防环返回 null） */
export function decodeStreamTable(raw: string): unknown {
  const table = JSON.parse(raw) as unknown[];
  const visiting = new Set<number>();
  let depth = 0;
  const decode = (el: unknown): unknown => {
    if (depth > 64) return null; // 防御：异常循环结构兜底
    if (Array.isArray(el)) {
      return el.map((x) => {
        if (typeof x === "number" && x >= 0 && x < table.length) {
          if (visiting.has(x)) return null;
          visiting.add(x);
          depth += 1;
          const v = decode(table[x]);
          depth -= 1;
          visiting.delete(x);
          return v;
        }
        return x;
      });
    }
    if (el && typeof el === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(el)) {
        const ki = Number(k.slice(1));
        if (!(ki >= 0 && ki < table.length)) continue;
        out[String(decode(table[ki]))] =
          typeof v === "number" && v < 0 ? null : decode(typeof v === "number" && v < table.length ? table[v] : v);
      }
      return out;
    }
    return el;
  };
  return decode(table[0]);
}

/** 从 linear_conversation（线性消息列表）提取 role/content（author.role + content.parts） */
function extractMessagesFromLinear(lc: unknown[]): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  for (const entry of lc) {
    const msg = (entry as Record<string, unknown> | null | undefined)?.message as Record<string, unknown> | undefined;
    if (!msg) continue;
    const role = (msg.author as Record<string, unknown> | undefined)?.role;
    if (role !== "user" && role !== "assistant") continue;
    const parts = (msg.content as Record<string, unknown> | undefined)?.parts;
    const text = (Array.isArray(parts) ? parts.filter((p): p is string => typeof p === "string") : [])
      .join("\n")
      .trim();
    if (text) out.push({ role, content: text });
  }
  return out;
}

/** 递归找含 linear_conversation 的节点（chatgpt 对话在 serverResponse.data.linear_conversation） */
function findConversation(node: unknown): { role: string; content: string }[] | null {
  if (!node || (typeof node !== "object" && !Array.isArray(node))) return null;
  if (!Array.isArray(node)) {
    const lc = (node as Record<string, unknown>).linear_conversation;
    if (Array.isArray(lc)) {
      const msgs = extractMessagesFromLinear(lc);
      if (msgs.length > 0) return msgs;
    }
  }
  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    const r = findConversation(v);
    if (r) return r;
  }
  return null;
}

/** chatgpt SSR 流解码：对话在 enqueue 流数据里，不依赖 DOM 渲染（规则/嗅探对 SSR 壳无效） */
export function messagesFromChatgptStream(html: string): { role: string; content: string }[] | null {
  for (const raw of extractEnqueuePayloads(html)) {
    let payload: unknown;
    try {
      payload = decodeStreamTable(raw);
    } catch {
      continue;
    }
    const msgs = findConversation(payload);
    if (msgs && msgs.length > 0) return msgs;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// 代理支持（chatgpt.com 等被网络封锁的域名——GFW DNS 污染 + SNI 阻断，直连必然失败）
// 探测：env（ALL_PROXY/HTTPS_PROXY socks://）→ macOS 系统代理（scutil --proxy）
// ─────────────────────────────────────────────────────────────

/** 探测本地 SOCKS5 代理（host:port）；无 → null */
export function findSocksProxy(): string | null {
  for (const name of ["ALL_PROXY", "HTTPS_PROXY", "https_proxy"]) {
    const v = process.env[name];
    if (v && /socks/i.test(v)) return v.replace(/^socks5h?:\/\//, "").replace(/\/$/, "");
  }
  if (process.platform === "darwin") {
    try {
      const out = execFileSync("scutil", ["--proxy"], { encoding: "utf-8" });
      if (!/SOCKSEnable\s*:\s*1/.test(out)) return null;
      const port = out.match(/SOCKSPort\s*:\s*(\d+)/)?.[1];
      const host = out.match(/SOCKSProxy\s*:\s*([^\s]+)/)?.[1] ?? "127.0.0.1";
      return port ? `${host}:${port}` : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** 走代理拉取（curl --socks5-hostname：DNS 也过代理，绕污染；curl 为 macOS/常见发行版内置） */
function fetchViaProxy(url: string, proxy: string): string {
  return execFileSync(
    "curl",
    [
      "-sS", "-L",
      "-m", String(Math.round(FETCH_TIMEOUT_MS / 1000)),
      "--socks5-hostname", proxy,
      "-A", UA,
      "-H", "accept-language: zh-CN,zh;q=0.9,en;q=0.8",
      url,
    ],
    { encoding: "utf-8", maxBuffer: MAX_HTML_BYTES * 2 },
  );
}

/** 落盘 dialogue.json（来源标注：api:<平台> / ssr:<平台> / rule:<平台> / sniff） */
function writeDialogue(dir: string, url: string, source: string, messages: { role: string; content: string }[]): void {
  writeFileSync(join(dir, "dialogue.json"), JSON.stringify({ sourceUrl: url, source, messages }, null, 2));
}

/** 共享提取：平台直取 + 拉取 + 解码 + 落盘（fetch 命令与 batch 批量处理共用）。
 *  返回 { ok, messages?, error? }——失败给出原因（反爬/失效/未提取到消息）。 */
export async function extractSubmission(
  config: EditorConfig,
  submissionId: string,
): Promise<{ ok: boolean; messages?: { role: string; content: string }[]; error?: string }> {
  const dir = draftDir(submissionId);
  const detail = (await api(config, `/v1/editor/submissions/${submissionId}`)) as { url: string };
  const url = detail.url;
  const platform = detectPlatform(url);

  // ① 平台 API 直取（deepseek/doubao——SSR 壳无内容的平台首选，结构化命中直接用）
  if (platform?.api) {
    const apiMsgs = platform.api === "deepseek" ? await extractDeepseekApi(url) : await extractDoubaoApi(url);
    if (apiMsgs && apiMsgs.length > 0) {
      writeDialogue(dir, url, `api:${platform.api}`, apiMsgs);
      return { ok: true, messages: apiMsgs };
    }
    console.log(`[fetch] ${platform.api} 分享 API 未命中 → 回退 HTML 提取`);
  }

  // ② HTML 拉取：直连 → 失败且有本地代理 → 自动走 SOCKS5 重试（chatgpt 等被封锁域名）
  let html: string | null = null;
  let fetchError: string | null = null;
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      fetchError = `HTTP ${res.status}（${res.status === 403 ? "可能被反爬拦截" : "链接可能失效"}）`;
    } else {
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/json") && !contentType.includes("text/plain")) {
        fetchError = `响应不是 HTML（${contentType}）`;
      } else {
        html = await res.text();
      }
    }
  } catch {
    fetchError = "拉取失败（反爬/超时）";
  }
  if (!html) {
    const proxy = findSocksProxy();
    if (proxy) {
      try {
        html = fetchViaProxy(url, proxy);
        console.log(`[fetch] 直连失败（${fetchError ?? "无响应"}）→ 已走本地 SOCKS5 代理 ${proxy} 拉取成功`);
      } catch {
        // 代理也失败 → 保持直连错误
      }
    }
  }
  if (!html) {
    return { ok: false, error: `${fetchError ?? "拉取失败"}（可用 console-script 浏览器兜底）` };
  }
  if (html.length > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES);
  writeFileSync(join(dir, "page.html"), html);

  // 清洗正文（page.txt 始终落盘）
  const $ = loadHtml(html);
  $("script,style,noscript,template,svg,iframe,link,meta").remove();
  $("nav,footer,header,[role='navigation'],[role='banner'],[role='dialog'],[class*='cookie'],[class*='Cookie'],[id*='cookie']").remove();
  const bodyText = normalizeText($("body").text());
  writeFileSync(join(dir, "page.txt"), bodyText);

  // ③ chatgpt：SSR 流解码优先（对话完整在流数据里，不依赖 DOM 渲染）
  if (platform?.ssr) {
    const ssrMsgs = messagesFromChatgptStream(html);
    if (ssrMsgs && ssrMsgs.length > 0) {
      writeDialogue(dir, url, "ssr:chatgpt", ssrMsgs);
      return { ok: true, messages: ssrMsgs };
    }
    console.log("[fetch] chatgpt SSR 流解码未命中 → 回退规则/嗅探");
  }

  // ④ 规则 → 通用嗅探
  let messages: { role: string; content: string }[] | null = null;
  const { rules, fromLocal } = loadRules();
  const rule = matchRule(rules, url);
  if (rule) {
    messages = extractByRule($, rule);
    bumpHits(rule);
  }
  if (!messages || messages.length === 0) {
    messages = sniffMessages($);
  }
  if (messages && messages.length > 0) {
    writeDialogue(dir, url, rule ? `rule:${rule.platform}` : "sniff", messages);
    return { ok: true, messages };
  }
  return { ok: false, error: "未提取到消息（无规则命中 + 通用嗅探未识别——可用 console-script 浏览器兜底，或沉淀规则）" };
}

export async function fetchPage(config: EditorConfig, args: string[]): Promise<void> {
  const submissionId = args[0];
  if (!submissionId) {
    console.error("用法：pnpm editor fetch <submissionId>");
    process.exit(1);
  }
  const dir = draftDir(submissionId);
  const result = await extractSubmission(config, submissionId);
  if (!result.ok) {
    console.error(`[fetch] 提取失败：${result.error}`);
    console.error("[fetch] 处理：console-script 浏览器兜底 / rule-test 沉淀规则 / 人工核对链接");
    process.exit(1);
  }
  const users = result.messages!.filter((m) => m.role === "user").length;
  const words = result.messages!.reduce((n, m) => n + m.content.length, 0);
  console.log(`[fetch] ✅ 提取成功：${result.messages!.length} 条消息（user ${users} / assistant ${result.messages!.length - users}），共 ${words} 字 → dialogue.json`);
  console.log("[fetch] 下一步：基于 dialogue.json 生成脚本（脚本生成规范见 skill ④）");
}
