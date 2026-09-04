// lab 自包含采集模块（原始对话内容采集——不依赖 tools/dailog-cli）
// 来源：tools/dailog-cli/src/fetch.ts 编译产物的移植（CLI 源码保留，待退役后删除）。
// 由 tools/script-lab/scripts/sync-collect.mjs 生成——改动请改 CLI 源后重新同步，勿手改本文件。
// 与 CLI 版的差异仅接线层，采集逻辑同源：
//   · 不经投稿详情服务端 API——lab 已持有 url/title，用 collectDialogue(url, { title }) 直取；
//   · 运行时规则共用 <repo>/.dailog-editor/rules.json（自进化读写）；种子随 lab 分发 assets/rules.json；
//   · 平台逆向知识（deepseek/doubao API、chatgpt SSR、gemini/grok Chromium、规则+嗅探）与 CLI 版一致。
import { writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir as osTmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load as loadHtml } from "cheerio";
// —— lab 本地接线（替代 CLI lib.js 依赖）——
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LAB_ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
function rulesPath() { return join(REPO_ROOT, '.dailog-editor', 'rules.json'); }
function defaultAssetsDir() { return LAB_ASSETS_DIR; }
function draftDir(submissionId) { return join(osTmpdir(), 'dailog-lab-drafts', String(submissionId ?? 'lab')); }
function api() { throw new Error('[collect] 采集不经服务端详情——请用 collectDialogue(url, { title })'); }
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 3e4;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
function normalizeText(s) {
  return s.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}
