// 采集 + 内容解码（编辑本地管线的一环）：从投稿 URL 拉取页面并解码落盘
//   pnpm editor fetch <submissionId>
//   ① 详情拿 URL → 拉取页面（UA 伪装、跟随重定向、30s 超时）
//   ② 解码落盘草稿目录：
//      · page.html      原始 HTML（保留供排查/规则沉淀）
//      · page.txt       清洗后正文（去 script/style/导航壳，规范化空白）
//      · dialogue.json  提取的消息 [{role, content}]
//   ③ 提取策略（自进化，规则在 .dailog-editor/rules.json——本地读写，无需 build）：
//      1. 规则库匹配（host+pathPrefix → user/assistant/content 选择器）；命中 hits+1 写回
//      2. 无规则命中 → 通用嗅探（data-message-author-role 容器）
//      3. 都失败 → 提示沉淀新规则（浏览器兜底后直接更新 .dailog-editor/rules.json，下次生效）
//   首次使用：从工程种子（assets/rules.json）自动初始化复制到 .dailog-editor/rules.json
import { writeFileSync, existsSync, readFileSync } from "node:fs";
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

/** 共享提取：拉取 + 解码 + 落盘（fetch 命令与 batch 批量处理共用）。
 *  返回 { ok, messages?, error? }——失败给出原因（反爬/失效/未提取到消息）。 */
export async function extractSubmission(
  config: EditorConfig,
  submissionId: string,
): Promise<{ ok: boolean; messages?: { role: string; content: string }[]; error?: string }> {
  const dir = draftDir(submissionId);
  const detail = (await api(config, `/v1/editor/submissions/${submissionId}`)) as { url: string };

  // 拉取页面
  let res: Response;
  try {
    res = await fetch(detail.url, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "拉取失败（反爬/超时——可用 console-script 浏览器兜底）" };
  }
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}（${res.status === 403 ? "可能被反爬拦截" : "链接可能失效"}）` };
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/json") && !contentType.includes("text/plain")) {
    return { ok: false, error: `响应不是 HTML（${contentType}）` };
  }
  const raw = await res.text();
  const html = raw.length > MAX_HTML_BYTES ? raw.slice(0, MAX_HTML_BYTES) : raw;
  writeFileSync(join(dir, "page.html"), html);

  // 清洗正文（page.txt 始终落盘）
  const $ = loadHtml(html);
  $("script,style,noscript,template,svg,iframe,link,meta").remove();
  $("nav,footer,header,[role='navigation'],[role='banner'],[role='dialog'],[class*='cookie'],[class*='Cookie'],[id*='cookie']").remove();
  const bodyText = normalizeText($("body").text());
  writeFileSync(join(dir, "page.txt"), bodyText);

  // 提取：规则库 → 通用嗅探
  let messages: { role: string; content: string }[] | null = null;
  const { rules, fromLocal } = loadRules();
  const rule = matchRule(rules, detail.url);
  if (rule) {
    messages = extractByRule($, rule);
    bumpHits(rule);
  }
  if (!messages || messages.length === 0) {
    messages = sniffMessages($);
  }
  if (messages && messages.length > 0) {
    writeFileSync(join(dir, "dialogue.json"), JSON.stringify({ sourceUrl: detail.url, source: rule ? `rule:${rule.platform}` : "sniff", messages }, null, 2));
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
