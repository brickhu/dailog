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
import { writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";
import { load as loadHtml } from "cheerio";
import type { EditorConfig } from "./lib.js";
import { api, defaultAssetsDir, draftDir, rulesPath, writeProgress } from "./lib.js";
import { putR2Object, deleteR2Object, getR2Object, dialogueR2Key } from "./r2.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 30_000;
const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5MB 上限（超长页截断）

// —— 内容过短硬门槛（采集层直接拒审，不落草稿）——
export const MIN_USER_TURNS = 3; // user 轮次下限
export const MIN_CHARS = 500;    // 总字数下限
export const SHORT_REASON = "Conversation too short: dialogue rounds must exceed 3, and total message length must be greater than 500 characters.";

export function isTooShort(users: number, words: number): boolean {
  return users < MIN_USER_TURNS || words < MIN_CHARS;
}

/** 过短投稿：删除已落盘 dialogue.json（不保留草稿）+ 直接拒审（reason 统一）——单条 fetch / 批量采集共用 */
export async function rejectShort(config: EditorConfig, submissionId: string, users: number, words: number): Promise<void> {
  // 过短投稿：删本地对话 + R2 对话（URL 哈希 key）
  const localDlg = join(draftDir(submissionId), "dialogue.json");
  let url: string | null = null;
  try {
    if (existsSync(localDlg)) {
      const d = JSON.parse(readFileSync(localDlg, "utf-8"));
      url = d?.sourceUrl || null;
    }
  } catch { /* 忽略 */ }
  rmSync(localDlg, { force: true });
  if (url) {
    try { await deleteR2Object(config, dialogueR2Key(url)); }
    catch (e) { console.warn(`[fetch] R2 对话删除失败：${(e as Error).message?.slice(0, 120)}`); }
  }
  try {
    await api(config, `/v1/editor/submissions/${submissionId}/reject`, { method: "POST", body: { reason: SHORT_REASON } });
    writeProgress(submissionId, "rejected");
  } catch (e) {
    console.warn(`[fetch] 拒审失败（${submissionId}）：${(e as Error).message}`);
  }
}

export interface DecodeRule {
  platform: string;
  host: string;
  pathPrefix?: string;
  userSelector: string;
  assistantSelector: string;
  contentSelector?: string | null;
  /** 角色专属正文容器（优先于 contentSelector；Gemini 等两端结构不同的平台用） */
  userContentSelector?: string | null;
  assistantContentSelector?: string | null;
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

/** 按规则提取（user/assistant 选择器联合匹配，matches 判定角色；
 *  内容优先级：角色专属 userContentSelector/assistantContentSelector → contentSelector → 自身；
 *  专属选择器命中多个元素时按文档序拼接（多段正文），contentSelector 取首个） */
function extractByRule($: ReturnType<typeof loadHtml>, rule: DecodeRule): { role: string; content: string }[] {
  const messages: { role: string; content: string }[] = [];
  const joined = `${rule.userSelector}, ${rule.assistantSelector}`;
  $(joined).each((_, el) => {
    const $el = $(el);
    const isUser = $el.is(rule.userSelector);
    const perRoleSel = isUser ? rule.userContentSelector : rule.assistantContentSelector;
    let text = "";
    if (perRoleSel) {
      text = normalizeText(
        $(el).find(perRoleSel).map((_, c) => $(c).text()).get().join("\n"),
      );
    } else if (rule.contentSelector) {
      const $content = $el.find(rule.contentSelector).first();
      text = normalizeText($content.length > 0 ? $content.text() : $el.text());
    } else {
      text = normalizeText($el.text());
    }
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

interface PlatformInfo { api?: "deepseek" | "doubao"; ssr?: "chatgpt"; gemini?: boolean; grok?: boolean }

/** 平台识别（host + pathPrefix）——命中则优先走对应直取路径 */
function detectPlatform(url: string): PlatformInfo | null {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const path = u.pathname;
    if (host === "chat.deepseek.com" && path.startsWith("/share/")) return { api: "deepseek" };
    if (host === "www.doubao.com" && path.startsWith("/share/")) return { api: "doubao" };
    if (host === "chatgpt.com" && path.startsWith("/share/")) return { ssr: "chatgpt" };
    if ((host === "share.gemini.google" || host === "gemini.google.com") && path.startsWith("/")) return { gemini: true };
    // Grok 分享（x.com/i/grok/share/<id>——React SPA，对话客户端渲染，需 Chromium 无头渲染）
    if ((host === "x.com" || host === "twitter.com") && path.startsWith("/i/grok/share/")) return { grok: true };
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
/** 提取页面标题：<title> 或 og:title；清洗空白与平台后缀；无则 null */
function extractPageTitle(html: string): string | null {
  try {
    const $ = loadHtml(html);
    let title = $("meta[property='og:title']").attr("content") || $("title").first().text() || "";
    title = title.trim();
    if (!title) return null;
    // 去掉常见平台后缀（“ - ChatGPT”等）
    title = title.replace(/\s*[|\-—–]\s*(ChatGPT|Claude|DeepSeek|Gemini|豆包|Grok|Doubao|OpenAI|Anthropic|Google)\s*$/i, "").trim();
    return title.length > 200 ? title.slice(0, 200) : title || null;
  } catch { return null; }
}

/** 采集失败标记：collected=-1（列表显示红底✗） */
async function markDialogueError(config: EditorConfig, submissionId: string, tokenOverride?: string | null): Promise<void> {
  try {
    await api(config, `/v1/editor/submissions/${submissionId}/collected`, { method: "PATCH", body: { collected: -1 } }, tokenOverride);
  } catch { /* 失败标记写不上也不影响 */ }
}

/** 采集成功标记：collected=1（R2 key 由 URL 哈希推导，不存库） */
async function markDialogueFetched(config: EditorConfig, submissionId: string, url: string, tokenOverride?: string | null): Promise<void> {
  try {
    await api(config, `/v1/editor/submissions/${submissionId}/collected`, { method: "PATCH", body: { collected: 1 } }, tokenOverride);
  } catch { /* 回写失败不影响采集 */ }
}

async function writeDialogue(config: EditorConfig, dir: string, url: string, source: string, messages: { role: string; content: string }[], title: string | null = null): Promise<void> {
  const data = { sourceUrl: url, source, title, messages };
  writeFileSync(join(dir, "dialogue.json"), JSON.stringify(data, null, 2));
  // 同步上传 R2（URL 哈希确定性 key——多端共享；失败不阻塞采集，仅告警）
  try {
    await putR2Object(config, dialogueR2Key(url), JSON.stringify(data));
  } catch (e) {
    console.warn(`[fetch] R2 对话上传失败（${(e as Error).message?.slice(0, 120)}）——对话仅存本地`);
  }
}

/** 共享提取：平台直取 + 拉取 + 解码 + 落盘（fetch 命令与 batch 批量处理共用）。
 *  返回 { ok, messages?, error? }——失败给出原因（反爬/失效/未提取到消息）。 */
// ─────────────────────────────────────────────────────────────
// Gemini 分享（2026-08-25 实测结构）：分享页是 Angular SSR（对话在 HTML 组件树里，非客户端渲染）
//   · 短链 https://share.gemini.google/<短码> → 301 → https://gemini.google.com/share/<规范ID>?skid=...
//   · 规范页 HTML 含 share-turn-viewer（每轮 user-query + response-container）
//   · 用户正文 .query-text-line（可多段），助手正文 message-content .markdown
//   · skid 是分享者标识参数，抓取时需保留（不带 skid 可能拿到壳页）
// ─────────────────────────────────────────────────────────────

/** Gemini 规范 URL 解析：短链 301 重定向到规范页（带 skid）。返回规范 URL；失败返回 null */
export async function resolveGeminiCanonical(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (u.hostname === "gemini.google.com" && u.pathname.startsWith("/share/")) return url; // 已是规范页
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      headers: { "user-agent": UA, accept: "text/html,*/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) return new URL(loc, url).href;
    return url; // 无重定向 → 原样用（短链也可能直接 200 SSR）
  } catch {
    return null;
  }
}

/** Gemini 规则提取（复用通用 extractByRule——规则已含 per-role content selector） */
export function extractGeminiByRule($: ReturnType<typeof loadHtml>): { role: string; content: string }[] | null {
  const messages: { role: string; content: string }[] = [];
  $("share-turn-viewer user-query, share-turn-viewer response-container").each((_, el) => {
    const $el = $(el);
    const isUser = $el.is("share-turn-viewer user-query");
    const perRoleSel = isUser ? ".query-text-line" : "message-content .markdown";
    const text = normalizeText($el.find(perRoleSel).map((_, c) => $(c).text()).get().join("\n"));
    if (text) messages.push({ role: isUser ? "user" : "assistant", content: text });
  });
  return messages.length > 0 ? messages : null;
}

/** Gemini 采集入口：短链 → 规范 URL → SSR 拉取 → 规则提取。
 *  返回 null 表示当前环境无法完成（网络/代理不可用等），回退通用 HTML 流程。 */
/** 查找可用的 Chromium/headless-shell 可执行文件（Playwright 缓存 → 系统 Chrome）。
 *  优先级：headless shell（chrome-headless-shell/headless_shell——专为无头设计，无 crashpad 依赖，
 *  沙箱/CI 环境最稳）→ 完整 Chromium/Chrome（
 *  注意：先找 headless shell 再找完整浏览器——完整浏览器在受限沙箱下可能因 crashpad/updater 权限失败） */
function findChromium(): string | null {
  const candidates: string[] = [];
  // Playwright 缓存（ms-playwright）
  const cache = join(process.env.HOME ?? "", "Library", "Caches", "ms-playwright");
  try {
    const headlessNames = new Set(["chrome-headless-shell", "headless_shell"]);
    const fullNames = new Set(["Chromium", "chrome", "Google Chrome for Testing"]);
    const walk = (p: string, depth: number, names: Set<string>): string | null => {
      if (depth > 5) return null;
      try {
        for (const en of readdirSync(p, { withFileTypes: true })) {
          const fp = join(p, en.name);
          if (en.isDirectory()) { const r = walk(fp, depth + 1, names); if (r) return r; }
          else if (names.has(en.name)) return fp;
        }
      } catch { /* 忽略 */ }
      return null;
    };
    // 第一轮：headless shell（优先）
    for (const dir of readdirSync(cache)) {
      if (!dir.startsWith("chromium_headless_shell")) continue;
      const hit = walk(join(cache, dir), 0, headlessNames);
      if (hit) candidates.push(hit);
    }
    // 第二轮：完整 Chromium/Chrome（headless 缺失时兜底）
    for (const dir of readdirSync(cache)) {
      if (dir.startsWith("chromium_headless_shell")) continue;
      const hit = walk(join(cache, dir), 0, fullNames);
      if (hit) candidates.push(hit);
    }
  } catch { /* 缓存不存在 */ }
  candidates.push(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  );
  return candidates.find((c) => existsSync(c)) ?? null;
}/** Chromium 无头渲染 URL → 渲染后 HTML（分享页等客户端渲染页面用）。
 *  proxy: SOCKS5 代理地址（host:port）或 null。返回 null 表示渲染失败。 */
function renderWithChromium(url: string, proxy: string | null): string | null {
  const chromium = findChromium();
  if (!chromium) return null;
  // 独立 user-data-dir：无头 Chrome 默认找不到唯一用户数据目录会直接失败
  // （"Failed to create a unique user data directory for headless"）——实测必加
  const userDataDir = join(osTmpdir(), "dailog-render-" + Math.random().toString(36).slice(2, 10));
  const args = [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--user-data-dir=" + userDataDir,
    "--virtual-time-budget=15000",
    "--dump-dom",
  ];
  if (proxy) args.push("--proxy-server=socks5://" + proxy);
  args.push(url);
  try {
    return execFileSync(chromium, args, { encoding: "utf-8", timeout: 90_000, maxBuffer: MAX_HTML_BYTES * 6 });
  } catch {
    return null;
  }
}

/** Gemini 采集入口：规范 URL 解析 → Chromium 无头渲染（客户端渲染的分享页必须真实渲染）
 *  → DOM 规则提取。返回 { ok, messages?, handled, error? } */
async function extractGemini(config: EditorConfig, submissionId: string, url: string): Promise<{
  ok: boolean; messages?: { role: string; content: string }[]; error?: string; handled: boolean;
}> {
  const dir = draftDir(submissionId);
  const canonical = await resolveGeminiCanonical(url);
  const target = canonical ?? url;

  // ① Chromium 无头渲染（客户端渲染页面，curl 只能拿到壳）
  let html = renderWithChromium(target, findSocksProxy());
  if (!html) {
    // 回退：直连拉 SSR（可能拿到壳，但保留现场）
    try {
      const res = await fetch(target, {
        headers: { "user-agent": UA, accept: "text/html,*/*", "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) html = await res.text();
    } catch { /* 忽略 */ }
  }
  if (!html) {
    return { ok: false, handled: true, error: "Gemini 渲染失败（无 Chromium / 网络不可用）——可 console-script 浏览器兜底" };
  }
  if (html.length > MAX_HTML_BYTES * 4) html = html.slice(0, MAX_HTML_BYTES * 4);
  writeFileSync(join(dir, "page.html"), html);

  // 清洗正文落盘 page.txt
  const $ = loadHtml(html);
  $("script,style,noscript,template,svg,iframe,link,meta").remove();
  $("nav,footer,header,[role='navigation'],[role='banner'],[role='dialog'],[class*='cookie'],[class*='Cookie'],[id*='cookie']").remove();
  writeFileSync(join(dir, "page.txt"), normalizeText($("body").text()));

  // ② DOM 规则提取（per-role）
  const { rules } = loadRules();
  const rule = matchRule(rules, target) ?? matchRule(rules, url);
  const messages = extractGeminiByRule($);
  if (messages) {
    await writeDialogue(config, dir, target, rule ? `rule:${rule.platform}` : "rule:gemini", messages, detail.title);
    await markDialogueFetched(config, submissionId, url, tokenOverride);
    if (rule) bumpHits(rule);
    return { ok: true, handled: true, messages };
  }
  return { ok: false, handled: true, error: "Gemini 渲染后未提取到 share-turn-viewer（可能加载超时/反爬）——可 console-script 浏览器兜底" };
}

// ─────────────────────────────────────────────────────────────
// Grok 分享（2026-08-26 实测结构）：x.com/i/grok/share/<id> 是 React SPA——
// 对话在客户端渲染（curl 只能拿壳，__INITIAL_STATE__ 的 grokShare 为空），必须 Chromium 无头渲染。
// 渲染后 DOM：每轮对话 turn 容器 div.r-obd0qt.r-1cmwbt1 内 user 段 + assistant 段
//   · user 段：div.r-obd0qt.r-1cmwbt1 > div.r-1habvwh（正文 .r-1kt6imw）
//   · assistant 段：div.r-1awozwy.r-16lk18l（正文 .r-rjixqe.r-16dba41.r-imh66m）
// 分享页未登录也渲染完整对话（登录横幅与对话并存），选择器不受影响。
// 直连 x.com 被网络封锁（SSL_ERROR_SYSCALL）→ 渲染必须走本地 SOCKS5 代理。
// ─────────────────────────────────────────────────────────────

const GROK_USER_SELECTOR = "div.r-obd0qt.r-1cmwbt1 > div.r-1habvwh";
const GROK_ASSISTANT_SELECTOR = "div.r-1awozwy.r-16lk18l";
const GROK_USER_CONTENT = ".r-1kt6imw";
const GROK_ASSISTANT_CONTENT = ".r-rjixqe.r-16dba41.r-imh66m";

/** Grok 规则提取（内置选择器——规则库未命中时的兜底；与 extractByRule 同逻辑） */
export function extractGrokByRule($: ReturnType<typeof loadHtml>): { role: string; content: string }[] | null {
  const messages: { role: string; content: string }[] = [];
  const joined = GROK_USER_SELECTOR + ", " + GROK_ASSISTANT_SELECTOR;
  $(joined).each((_, el) => {
    const $el = $(el);
    const isUser = $el.is(GROK_USER_SELECTOR);
    const perRoleSel = isUser ? GROK_USER_CONTENT : GROK_ASSISTANT_CONTENT;
    const text = normalizeText(
      $el.find(perRoleSel).map((_, c) => $(c).text()).get().join("\n"),
    );
    if (text) messages.push({ role: isUser ? "user" : "assistant", content: text });
  });
  return messages.length > 0 ? messages : null;
}

/** Grok 采集入口：Chromium 无头渲染（分享页客户端渲染 + 直连被封锁 → 必须真实渲染且走代理）
 *  → DOM 规则提取。返回 { ok, messages?, handled, error? } */
async function extractGrok(config: EditorConfig, submissionId: string, url: string): Promise<{
  ok: boolean; messages?: { role: string; content: string }[]; error?: string; handled: boolean;
}> {
  const dir = draftDir(submissionId);

  // ① Chromium 无头渲染（客户端渲染页面，curl 只能拿壳；x.com 直连被封锁 → 走 SOCKS5 代理）
  let html = renderWithChromium(url, findSocksProxy());
  if (!html) {
    // 回退：直连拉 SSR（大概率失败/壳页，但保留现场）
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html,*/*", "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) html = await res.text();
    } catch { /* 忽略 */ }
  }
  if (!html) {
    return { ok: false, handled: true, error: "Grok 渲染失败（无 Chromium / 网络不可用）——可 console-script 浏览器兜底" };
  }
  if (html.length > MAX_HTML_BYTES * 4) html = html.slice(0, MAX_HTML_BYTES * 4);
  writeFileSync(join(dir, "page.html"), html);

  // 清洗正文落盘 page.txt
  const $ = loadHtml(html);
  $("script,style,noscript,template,svg,iframe,link,meta").remove();
  $("nav,footer,header,[role='navigation'],[role='banner'],[role='dialog'],[class*='cookie'],[class*='Cookie'],[id*='cookie']").remove();
  writeFileSync(join(dir, "page.txt"), normalizeText($("body").text()));

  // ② DOM 规则提取（规则库命中 → 按规则；未命中 → 内置 Grok 选择器）
  const { rules } = loadRules();
  const rule = matchRule(rules, url);
  const messages = rule ? extractByRule($, rule) : extractGrokByRule($);
  if (messages && messages.length > 0) {
    await writeDialogue(config, dir, url, rule ? "rule:" + rule.platform : "rule:grok", messages, detail.title);
    await markDialogueFetched(config, submissionId, url, tokenOverride);
    if (rule) bumpHits(rule);
    return { ok: true, handled: true, messages };
  }
  return { ok: false, handled: true, error: "Grok 渲染后未提取到消息（可能加载超时/反爬）——可 console-script 浏览器兜底" };
}


/** 平台名（url → guests 表 platform 字段：api/ssr 直取平台名，gemini/grok 用品牌名） */
function platformOfUrl(url: string): string | null {
  const p = detectPlatform(url);
  if (!p) return null;
  if (p.api) return p.api;
  if (p.ssr) return p.ssr;
  if (p.gemini) return "gemini";
  if (p.grok) return "grok";
  return null;
}

/** 投稿信息落盘 info.json（script-lab 测试注入用：suggestion/host/guests 即信封 key；
 *  与 detail.ts 字段对齐；guests 按平台从 guests 表匹配，无则仅 platform 兜底） */
async function writeSubmissionInfo(
  config: EditorConfig,
  dir: string,
  submissionId: string,
  detail: {
    url: string;
    title: string | null;
    userEmail: string;
    personaInfo: {
      displayName: string;
      gender: string | null;
      profession: string | null;
      age: string | null;
      bio: string | null;
      nationality: string | null;
    } | null;
    callName: string | null;
    suggestion: string | null;
  },
  tokenOverride?: string | null,
): Promise<void> {
  const platform = platformOfUrl(detail.url);
  let guests: { name: string; platform: string; intro: string | null }[] = [];
  try {
    const list = (await api(config, "/v1/editor/guests", {}, tokenOverride)) as
      | Array<{ platform: string; name: string; intro: string | null }>
      | null;
    const hit = Array.isArray(list) ? list.find((g) => g.platform === platform) : null;
    if (hit) guests = [{ name: hit.name, platform: hit.platform, intro: hit.intro ?? null }];
  } catch { /* guests 表不可用 → 仅 platform 兜底 */ }
  if (guests.length === 0 && platform) {
    guests = [{ name: platform, platform, intro: null }];
  }
  writeFileSync(
    join(dir, "info.json"),
    JSON.stringify(
      {
        submissionId,
        title: detail.title ?? null,
        url: detail.url,
        platform,
        suggestion: detail.suggestion ?? null,
        host: {
          callName: detail.callName ?? null,
          personaInfo: detail.personaInfo ?? null,
        },
        guests,
      },
      null,
      2,
    ),
  );
}

export async function extractSubmission(
  config: EditorConfig,
  submissionId: string,
  tokenOverride?: string | null,
): Promise<{ ok: boolean; messages?: { role: string; content: string }[]; error?: string }> {
  const dir = draftDir(submissionId);
  const detail = (await api(config, `/v1/editor/submissions/${submissionId}`, {}, tokenOverride)) as {
    url: string;
    title: string | null;
    userEmail: string;
    personaInfo: {
      displayName: string;
      gender: string | null;
      profession: string | null;
      age: string | null;
      bio: string | null;
      nationality: string | null;
    } | null;
    callName: string | null;
    suggestion: string | null;
  };
  const url = detail.url;
  const platform = detectPlatform(url);
  // 投稿信息落盘（suggestion/host/guests）——fetch 时信息最全，script-lab 测试直接 --input info.json
  await writeSubmissionInfo(config, dir, submissionId, detail, tokenOverride);

  // ⓪ R2 缓存优先：同一 URL 已采集过（多端共享）→ 直接落盘本地，跳过抓取
  try {
    const cached = await getR2Object(config, dialogueR2Key(url));
    const cachedJson = JSON.parse(Buffer.from(cached).toString("utf8"));
    if (cachedJson && Array.isArray(cachedJson.messages) && cachedJson.messages.length > 0) {
      writeFileSync(join(dir, "dialogue.json"), JSON.stringify(cachedJson, null, 2));
      console.log(`[fetch] R2 缓存命中（${dialogueR2Key(url).slice(0, 40)}…）——直接使用已有对话，跳过采集`);
      await markDialogueFetched(config, submissionId, url, tokenOverride);
      return { ok: true, messages: cachedJson.messages };
    }
  } catch { /* R2 无此 URL（或网络失败）→ 走正常采集流 */ }

  // 标题回写数据库（submissions.title 权威）：有效标题（非通用文案）且非缓存命中时同步
  if (url) {
    try {
      const cur = await api(config, `/v1/editor/submissions/${submissionId}`, {}, tokenOverride) as { title?: string | null };
      const extracted = detail.title;
      const generic = /^(来自分享的对话|来看看这段聊天|查看对话|分享的对话)$/i;
      if (extracted && !generic.test(extracted.trim()) && cur?.title !== extracted) {
        await api(config, `/v1/editor/submissions/${submissionId}/title`, { method: "PATCH", body: { title: extracted } }, tokenOverride);
        console.log(`[fetch] 已回写投稿标题：${extracted.slice(0, 50)}`);
      }
    } catch { /* 回写失败不影响采集 */ }
  }

  // ① 平台 API 直取（deepseek/doubao——SSR 壳无内容的平台首选，结构化命中直接用）
  if (platform?.api) {
    const apiMsgs = platform.api === "deepseek" ? await extractDeepseekApi(url) : await extractDoubaoApi(url);
    if (apiMsgs && apiMsgs.length > 0) {
      await writeDialogue(config, dir, url, `api:${platform.api}`, apiMsgs, detail.title);
    await markDialogueFetched(config, submissionId, url, tokenOverride);
      return { ok: true, messages: apiMsgs };
    }
    console.log(`[fetch] ${platform.api} 分享 API 未命中 → 回退 HTML 提取`);
  }

  // ①.5 Gemini：短链 → 规范 URL → SSR 规则提取（分享页 Angular SSR，对话在组件树里）
  if (platform?.gemini) {
    const g = await extractGemini(config, submissionId, url);
    if (g.ok && g.messages) return { ok: true, messages: g.messages };
    if (g.handled) {
      // SSR 拉取成功但提取失败（壳页）→ 已落盘 page.html/page.txt，走通用规则/嗅探再试一次
      console.log(`[fetch] gemini 专用路径：${g.error}`);
    }
  }

  // ①.6 Grok：Chromium 无头渲染（React SPA 客户端渲染 + x.com 直连被封锁 → 必须真实渲染走代理）
  if (platform?.grok) {
    const g = await extractGrok(config, submissionId, url);
    if (g.ok && g.messages) return { ok: true, messages: g.messages };
    if (g.handled) {
      console.log(`[fetch] grok 专用路径：${g.error}`);
    }
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
    await markDialogueError(config, submissionId, tokenOverride);
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

  // 页面标题（分享页 <title>/og:title）——作为原始对话标题；无则用 detail.title
  const pageTitle = extractPageTitle(html) || detail.title;

  // ③ chatgpt：SSR 流解码优先（对话完整在流数据里，不依赖 DOM 渲染）
  if (platform?.ssr) {
    const ssrMsgs = messagesFromChatgptStream(html);
    if (ssrMsgs && ssrMsgs.length > 0) {
      await writeDialogue(config, dir, url, "ssr:chatgpt", ssrMsgs, pageTitle);
    await markDialogueFetched(config, submissionId, url, tokenOverride);
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
    await writeDialogue(config, dir, url, rule ? `rule:${rule.platform}` : "sniff", messages, pageTitle);
    await markDialogueFetched(config, submissionId, url, tokenOverride);
    return { ok: true, messages };
  }
  await markDialogueError(config, submissionId, tokenOverride);
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
  if (isTooShort(users, words)) {
    await rejectShort(config, submissionId, users, words);
    console.log(`[fetch] ⛔ 内容过短（user ${users} 轮 / ${words} 字 < ${MIN_USER_TURNS} 轮 / ${MIN_CHARS} 字）——已直接拒审（原因：${SHORT_REASON}），不落草稿`);
    return;
  }
  console.log(`[fetch] ✅ 提取成功：${result.messages!.length} 条消息（user ${users} / assistant ${result.messages!.length - users}），共 ${words} 字 → dialogue.json`);
  console.log("[fetch] 下一步：基于 dialogue.json 生成脚本（脚本生成规范见 skill ④）");
}