function readRulesFile(path) {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(data?.rules) ? data.rules : [];
  } catch {
    return null;
  }
}
function loadRules() {
  const local = rulesPath();
  const localRules = readRulesFile(local);
  if (localRules) return { rules: localRules, fromLocal: true };
  const fallback = readRulesFile(join(defaultAssetsDir(), "rules.json"));
  if (fallback) {
    console.log(`[fetch] \u89C4\u5219\u5E93\uFF1A\u672C\u5730\u65E0 \u2192 fallback \u4EA7\u7269\u79CD\u5B50\uFF08${fallback.length} \u6761\uFF09`);
    return { rules: fallback, fromLocal: false };
  }
  return { rules: [], fromLocal: true };
}
function bumpHits(rule) {
  const local = rulesPath();
  let rules = readRulesFile(local);
  if (!rules) {
    const seed = readRulesFile(join(defaultAssetsDir(), "rules.json"));
    rules = seed ?? [];
    if (seed) console.log(`[fetch] \u89C4\u5219\u5E93\u5DF2\u521D\u59CB\u5316\u5230\u672C\u5730\uFF1A${local}\uFF08${seed.length} \u6761\uFF09`);
  }
  const target = rules.find((r) => r.platform === rule.platform && r.host === rule.host);
  if (target) target.hits = (target.hits ?? 0) + 1;
  writeFileSync(local, JSON.stringify({ version: 1, note: "dailog \u7F16\u8F91\u89E3\u7801\u89C4\u5219\u5E93\uFF08\u672C\u5730\u81EA\u8FDB\u5316\uFF09\u2014\u2014\u8FD0\u884C\u65F6\u8BFB\u5199\uFF0C\u65E0\u9700 build", rules }, null, 2));
}
function matchRule(rules, url) {
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
function extractByRule($, rule) {
  const messages = [];
  const joined = `${rule.userSelector}, ${rule.assistantSelector}`;
  $(joined).each((_, el) => {
    const $el = $(el);
    const isUser = $el.is(rule.userSelector);
    const perRoleSel = isUser ? rule.userContentSelector : rule.assistantContentSelector;
    let text = "";
    if (perRoleSel) {
      text = normalizeText(
        $(el).find(perRoleSel).map((_2, c) => $(c).text()).get().join("\n")
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
function sniffMessages($) {
  const roleEls = $("[data-message-author-role]");
  if (roleEls.length === 0) return null;
  const messages = [];
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
function detectPlatform(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const path = u.pathname;
    if (host === "chat.deepseek.com" && path.startsWith("/share/")) return { api: "deepseek" };
    if (host === "www.doubao.com" && (path.startsWith("/share/") || path.startsWith("/thread/"))) return { api: "doubao" };
    if (host === "chatgpt.com" && path.startsWith("/share/")) return { ssr: "chatgpt" };
    if ((host === "share.gemini.google" || host === "gemini.google.com") && path.startsWith("/")) return { gemini: true };
    if ((host === "x.com" || host === "twitter.com") && path.startsWith("/i/grok/share/")) return { grok: true };
    return null;
  } catch {
    return null;
  }
}
function shareIdOf(url, pathPrefix) {
  try {
    const m = new URL(url).pathname.match(new RegExp(`^${pathPrefix.replace(/\//g, "\\/")}([^/?#]+)`));
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}
async function extractDeepseekApi(url) {
  const id = shareIdOf(url, "/share/");
  if (!id) return null;
  let res;
  try {
    res = await fetch(`https://chat.deepseek.com/api/v0/share/content?share_id=${id}`, {
      headers: {
        "user-agent": UA,
        referer: `https://chat.deepseek.com/share/${id}`,
        accept: "application/json, text/plain, */*"
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const messages = data?.data?.biz_data?.messages ?? [];
  const out = messages.filter((m) => m.role === "USER" || m.role === "ASSISTANT").map((m) => ({ role: m.role.toLowerCase(), content: (m.content ?? "").trim() })).filter((m) => m.content.length > 0);
  return out.length > 0 ? out : null;
}
async function extractDoubaoApi(url) {
  const pathname = new URL(url).pathname;
  const prefix = pathname.startsWith("/thread/") ? "/thread/" : "/share/";
  const id = shareIdOf(url, prefix);
  if (!id) return null;
  let res;
  try {
    res = await fetch("https://www.doubao.com/im/message/share/get", {
      method: "POST",
      headers: {
        "user-agent": UA,
        "content-type": "application/json",
        origin: "https://www.doubao.com",
        referer: `https://www.doubao.com${prefix}${id}`
      },
      body: JSON.stringify({ share_id: id }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const list = data?.data?.message_snapshot?.message_list ?? [];
  const out = list.filter((m) => m.user_type === 1 || m.user_type === 2).map((m) => {
    let text = m.content ?? "";
    try {
      text = JSON.parse(text).text ?? text;
    } catch {
    }
    return { role: m.user_type === 1 ? "user" : "assistant", content: text.trim(), index: m.index_in_conv ?? 0 };
  }).filter((m) => m.content.length > 0).sort((a, b) => a.index - b.index).map(({ role, content }) => ({ role, content }));
  return out.length > 0 ? out : null;
}
function extractEnqueuePayloads(html) {
  const out = [];
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
      } catch {
      }
    }
    pos = Math.max(end + 1, start + marker.length);
  }
  return out;
}
function decodeStreamTable(raw) {
  const table = JSON.parse(raw);
  const visiting = /* @__PURE__ */ new Set();
  let depth = 0;
  const decode = (el) => {
    if (depth > 64) return null;
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
      const out = {};
      for (const [k, v] of Object.entries(el)) {
        const ki = Number(k.slice(1));
        if (!(ki >= 0 && ki < table.length)) continue;
        out[String(decode(table[ki]))] = typeof v === "number" && v < 0 ? null : decode(typeof v === "number" && v < table.length ? table[v] : v);
      }
      return out;
    }
    return el;
  };
  return decode(table[0]);
}
function extractMessagesFromLinear(lc) {
  const out = [];
  for (const entry of lc) {
    const msg = entry?.message;
    if (!msg) continue;
    const role = msg.author?.role;
    if (role !== "user" && role !== "assistant") continue;
    const parts = msg.content?.parts;
    const text = (Array.isArray(parts) ? parts.filter((p) => typeof p === "string") : []).join("\n").trim();
    if (text) out.push({ role, content: text });
  }
  return out;
}
function findConversation(node) {
  if (!node || typeof node !== "object" && !Array.isArray(node)) return null;
  if (!Array.isArray(node)) {
    const lc = node.linear_conversation;
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
function messagesFromChatgptStream(html) {
  for (const raw of extractEnqueuePayloads(html)) {
    let payload;
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
function findSocksProxy() {
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
function fetchViaProxy(url, proxy) {
  return execFileSync(
    "curl",
    [
      "-sS",
      "-L",
      "-m",
      String(Math.round(FETCH_TIMEOUT_MS / 1e3)),
      "--socks5-hostname",
      proxy,
      "-A",
      UA,
      "-H",
      "accept-language: zh-CN,zh;q=0.9,en;q=0.8",
      url
    ],
    { encoding: "utf-8", maxBuffer: MAX_HTML_BYTES * 2 }
  );
}
const GENERIC_TITLE = /^(来自分享的对话|来看看这段聊天|查看对话|分享的对话|ChatGPT|Google|Gemini|DeepSeek|Claude|豆包|Doubao)$/i;
function extractPageTitle(html) {
  try {
    const $ = loadHtml(html);
    const og = $("meta[property='og:title']").attr("content") || "";
    const tagTitle = $("title").first().text() || "";
    let title = (tagTitle || og).trim();
    if (GENERIC_TITLE.test(title.trim()) || title.length < 4) title = og.trim();
    if (!title) return null;
    title = title.replace(/^(ChatGPT|Claude|DeepSeek|Gemini|豆包|Doubao|Grok|OpenAI|Anthropic|Google)\s*[|:\-—–]\s*/i, "").replace(/\s*[|:\-—–]\s*(ChatGPT|Claude|DeepSeek|Gemini|豆包|Doubao|Grok|OpenAI|Anthropic|Google)\s*$/i, "").trim();
    if (!title || GENERIC_TITLE.test(title)) return null;
    return title.length > 200 ? title.slice(0, 200) : title;
  } catch {
    return null;
  }
}
async function resolveGeminiCanonical(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "gemini.google.com" && u.pathname.startsWith("/share/")) return url;
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      headers: { "user-agent": UA, accept: "text/html,*/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) return new URL(loc, url).href;
    return url;
  } catch {
    return null;
  }
}
function extractGeminiByRule($) {
  const messages = [];
  $("share-turn-viewer user-query, share-turn-viewer response-container").each((_, el) => {
    const $el = $(el);
    const isUser = $el.is("share-turn-viewer user-query");
    const perRoleSel = isUser ? ".query-text-line" : "message-content .markdown";
    const text = normalizeText($el.find(perRoleSel).map((_2, c) => $(c).text()).get().join("\n"));
    if (text) messages.push({ role: isUser ? "user" : "assistant", content: text });
  });
  return messages.length > 0 ? messages : null;
}
function findChromium() {
  const candidates = [];
  const cache = join(process.env.HOME ?? "", "Library", "Caches", "ms-playwright");
  try {
    const headlessNames = /* @__PURE__ */ new Set(["chrome-headless-shell", "headless_shell"]);
    const fullNames = /* @__PURE__ */ new Set(["Chromium", "chrome", "Google Chrome for Testing"]);
    const walk = (p, depth, names) => {
      if (depth > 5) return null;
      try {
        for (const en of readdirSync(p, { withFileTypes: true })) {
          const fp = join(p, en.name);
          if (en.isDirectory()) {
            const r = walk(fp, depth + 1, names);
            if (r) return r;
          } else if (names.has(en.name)) return fp;
        }
      } catch {
      }
      return null;
    };
    for (const dir of readdirSync(cache)) {
      if (!dir.startsWith("chromium_headless_shell")) continue;
      const hit = walk(join(cache, dir), 0, headlessNames);
      if (hit) candidates.push(hit);
    }
    for (const dir of readdirSync(cache)) {
      if (dir.startsWith("chromium_headless_shell")) continue;
      const hit = walk(join(cache, dir), 0, fullNames);
      if (hit) candidates.push(hit);
    }
  } catch {
  }
  candidates.push(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium"
  );
  return candidates.find((c) => existsSync(c)) ?? null;
}
function renderWithChromium(url, proxy) {
  const chromium = findChromium();
  if (!chromium) return null;
  const userDataDir = join(osTmpdir(), "dailog-render-" + Math.random().toString(36).slice(2, 10));
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--user-data-dir=" + userDataDir,
    "--virtual-time-budget=15000",
    "--dump-dom"
  ];
  if (proxy) args.push("--proxy-server=socks5://" + proxy);
  args.push(url);
  try {
    return execFileSync(chromium, args, { encoding: "utf-8", timeout: 9e4, maxBuffer: MAX_HTML_BYTES * 6 });
  } catch {
    return null;
  }
}
async function extractGemini(config, submissionId, url, title = null, tokenOverride) {
  const dir = draftDir(submissionId);
  const canonical = await resolveGeminiCanonical(url);
  const target = canonical ?? url;
  let html = renderWithChromium(target, findSocksProxy());
  if (!html) {
    try {
      const res = await fetch(target, {
        headers: { "user-agent": UA, accept: "text/html,*/*", "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (res.ok) html = await res.text();
    } catch {
    }
  }
  if (!html) {
    return { ok: false, handled: true, error: "Gemini \u6E32\u67D3\u5931\u8D25\uFF08\u65E0 Chromium / \u7F51\u7EDC\u4E0D\u53EF\u7528\uFF09\u2014\u2014\u53EF console-script \u6D4F\u89C8\u5668\u515C\u5E95" };
  }
  if (html.length > MAX_HTML_BYTES * 4) html = html.slice(0, MAX_HTML_BYTES * 4);
  const $ = loadHtml(html);
  $("script,style,noscript,template,svg,iframe,link,meta").remove();
  $("nav,footer,header,[role='navigation'],[role='banner'],[role='dialog'],[class*='cookie'],[class*='Cookie'],[id*='cookie']").remove();
  const { rules } = loadRules();
  const rule = matchRule(rules, target) ?? matchRule(rules, url);
  const messages = extractGeminiByRule($);
  const pageTitle = title || extractPageTitle(html);
  if (messages) {
    if (rule) bumpHits(rule);
    return { ok: true, handled: true, messages, title: pageTitle, source: rule ? `rule:${rule.platform}` : "rule:gemini", sourceUrl: target };
  }
  return { ok: false, handled: true, error: "Gemini \u6E32\u67D3\u540E\u672A\u63D0\u53D6\u5230 share-turn-viewer\uFF08\u53EF\u80FD\u52A0\u8F7D\u8D85\u65F6/\u53CD\u722C\uFF09\u2014\u2014\u53EF console-script \u6D4F\u89C8\u5668\u515C\u5E95" };
}
const GROK_USER_SELECTOR = "div.r-obd0qt.r-1cmwbt1 > div.r-1habvwh";
const GROK_ASSISTANT_SELECTOR = "div.r-1awozwy.r-16lk18l";
const GROK_USER_CONTENT = ".r-1kt6imw";
const GROK_ASSISTANT_CONTENT = ".r-rjixqe.r-16dba41.r-imh66m";
function extractGrokByRule($) {
  const messages = [];
  const joined = GROK_USER_SELECTOR + ", " + GROK_ASSISTANT_SELECTOR;
  $(joined).each((_, el) => {
    const $el = $(el);
    const isUser = $el.is(GROK_USER_SELECTOR);
    const perRoleSel = isUser ? GROK_USER_CONTENT : GROK_ASSISTANT_CONTENT;
    const text = normalizeText(
      $el.find(perRoleSel).map((_2, c) => $(c).text()).get().join("\n")
    );
    if (text) messages.push({ role: isUser ? "user" : "assistant", content: text });
  });
  return messages.length > 0 ? messages : null;
}
async function extractGrok(config, submissionId, url, title = null, tokenOverride) {
  const dir = draftDir(submissionId);
  let html = renderWithChromium(url, findSocksProxy());
  if (!html) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html,*/*", "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (res.ok) html = await res.text();
    } catch {
    }
  }
  if (!html) {
    return { ok: false, handled: true, error: "Grok \u6E32\u67D3\u5931\u8D25\uFF08\u65E0 Chromium / \u7F51\u7EDC\u4E0D\u53EF\u7528\uFF09\u2014\u2014\u53EF console-script \u6D4F\u89C8\u5668\u515C\u5E95" };
  }
  if (html.length > MAX_HTML_BYTES * 4) html = html.slice(0, MAX_HTML_BYTES * 4);
  const $ = loadHtml(html);
  $("script,style,noscript,template,svg,iframe,link,meta").remove();
  $("nav,footer,header,[role='navigation'],[role='banner'],[role='dialog'],[class*='cookie'],[class*='Cookie'],[id*='cookie']").remove();
  const { rules } = loadRules();
  const rule = matchRule(rules, url);
  const messages = rule ? extractByRule($, rule) : extractGrokByRule($);
  const pageTitle = title || extractPageTitle(html);
  if (messages && messages.length > 0) {
    if (rule) bumpHits(rule);
    return { ok: true, handled: true, messages, title: pageTitle, source: rule ? "rule:" + rule.platform : "rule:grok", sourceUrl: url };
  }
  return { ok: false, handled: true, error: "Grok \u6E32\u67D3\u540E\u672A\u63D0\u53D6\u5230\u6D88\u606F\uFF08\u53EF\u80FD\u52A0\u8F7D\u8D85\u65F6/\u53CD\u722C\uFF09\u2014\u2014\u53EF console-script \u6D4F\u89C8\u5668\u515C\u5E95" };
}
function platformOfUrl(url) {
  const p = detectPlatform(url);
  if (!p) return null;
  if (p.api) return p.api;
  if (p.ssr) return p.ssr;
  if (p.gemini) return "gemini";
  if (p.grok) return "grok";
  return null;
}
export async function collectDialogue(url, { title = null } = {}) {
  if (!url || typeof url !== 'string') return { ok: false, error: '投稿 URL 缺失' };
  const platform = detectPlatform(url);
  if (platform?.api) {
    const apiMsgs = platform.api === "deepseek" ? await extractDeepseekApi(url) : await extractDoubaoApi(url);
    if (apiMsgs && apiMsgs.length > 0) {
      return { ok: true, messages: apiMsgs, title: title || null, source: `api:${platform.api}`, sourceUrl: url };
    }
    console.log(`[fetch] ${platform.api} \u5206\u4EAB API \u672A\u547D\u4E2D \u2192 \u56DE\u9000 HTML \u63D0\u53D6`);
  }
  if (platform?.gemini) {
    const g = await extractGemini(null, null, url, title || null, null);
    if (g.ok && g.messages) return { ok: true, messages: g.messages, title: g.title, source: g.source, sourceUrl: g.sourceUrl };
    if (g.handled) {
      console.log(`[fetch] gemini \u4E13\u7528\u8DEF\u5F84\uFF1A${g.error}`);
    }
  }
  if (platform?.grok) {
    const g = await extractGrok(null, null, url, title || null, null);
    if (g.ok && g.messages) return { ok: true, messages: g.messages, title: g.title, source: g.source, sourceUrl: g.sourceUrl };
    if (g.handled) {
      console.log(`[fetch] grok \u4E13\u7528\u8DEF\u5F84\uFF1A${g.error}`);
    }
  }
  let html = null;
  let fetchError = null;
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!res.ok) {
      fetchError = `HTTP ${res.status}\uFF08${res.status === 403 ? "\u53EF\u80FD\u88AB\u53CD\u722C\u62E6\u622A" : "\u94FE\u63A5\u53EF\u80FD\u5931\u6548"}\uFF09`;
    } else {
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/json") && !contentType.includes("text/plain")) {
        fetchError = `\u54CD\u5E94\u4E0D\u662F HTML\uFF08${contentType}\uFF09`;
      } else {
        html = await res.text();
      }
    }
  } catch {
    fetchError = "\u62C9\u53D6\u5931\u8D25\uFF08\u53CD\u722C/\u8D85\u65F6\uFF09";
  }
  if (!html) {
    const proxy = findSocksProxy();
    if (proxy) {
      try {
        html = fetchViaProxy(url, proxy);
        console.log(`[fetch] \u76F4\u8FDE\u5931\u8D25\uFF08${fetchError ?? "\u65E0\u54CD\u5E94"}\uFF09\u2192 \u5DF2\u8D70\u672C\u5730 SOCKS5 \u4EE3\u7406 ${proxy} \u62C9\u53D6\u6210\u529F`);
      } catch {
      }
    }
  }
  if (!html) {
    return { ok: false, error: `${fetchError ?? "\u62C9\u53D6\u5931\u8D25"}\uFF08\u53EF\u7528 console-script \u6D4F\u89C8\u5668\u515C\u5E95\uFF09` };
  }
  if (html.length > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES);
  const $ = loadHtml(html);
  $("script,style,noscript,template,svg,iframe,link,meta").remove();
  $("nav,footer,header,[role='navigation'],[role='banner'],[role='dialog'],[class*='cookie'],[class*='Cookie'],[id*='cookie']").remove();
  const bodyText = normalizeText($("body").text());
  const pageTitle = extractPageTitle(html) || title || null;
  if (platform?.ssr) {
    const ssrMsgs = messagesFromChatgptStream(html);
    if (ssrMsgs && ssrMsgs.length > 0) {
      return { ok: true, messages: ssrMsgs, title: pageTitle, source: "ssr:chatgpt", sourceUrl: url };
    }
    console.log("[fetch] chatgpt SSR \u6D41\u89E3\u7801\u672A\u547D\u4E2D \u2192 \u56DE\u9000\u89C4\u5219/\u55C5\u63A2");
  }
  let messages = null;
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
    return { ok: true, messages, title: pageTitle, source: rule ? `rule:${rule.platform}` : "sniff", sourceUrl: url };
  }
  return { ok: false, error: "\u672A\u63D0\u53D6\u5230\u6D88\u606F\uFF08\u65E0\u89C4\u5219\u547D\u4E2D + \u901A\u7528\u55C5\u63A2\u672A\u8BC6\u522B\u2014\u2014\u53EF\u7528 console-script \u6D4F\u89C8\u5668\u515C\u5E95\uFF0C\u6216\u6C89\u6DC0\u89C4\u5219\uFF09" };
}
export {
  decodeStreamTable,
  extractGeminiByRule,
  extractGrokByRule,
  findSocksProxy,
  messagesFromChatgptStream,
  resolveGeminiCanonical
};
