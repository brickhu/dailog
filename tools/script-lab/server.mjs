#!/usr/bin/env node
// script-lab web 层：投稿列表 + 分步采编发布控制台
//   采集（原始对话内容）已自包含：lib/collect.mjs（不依赖 CLI）；TTS 合成/环境配置等仍复用 CLI 底座（迁移中）
// 用法：node tools/script-lab/server.mjs [--port 4173] [--env dev]
// 安全：绑定 127.0.0.1 + Host 头校验（防 DNS rebinding）
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLlmConfig, parseEnvFile } from "./lib/config.mjs";
import { complete, buildChatBody } from "./lib/llm.mjs";
import { getPrompt, renderPrompt, promptConfig } from "./lib/prompt.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(here, "web");

const args = process.argv.slice(2);
function flagValue(name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}
const port = Number(flagValue("--port") || process.env.PORT || "4173");
let env = flagValue("--env") || process.env.DAILOG_ENV || null;   // 启动时可为空——登录页选择环境
const activeEnv = () => env || process.env.DAILOG_ENV || null;

// .env → process.env（只补没设置的键）：采集等底层模块（lib/collect.mjs）直接读 process.env
// （SOCKS 代理、MICROLINK_API_KEY / DAILOG_MICROLINK 等），让 tools/script-lab/.env 对它们同样生效
// 优先级：真实环境变量 > tools/script-lab/.env；容器里直接注入环境变量即可（无需 .env）
for (const [k, v] of Object.entries(parseEnvFile(join(here, ".env")))) {
  if (process.env[k] === undefined) process.env[k] = v;
}


// ===== 音频合成：BGM 混音滤镜（与 web/js/merge.js 的 bgmMixFilter 保持同一套语义）=====
// 干声 dry.wav(44100 mono) + BGM(stream_loop 无限循环) → amix(duration=first)；
// 音乐淡入/淡出只作用于 BGM 链，人声不动；输出 44100 mono，与无 BGM 时声道一致
function serverBgmFilter(cfg, durSec) {
  const T = Math.max(0.1, Number(durSec) || 0);
  const vol = Math.min(0.4, Math.max(0.02, Number(cfg && cfg.vol) || 0.15));
  let fadeIn = Math.min(15, Math.max(0, Number(cfg && cfg.fadeIn) || 0));
  let fadeOut = Math.min(15, Math.max(0, Number(cfg && cfg.fadeOut) || 0));
  if (fadeIn >= T) fadeIn = 0;
  if (fadeOut >= T) fadeOut = 0;
  const num = (n) => String(Math.round(Number(n) * 1000) / 1000);
  let bg = "[1:a]aformat=sample_rates=44100:channel_layouts=mono,volume=" + num(vol);
  if (fadeIn > 0) bg += ",afade=t=in:st=0:d=" + num(fadeIn);
  if (fadeOut > 0) bg += ",afade=t=out:st=" + num(T - fadeOut) + ":d=" + num(fadeOut);
  bg += "[bg]";
  // normalize=0：amix 默认会按输入数归一化（人声减半），必须关掉让人声 1:1 保留
  return "[0:a]aformat=sample_rates=44100:channel_layouts=mono[a0];" + bg + ";[a0][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]";
}

// 标准化 usage：token 消耗 + 缓存命中（供控制台历史展示）
function fmtUsage(u) {
  if (!u) return null;
  const hit = u.prompt_cache_hit_tokens ?? 0, miss = u.prompt_cache_miss_tokens ?? 0;
  return {
    input: u.prompt_tokens ?? 0,
    output: u.completion_tokens ?? 0,
    cacheHit: hit,
    cacheMiss: miss,
    cacheRate: (hit + miss) > 0 ? Math.round((hit / (hit + miss)) * 100) : null,
  };
}
// 控制台"追加提示词"通用注入：把 revision 追加到最后一条消息（round2 有专属逻辑除外）
function withRevision(msgs, rev) {
  if (!rev || !Array.isArray(msgs) || !msgs.length) return msgs;
  const last = msgs[msgs.length - 1] || { role: "user", content: "" };
  return msgs.slice(0, -1).concat([{
    role: last.role || "user",
    content: last.content + "\n\n---- 用户本次追加提示词 ----\n" + rev + "\n请按此意见逐条执行；与既有规则冲突时以追加提示词为准。",
  }]);
}
// 审题重试轨迹（内存累积，入库时与终分合并成一条自进化记录）：key = env:id
const retryAttempts = new Map();   // env:id -> 非预览 round2 调用次数
const retryDefects = new Map();    // env:id -> 每次带修改意见重试的缺陷文本[]

function loadCliLib() {
  return import("./lib/clilib.mjs");
}

/** 列出可用环境（envs.json） */
async function listEnvs() {
  const lib = await loadCliLib();
  return lib.listEnvironments().map((e) => ({ name: e.name, label: e.label || null, apiBase: e.apiBase }));
}

/** 按环境名建 config；不存在则抛错 */
async function configFor(name) {
  const lib = await loadCliLib();
  if (!name) throw new Error("未指定环境");
  const envs = lib.listEnvironments();
  if (!envs.some((e) => e.name === name)) {
    throw new Error("环境不存在: " + name + "（可用: " + envs.map((e) => e.name).join(" / ") + "）");
  }
  return lib.loadConfig(["--env", name]);
}

/** LLM 审题实时状态（诊断用：前端 footer 轮询显示注入/生成/解码各阶段） */
const reviewState = new Map();   // env:id → { phase, detail, at }

/** 超时包装：防沙箱/网络异常导致请求挂死 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label + " 超时（" + ms + "ms）")), ms)),
  ]);
}

// ===== R2 权威 + 进程内存缓存（制作产物 / 对话不依赖本地文件）=====
const productionCache = new Map();
const dialogueCache = new Map();

/** 经服务端统一 R2 存储（多端经 API 入库，避免不同步） */
async function r2Get(envName, token, key) {
  try {
    const d = await withTimeout(apiWithToken(envName, token, "/v1/editor/storage/get", { method: "POST", body: { key } }), 30000, "R2 读取");
    return d && typeof d.content === "string" ? d.content : null;
  } catch { return null; }
}
async function r2Put(envName, token, key, content) {
  await withTimeout(apiWithToken(envName, token, "/v1/editor/storage/put", { method: "POST", body: { key, content } }), 30000, "R2 写入");
}

/** 读对话：内存缓存 → 服务端/R2（按 URL 哈希）——不读本地草稿目录（彻底解耦） */
const DIALOGUE_CACHE_TTL = 5 * 60 * 1000;   // 对话缓存 TTL：R2 外部更新后内存缓存自动失效
async function loadDialogue(envName, token, id) {
  const key = envName + ":" + id;
  const hit = dialogueCache.get(key);
  if (hit && (Date.now() - hit.at < DIALOGUE_CACHE_TTL)) return hit.data;
  try {
    const detail = await apiWithToken(envName, token, "/v1/editor/submissions/" + id).catch(() => null);
    if (!detail || !detail.url) return null;
    const { dialogueR2Key } = await import("./lib/r2key.mjs");   // 纯哈希函数，无网络
    const content = await r2Get(envName, token, dialogueR2Key(detail.url));
    if (!content) return null;
    const d = JSON.parse(content);
    dialogueCache.set(key, { at: Date.now(), data: d });
    return d;
  } catch (err) {
    // 404（R2 上不存在）→ 缓存 null 避免重复拉取；其他错误不缓存以便重试
    const msg = String((err && err.message) || err);
    if (msg.includes("404") || msg.includes("NoSuchKey")) dialogueCache.set(key, { at: Date.now(), data: null });
    return null;
  }
}

const productionKey = (envName, id) => "workflows/" + envName + "/" + id + ".json";
/** 读制作产物：内存缓存 → R2 workflows/{env}/{id}.json（经 /v1/editor/storage/get）
 *  注：以前打的是 /v1/editor/submissions/:id/workflow——后端从来没这个路由（404），
 *  于是所有"服务端状态"实际只活在 lab 内存里，重启即失；现改走 storage 接口真正落 R2。 */
async function loadProduction(envName, token, id) {
  const key = envName + ":" + id;
  if (productionCache.has(key)) return productionCache.get(key);
  const content = await r2Get(envName, token, productionKey(envName, id));
  let p = null;
  if (content) { try { p = JSON.parse(content); } catch { p = null; } }
  productionCache.set(key, p);
  return p;
}
/** 保存制作产物：读 → 浅合并 → 写 R2；写失败会抛（调用方决定是否致命） */
async function saveProduction(envName, token, id, patch) {
  const key = envName + ":" + id;
  const cur = { ...((await loadProduction(envName, token, id)) || { id, env: envName }), ...patch, updatedAt: Date.now() };
  await r2Put(envName, token, productionKey(envName, id), JSON.stringify(cur));
  productionCache.set(key, cur);
  console.log("[production] 落 R2 " + productionKey(envName, id) + " keys=" + Object.keys(patch).join(","));
  return cur;
}


/** 密码登录的 cookie 会话（按 env 存文件——重启不丢；webui 登录后后续 API 调用带此 cookie） */
const COOKIE_FILE = join(process.env.LAB_STATE_DIR || here, ".lab-cookies.json");
const cookieSessions = new Map();  // env → cookie 字符串
export function getCookieSession(envName) { return cookieSessions.get(envName) || null; }
function loadCookies() {
  try {
    if (existsSync(COOKIE_FILE)) {
      const data = JSON.parse(readFileSync(COOKIE_FILE, "utf-8"));
      for (const [k, v] of Object.entries(data)) if (v) cookieSessions.set(k, v);
    }
  } catch { /* 损坏忽略 */ }
}
function saveCookies() {
  try { writeFileSync(COOKIE_FILE, JSON.stringify(Object.fromEntries(cookieSessions), null, 2)); } catch { /* 忽略 */ }
}
loadCookies();

/** 采集任务跟踪（按环境隔离——避免跨环境投稿串数据） */
const fetchingSet = new Set();       // env:submissionId
const fetchingInfo = new Map();      // env:submissionId → { url }
const fetchResults = new Map();      // env:submissionId → { ok, detail, at }
const FETCH_RESULT_TTL = 5 * 60_000; // 结果保留 5 分钟

/** 读 R2 对话缓存（经服务端 API；lab 管内存缓存） */
async function readDialogueR2(envName, token, url) {
  try {
    const { dialogueR2Key } = await import("./lib/r2key.mjs");   // 纯哈希函数
    const content = await r2Get(envName, token, dialogueR2Key(url));
    return content ? JSON.parse(content) : null;
  } catch { return null; }
}

/** 服务端标记（lab 接管：collected=1 + dialogueCount + title 回写） */
async function markCollected(envName, token, id, messages, title) {
  const stats = {
    messages: messages.length,
    userTurns: messages.filter((m) => m.role === "user").length,
    assistantTurns: messages.filter((m) => m.role === "assistant").length,
    chars: messages.reduce((n, m) => n + (m.content || "").length, 0),
  };
  await apiWithToken(envName, token, "/v1/editor/submissions/" + id + "/collected", { method: "PATCH", body: { collected: 1, dialogueCount: stats } });
  if (title) {
    try { await apiWithToken(envName, token, "/v1/editor/submissions/" + id + "/title", { method: "PATCH", body: { title } }); } catch { /* title 回写失败不影响 */ }
  }
}

/** 异步执行单条采集：CLI 纯功能提取 → lab 接管 R2 存储 + 服务端标记 */
/** 注入采集规则：R2 rules/collect.json 优先；缺失则读 assets 种子并异步补种 R2 */
async function ensureCollectRules(envName, token) {
  try {
    const docStr = await r2Get(envName, token, "rules/collect.json");
    if (docStr) {
      const doc = JSON.parse(docStr);
      const m = await import("./lib/collect.mjs");
      m.setCollectRules(doc, (d) => { r2Put(envName, token, "rules/collect.json", JSON.stringify(d)).catch(() => {}); });
      return;
    }
  } catch {}
  try {
    const seed = JSON.parse(readFileSync(join(here, "assets", "rules.json"), "utf8"));
    const m = await import("./lib/collect.mjs");
    m.setCollectRules(seed, null);
    r2Put(envName, token, "rules/collect.json", JSON.stringify(seed)).catch(() => {});
  } catch {}
}
async function runSingleFetch(envName, token, id, url, title) {
  const fkey = envName + ":" + id;
  fetchingSet.add(fkey);
  fetchResults.delete(fkey);   // 清掉该 id 的历史结果（上次失败会残留误导前端）
  if (url) fetchingInfo.set(fkey, { url });
  try {
    // ① R2 缓存判断（lab 管缓存）：同一 URL 已采集 → 直接用，跳过抓取
    if (url) {
      const cached = await readDialogueR2(envName, token, url);
      if (cached && Array.isArray(cached.messages) && cached.messages.length > 0) {
        await markCollected(envName, token, id, cached.messages, cached.title || null);
        dialogueCache.set(fkey, { at: Date.now(), data: cached });
        fetchResults.set(fkey, { ok: true, detail: cached.messages.length + " 条消息（R2 缓存）", at: Date.now() });
        return { ok: true, messages: cached.messages };
      }
    }
    // ② 注入采集规则（R2 rules/collect.json 优先，种子兜底）
    await ensureCollectRules(envName, token);
// ② 采集：claude 分享页走宿主有头 Chrome 直采（socks + Turnstile 放行）；其余走 collect.mjs（lab 自包含，同 CLI 解码）
    let r;
    try {
      const claudeHost = (() => { try { const u = new URL(url || ""); return u.hostname === "claude.ai" && u.pathname.startsWith("/share/"); } catch { return false; } })();
      if (claudeHost) {
        const { collectClaudeShare } = await import("./lib/claude-collect.mjs");
        r = await collectClaudeShare(url, { title: title ?? null });
        if (!r.ok) console.log("[runSingleFetch] claude 直采未成功（" + (r.error || "") + "）→ 回退通用路径");
      }
    } catch (e) { console.log("[runSingleFetch] claude 直采异常: " + ((e && e.message) || e)); }
    if (!r) {
      const collect = await import("./lib/collect.mjs");
      r = await collect.collectDialogue(url, { title: title ?? null });
    }
    // ③ lab 接管存储：R2 写入 + 服务端标记
    if (r.ok && Array.isArray(r.messages) && r.messages.length > 0) {
      const sourceUrl = r.sourceUrl || url;
      const data = { sourceUrl, source: r.source || "", title: r.title || null, messages: r.messages };
      // R2 备份（多端同步）——不写本地（彻底解耦）
      try {
        const { dialogueR2Key } = await import("./lib/r2key.mjs");   // 纯哈希函数
        await r2Put(envName, token, dialogueR2Key(sourceUrl), JSON.stringify(data));
        dialogueCache.set(fkey, { at: Date.now(), data });
      } catch { /* R2 上传失败不阻塞标记 */ }
      await markCollected(envName, token, id, r.messages, r.title || null);
    } else {
      dialogueCache.delete(fkey);   // 采集失败：清缓存，避免残留旧对话
      try { await apiWithToken(envName, token, "/v1/editor/submissions/" + id + "/collected", { method: "PATCH", body: { collected: -1 } }); } catch { /* 标记失败不影响 */ }
    }
    fetchResults.set(fkey, { ok: r.ok, detail: r.error ? String(r.error).slice(0, 150) : (r.messages ? r.messages.length + " 条消息" : ""), at: Date.now() });
    return r;
  } catch (e) {
    console.error("[runSingleFetch] 采集异常:", (e && e.stack) || e);
    fetchResults.set(fkey, { ok: false, detail: String((e && e.message) || e).slice(0, 150), at: Date.now() });
    return { ok: false, error: (e && e.message) || String(e) };
  } finally {
    fetchingSet.delete(fkey);
    fetchingInfo.delete(fkey);
  }
}

/** 调 API：cookie 会话优先（密码登录），其次 Bearer token（配对码登录）；401 抛错 */
async function apiWithToken(envName, token, path, opts = {}) {
  const cfg = await configFor(envName);
  const lib = await loadCliLib();
  const headers = { "x-lab-env": envName };
  const cookie = getCookieSession(envName);
  if (cookie) {
    headers["cookie"] = cookie;
  } else if (token) {
    headers["Authorization"] = "Bearer " + token;
  } else {
    throw new Error("未登录——请登录");
  }
  let body;
  if (opts.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(opts.body); }
  const res = await lib.apiFetch(cfg.apiBase + path, { method: opts.method || "GET", headers, body });
  if (res.status === 401) throw new Error("登录已失效——请重新登录");
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error((opts.method || "GET") + " " + path + " → " + res.status + ": " + txt.slice(0, 200));
  }
  return res.json().catch(() => null);
}

/** 从请求头取 { env, token, hasCookie }（密码登录走 cookie 会话，配对码走 Bearer token） */
async function apiFetchBytes(cfg, envName, token, fwd) {
  const headers = { "x-lab-env": envName };
  const cookie = getCookieSession(envName);
  if (cookie) headers.cookie = cookie; else if (token) headers.authorization = "Bearer " + token;
  const r = await fetch(cfg.apiBase + fwd, { headers });
  if (!r.ok) throw new Error("字节拉取失败 " + fwd + " → " + r.status);
  return Buffer.from(await r.arrayBuffer());
}
function reqCred(req) {
  const env = req.headers["x-lab-env"] || null;
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const hasCookie = env ? !!getCookieSession(env) : false;
  return { env, token, hasCookie };
}

/** 判断请求是否已登录（env 存在且 cookie 会话或 token 任一有效） */
function isAuthed(cred) {
  return !!cred.env && (cred.hasCookie || !!cred.token);
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

function sendJson(res, obj, status = 200) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};

function serveStatic(path, res) {
  const safe = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  const file = join(WEB_DIR, safe);
  if (!file.startsWith(WEB_DIR) || !existsSync(file) || !statSync(file).isFile()) {
    // SPA fallback：/settings、/<id> 等前端路由路径一律返回 index.html（前端按 pathname 渲染）
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(readFileSync(join(WEB_DIR, "index.html")));
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(file)] || "application/octet-stream",
    // lab 静态文件禁止浏览器缓存：改 JS/HTML 即时生效（避免旧版脚本导致行为异常）
    "cache-control": "no-cache",
    // 跨域隔离：ffmpeg.wasm 多线程 core 需要 SharedArrayBuffer
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
  });
  res.end(readFileSync(file));
}

async function handleApi(path, res, req) {
  // GET /api/envs → 可用环境列表
  if (path === "/api/envs") {
    const envs = await listEnvs();
    sendJson(res, { ok: true, envs });
    return;
  }

  // GET /api/auth/status?env=<名> → 环境信息（登录判断由前端 localStorage token + /api/me 完成）
  if (path.startsWith("/api/auth/status")) {
    const qs = new URL(path, "http://x").searchParams;
    const name = qs.get("env") || null;
    sendJson(res, { ok: true, env: name, loggedIn: false, userEmail: "" });
    return;
  }

  // POST /api/auth/password → 用户名密码登录（转发 /v1/auth/sign-in/email，取 set-cookie 会话）
  if (path === "/api/auth/password" && req.method === "POST") {
    const body = await readBody(req);
    const name = (body && body.env) || null;
    const email = (body && body.email || "").trim();
    const password = (body && body.password) || "";
    if (!name || !email || !password) { sendJson(res, { ok: false, error: "需提供环境/邮箱/密码" }, 400); return; }
    const cfg = await configFor(name);
    const lib = await loadCliLib();
    const origin = cfg.siteUrl || cfg.apiBase;
    try {
      const signIn = await lib.apiFetch(cfg.apiBase + "/v1/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ email, password }),
        redirect: "manual",
      });
      if (signIn.status === 401 || signIn.status === 403) {
        sendJson(res, { ok: false, error: "邮箱或密码错误" }, 401);
        return;
      }
      if (!signIn.ok) {
        const txt = await signIn.text().catch(() => "");
        sendJson(res, { ok: false, error: "登录失败（HTTP " + signIn.status + "）: " + txt.slice(0, 120) }, 400);
        return;
      }
      const setCookie = signIn.headers.get("set-cookie") || "";
      if (!setCookie) { sendJson(res, { ok: false, error: "登录响应无会话 cookie" }, 400); return; }
      const cookie = setCookie.split(";")[0];
      cookieSessions.set(name, cookie);
      saveCookies();
      sendJson(res, { ok: true, env: name });
      return;
    } catch (e) {
      console.error("[auth/password] 登录异常:", e);
      sendJson(res, { ok: false, error: "登录请求失败: " + String((e && e.message) || e) }, 500);
      return;
    }
  }

  // GET /api/me → 当前请求头 token 对应的用户（localStorage token 有效性验证）
  if (path === "/api/me") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    try {
      const me = await apiWithToken(e, token, "/v1/me/profile");
      sendJson(res, { ok: true, email: (me && (me.email || me.username)) || "", username: (me && me.username) || "" });
    } catch (err) {
      // profile 404（无档案）→ 用 editor 接口验证登录态，邮箱从投稿列表回退
      const subs = await apiWithToken(e, token, "/v1/editor/submissions").catch(() => null);
      if (subs && Array.isArray(subs)) {
        sendJson(res, { ok: true, email: (subs[0] && subs[0].userEmail) || "", username: "" });
      } else {
        sendJson(res, { ok: false, error: String((err && err.message) || err) }, 401);
      }
    }
    return;
  }


  // GET /api/submissions → 全量投稿记录（服务端拉取 + 本地草稿状态推断，按 createdAt 倒序）
  if (path.startsWith("/api/submissions")) {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const qs2 = new URL(path, "http://x").searchParams;
    const page = Math.max(1, Number(qs2.get("page") || 1));
    const pageSize = Math.min(100, Math.max(1, Number(qs2.get("pageSize") || 50)));
    const lib = await loadCliLib();
    const [pub, rej, crafted, col, sel] = await Promise.all([
      apiWithToken(e, token, "/v1/editor/submissions?status=published").catch(() => []),
      apiWithToken(e, token, "/v1/editor/submissions?status=rejected").catch(() => []),
      apiWithToken(e, token, "/v1/editor/submissions?status=crafted").catch(() => []),
      apiWithToken(e, token, "/v1/editor/submissions?status=collected").catch(() => []),
      apiWithToken(e, token, "/v1/editor/submissions?status=selected").catch(() => []),
    ]);
    const sub = await apiWithToken(e, token, "/v1/editor/submissions").catch(() => []);
    const all = [...sub, ...col, ...pub, ...rej, ...crafted, ...sel];
    // 同源复用标记：同一 URL 的另一条投稿已采集 → 本条采集时可跳过抓取（R2 对话按 URL 哈希共享）
    const collectedUrls = new Set(all.filter((r) => r.collected === 1 && r.url).map((r) => r.url));
    const rows = all.map((r) => {
      // 列表状态与详情页对齐：直接展示状态值（submitted/collected/crafted/published/rejected）
      const stage = r.status || "submitted";
      return {
        id: r.id, url: r.url, title: r.title, collected: r.collected, dialogueCount: r.dialogueCount,
        displayName: r.displayName || r.userEmail || "?", userEmail: r.userEmail,
        createdAt: r.createdAt, hasVoiceSample: r.hasVoiceSample, stage,
        language: r.language || "zh",   // 投稿区（目标语言）：列表徽标用
        reusable: r.collected !== 1 && !!r.url && collectedUrls.has(r.url),   // 同源已采集 → 一键复用
      };
    });
    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const total = rows.length;
    const pendingCount = rows.filter((r) => r.stage === "submitted").length;   // rows 对象用 stage 承载状态值
    const paged = rows.slice((page - 1) * pageSize, page * pageSize);
    sendJson(res, { ok: true, env: e, rows: paged, total, pendingCount, page, pageSize });
    return;
  }

  // GET/POST /api/run/config/prompts/:file —— 提示词 R2 读写（与 rules 同模式；POST 同时写本地供运行时热更）
  if (path.startsWith("/api/run/config/prompts/")) {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录" }, 401); return; }
    const file = decodeURIComponent(path.slice("/api/run/config/prompts/".length).split("?")[0]);
    if (file.includes("..")) { sendJson(res, { ok: false, error: "非法文件名" }, 400); return; }
    const localPath = join(here, "prompts", file);
    if (req.method === "GET") {
      try {
        const content = await r2Get(cred.env, cred.token, "prompts/" + file);
        if (content !== null && content !== undefined) { sendJson(res, { ok: true, content, key: "prompts/" + file }); return; }
      } catch {}
      try { const c = readFileSync(localPath, "utf8"); sendJson(res, { ok: true, content: c, local: true }); } catch { sendJson(res, { ok: false, error: "文件不存在: " + file }, 404); }
      return;
    }
    const body = await readBody(req);
    const content = typeof body.content === "string" ? body.content : null;
    if (content === null) { sendJson(res, { ok: false, error: "需 content" }, 400); return; }
    try {
      await r2Put(cred.env, cred.token, "prompts/" + file, content);
      try { writeFileSync(localPath, content); } catch { /* 容器内写本地仅当前实例热更 */ }
      const { sigOf } = await import("./lib/config-store.mjs");
      sendJson(res, { ok: true, sig: sigOf(content) });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }
  // GET/POST /api/run/rules → 采集规则读写（R2 rules/collect.json；种子兜底）
  if (path === "/api/run/rules" && req.method === "GET") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录" }, 401); return; }
    try {
      const docStr = await r2Get(cred.env, cred.token, "rules/collect.json");
      if (docStr) { sendJson(res, { ok: true, doc: JSON.parse(docStr) }); return; }
      const seed = JSON.parse(readFileSync(join(here, "assets", "rules.json"), "utf8"));
      sendJson(res, { ok: true, doc: seed, seeded: true });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }
  if (path === "/api/run/rules" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录" }, 401); return; }
    const body = await readBody(req);
    const doc = (body && body.doc && Array.isArray(body.doc.rules)) ? body.doc : null;
    if (!doc) { sendJson(res, { ok: false, error: "需 doc.rules" }, 400); return; }
    try {
      await r2Put(cred.env, cred.token, "rules/collect.json", JSON.stringify(doc));
      const m = await import("./lib/collect.mjs");
      m.setCollectRules(doc, (d) => { r2Put(cred.env, cred.token, "rules/collect.json", JSON.stringify(d)).catch(() => {}); });
      sendJson(res, { ok: true });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/fetch → 单条采集（异步：立即返回，采集中状态由 /api/status/fetch 查询）
  if (path === "/api/run/fetch" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    if (fetchingSet.has(e + ":" + id)) { sendJson(res, { ok: true, state: "fetching", id }); return; }
    // 异步启动，不等待（带 url 供统计条展示"正在采集：<url>"）
    const sub = await apiWithToken(e, token, "/v1/editor/submissions/" + id).catch(() => null);
    if (sub && sub.collected === 1) { sendJson(res, { ok: true, state: "already_fetched", id }); return; }
    runSingleFetch(e, token, id, (sub && sub.url) || null, (sub && sub.title) || null).catch(() => {});
    sendJson(res, { ok: true, state: "fetching", id });
    return;
  }

  // GET /api/status/fetch → 采集任务状态（正在采集的 ID + 最近完成结果）
  if (path === "/api/status/fetch") {
    const cred = reqCred(req);
    const envPfx = cred.env ? cred.env + ":" : "";
    const now = Date.now();
    for (const [k, r] of fetchResults) {
      if (now - r.at > FETCH_RESULT_TTL) fetchResults.delete(k);
    }
    const fetching = [...fetchingSet].filter((k) => k.startsWith(envPfx)).map((k) => ({ id: k.slice(envPfx.length), url: (fetchingInfo.get(k) || {}).url || null }));
    const results = {};
    for (const [k, v] of fetchResults) {
      if (k.startsWith(envPfx)) results[k.slice(envPfx.length)] = v;
    }
    sendJson(res, { ok: true, fetching, results });
    return;
  }

  // POST /api/run/batch → 批量采集 submitted 队列（异步：逐个进 fetching 队列，前端轮询进度）
  if (path === "/api/run/batch" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const lib = await loadCliLib();
    const q = await apiWithToken(e, token, "/v1/editor/submissions").catch(() => []);
    // 未采集的投稿（服务端 collected !== 1 且不在 fetching）→ 采集（并发 4）
    const pending = q.filter((row) => row.collected !== 1 && !fetchingSet.has(e + ":" + row.id));
    // **同 URL 分组**：对话原文的 R2 key 是 URL 哈希（dialogues/{sha256(url)}.json），同一篇对话只需抓一次。
    // 组内按序执行（第一条真抓 → 其余命中 R2 缓存直接复用），组间并发 4。
    // 不分组的话，同一 URL 的两条投稿会被不同 worker 同时抓 —— 白抓一次（claude 分享页还会起两个有头 Chrome）。
    const groups = new Map();
    for (const row of pending) {
      const key = row.url || row.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const queue = [...groups.values()];
    let gi = 0;
    const worker = async () => {
      while (gi < queue.length) {
        const group = queue[gi++];
        for (const row of group) {
          await runSingleFetch(e, token, row.id, row.url || null, row.title || null);
        }
      }
    };
    // 异步启动，不等待（返回已入队数量；进度由 /api/status/fetch 轮询）
    Promise.all(Array.from({ length: Math.min(4, Math.max(queue.length, 1)) }, worker)).catch(() => {});
    sendJson(res, { ok: true, queued: pending.length, conversations: queue.length, total: q.length });
    return;
  }

  /** 从 LLM 输出中提取 JSON（容忍 ```json 围栏、前后文字、字符串内真实换行） */
  function extractJson(text) {
    const raw = String(text);
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    let s = m ? m[1] : raw;
    const start = s.indexOf("{");
    if (start < 0) {
      console.error("[extractJson] 未找到 JSON 对象，输出长度", raw.length, "开头:", raw.slice(0, 200));
      throw new Error("LLM 输出不是合法 JSON（未找到 JSON 对象）");
    }
    // 括号深度匹配找到与首个 { 配对的 }（容忍嵌套），不用 lastIndexOf（防尾随文字/截断误判）
    let depth = 0, inStr = false, esc = false;
    let end = -1;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === "\"") inStr = false;
        continue;
      }
      if (ch === "\"") { inStr = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    let candidate = end > start ? s.slice(start, end + 1) : s.slice(start);
    // 清洗字符串值内的真实换行（LLM 偶发在 JSON 字符串里输出裸换行 → 非法）——转成 \n
    candidate = candidate.replace(/("(?:[^"\\]|\\.)*")/g, (m2) => m2.replace(/\n/g, "\\n"));
    try { return JSON.parse(candidate); } catch (err) {
      console.error("[extractJson] 解析失败，输出长度", raw.length, "开头:", raw.slice(0, 150));
      throw new Error("LLM 输出不是合法 JSON（截断或格式错误）");
    }
  }
  function llmConfig() {
    const cfg = resolveLlmConfig(process.argv);
    return cfg && cfg.apiKey ? cfg : null;
  }
  /** 预览直调 LLM 的出站请求体（与 llmComplete 同一 config 合并链路）——供控制台"预览请求体"展示真实 body */
  function previewApiBody(pKey, msgs) {
    try {
      const cfg = llmConfig();
      if (!cfg) return null;
      const p = getPrompt(pKey);
      Object.assign(cfg, p.config || {});
      if (!cfg.maxTokens) cfg.maxTokens = 8192;
      if (!cfg.thinking) cfg.thinking = { type: "disabled" };
      if (typeof cfg.thinking === "string") cfg.thinking = { type: cfg.thinking };
      return buildChatBody(cfg, msgs.map(m => ({ role: m.role, content: m.content })), { stream: false });
    } catch { return null; }
  }
  async function llmComplete(system, user, cfgOverride = {}, messages = null, promptCfg = {}, extSignal = null) {
    const cfg = llmConfig();
    if (!cfg) throw new Error("未配置 LLM API key（DEEPSEEK_API_KEY）");
    Object.assign(cfg, promptCfg);   // 字典 config（prompts.json）：per-prompt API 参数，覆盖 env 默认（除 messages 外全部透传）——注意：promptCfg 是末尾第 5 参
    if (!cfg.maxTokens) cfg.maxTokens = 8192;   // 大输出（审题含脚本）设足够上限，防截断导致 JSON 不完整
    if (!cfg.thinking) cfg.thinking = { type: "disabled" };   // v4 默认思考模式 high effort——结构化 JSON 任务关闭，防推理耗尽致空 content
    Object.assign(cfg, cfgOverride);            // 前端状态0 可覆盖 temperature/seed
    // 归一化 thinking：字符串简写（"disabled"/"enabled"）→ {type} 对象（deepseek API 期望）
    if (typeof cfg.thinking === "string") cfg.thinking = { type: cfg.thinking };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 120000);   // 生成超时 120s，防挂起
    // 外部中止（编辑在对话框点「停止」→ 前端断连 → 路由把 res.close 接到这里）：一并中止上游调用，别白烧 token
    const onExtAbort = () => { try { ac.abort(); } catch (e) {} };
    if (extSignal) { if (extSignal.aborted) onExtAbort(); else extSignal.addEventListener("abort", onExtAbort, { once: true }); }
    let usage = null;
    try {
      // messages 传入则直接使用（多轮对话：第2轮带上第1轮完整历史 + assistant 回传 → system+user 前缀命中缓存）
      let msgs = messages || [
        { role: "system", content: system },
        { role: "user", content: typeof user === "string" ? user : JSON.stringify(user, null, 1) },
      ];
      // DeepSeek 硬性要求：response_format=json_object 时提示词里必须出现 "json"，否则整轮 400。
      // 提示词是热改 md 文件，改稿时很容易把这个词连同句子一起删掉——这里兜一道，顺带在日志里点名。
      const _rf = cfg.responseFormat || cfg.response_format;   // 配置里是 camelCase（转 snake_case 发生在 lib/llm.mjs 出站时）
      if (_rf && _rf.type === "json_object"
          && !/json/i.test(msgs.map((m) => String((m && m.content) || "")).join("\n"))) {
        const _last = msgs[msgs.length - 1] || { role: "user", content: "" };
        msgs = msgs.slice(0, -1).concat([{ role: _last.role || "user", content: String(_last.content || "") + "\n\n（只输出 JSON。）" }]);
        console.warn("[llm] 提示词里找不到 'json' 字样——已自动补一句过 json_object 校验；请检查该 prompt 的 md 是否误删了 JSON 说明");
      }
      const _fp = msgs.slice(0, 2).map(m => (m.role || "?") + "(" + String(m.content).length + "):" + String(m.content).slice(0, 30).replace(/\n/g, "\\n")).join(" || ");
      console.log("[llm-prefix] " + _fp);   // 诊断：R1/R2 前缀是否逐字一致（缓存命中的前提）
      const out = await complete(cfg, msgs, { stream: false, signal: ac.signal, onUsage: (u) => { usage = u; } });
      if (usage) {
        const hit = usage.prompt_cache_hit_tokens ?? 0, miss = usage.prompt_cache_miss_tokens ?? 0, tot = usage.prompt_tokens ?? 0;
        console.log("[llm-usage] prompt=" + tot + " (cache_hit=" + hit + " cache_miss=" + miss + " 命中率=" + (tot ? Math.round(hit / tot * 100) : 0) + "%) output=" + (usage.completion_tokens ?? 0) + " model=" + cfg.model);
      }
      return { content: out, usage };
    } finally { clearTimeout(timer); if (extSignal) { try { extSignal.removeEventListener("abort", onExtAbort); } catch (e) {} } }
  }

  // GET /api/status/review?id= → LLM 审题实时状态（诊断：前端 footer 轮询）
  if (path.startsWith("/api/status/review")) {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const qs = new URL(path, "http://x").searchParams.get("id") || "";
    const st = reviewState.get(cred.env + ":" + qs) || null;
    sendJson(res, { ok: true, state: st });
    return;
  }

  // POST /api/run/script/save → 保存手工修改的脚本（body {id, scripts} → 服务端写 R2 + 清缓存）
  if (path === "/api/run/script/save" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const body = await readBody(req);
    const id = (body && body.id) || null;
    const scripts = (body && Array.isArray(body.scripts)) ? body.scripts : null;
    if (!id || !scripts) { sendJson(res, { ok: false, error: "需 id + scripts" }, 400); return; }
    try {
      const d = await apiWithToken(cred.env, cred.token, "/v1/editor/submissions/" + id + "/scripts", { method: "PUT", body: { scripts } });
      productionCache.delete(cred.env + ":" + id);   // 清 lab 缓存（detail 重新拉）
      sendJson(res, { ok: true, message: "脚本已保存（" + scripts.length + " 个）", count: d && d.scripts });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/full-upload → 上传合成好的 full audio（m4a）到 R2（body { id, audio: base64, mime } → key full/{id}.m4a）
  if (path === "/api/run/full-upload" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    // 大 body 专用读取（base64 音频可达几十 MB；readBody 的 1MB 限制不适用）
    const chunks = [];
    let size = 0;
    for await (const c2 of req) {
      chunks.push(c2); size += c2.length;
      if (size > 100 * 1024 * 1024) { sendJson(res, { ok: false, error: "音频过大（>100MB）" }, 413); return; }
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = {}; }
    const id = (body && body.id) || null;
    const audio = (body && body.audio) || null;
    if (!id || !audio) { sendJson(res, { ok: false, error: "需 id + audio(base64)" }, 400); return; }
    try {
      // 产物本质 = 最终输出：合成确认直接写最终位置 episodes/{userId}/{submissionId}.m4a（canonical，发布零拷贝；与文档/republish/流式同 key）
      // userId 经投稿详情获取；详情拉取失败时回退 flat episodes/{submissionId}.m4a（发布解析链同样覆盖）
      let key = "episodes/" + id + ".m4a";
      try {
        const d = await apiWithToken(e, token, "/v1/editor/submissions/" + id);
        if (d && d.userId) key = "episodes/" + d.userId + "/" + id + ".m4a";
      } catch (err) { console.log("[full-upload] 投稿详情获取失败（回退 flat key）:", String((err && err.message) || err).slice(0, 300)); }
      await apiWithToken(e, token, "/v1/editor/storage/put", { method: "POST", body: { key, content: "b64:" + audio } });
      // 上传成功 → 标记投稿为 crafted（节目音频已生成未发布；标记失败不阻断上传成功）
      let crafted = false;
      try {
        const cr = await apiWithToken(e, token, "/v1/editor/submissions/" + id + "/crafted", { method: "POST", body: {} });
        crafted = !!(cr && cr.ok);
        console.log("[full-upload] crafted 标记:", JSON.stringify(cr).slice(0, 300));
      } catch (err) { console.log("[full-upload] crafted 标记失败:", String((err && err.message) || err).slice(0, 400)); }
      sendJson(res, { ok: true, key, crafted });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/mark-crafted → 标记投稿为 crafted（确认上传后前端双保险；幂等）
  if (path === "/api/run/mark-crafted" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    try {
      const r = await apiWithToken(e, token, "/v1/editor/submissions/" + id + "/crafted", { method: "POST", body: {} });
      console.log("[mark-crafted] 响应:", JSON.stringify(r).slice(0, 300));
      sendJson(res, { ok: true, crafted: !!(r && r.ok) });
    } catch (err) { console.log("[mark-crafted] 失败:", String((err && err.message) || err).slice(0, 400)); sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/reject → 手工拒绝投稿（详情页未 published 前任意状态可拒；reason 必填）
  if (path === "/api/run/reject" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    const reason = (body && body.reason) ? String(body.reason).trim() : "";
    // 拒稿分类与语言：平台侧没有这两个字段（只存 reason），lab 侧留痕给统计用（"这类拒稿占多少"）
    const category = (body && body.category) ? String(body.category).trim() : "";
    const language = (body && body.language === "en") ? "en" : ((body && body.language === "zh") ? "zh" : "");
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    if (!reason) { sendJson(res, { ok: false, error: "请填写拒稿原因" }, 400); return; }
    // 平台限制：reason ≤ 500 字（超了返回 reason_too_long）——这里先挡，给出人话
    if (reason.length > 500) { sendJson(res, { ok: false, error: "拒稿原因最多 500 字（当前 " + reason.length + " 字）" }, 400); return; }
    try {
      const r = await apiWithToken(e, token, "/v1/editor/submissions/" + id + "/reject", { method: "POST", body: { reason } });
      if (category || language) {
        await saveProduction(e, token, id, { reject: { category, language, chars: reason.length, at: new Date().toISOString() } }).catch(() => null);
      }
      console.log("[reject] " + id + " 分类=" + (category || "（未选）") + " 语言=" + (language || "（未指定）") + " 字数=" + reason.length);
      sendJson(res, { ok: true, status: "rejected" });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/episode-meta-update → 编辑已发布节目的 meta（published 预览态编辑；不影响投稿状态与关联）
  if (path === "/api/run/episode-meta-update" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const episodeId = (body && body.episodeId) || null;
    const meta = (body && body.meta && typeof body.meta === "object") ? body.meta : null;
    if (!episodeId) { sendJson(res, { ok: false, error: "需 episodeId" }, 400); return; }
    if (!meta) { sendJson(res, { ok: false, error: "需 meta（节目字段对象）" }, 400); return; }
    try {
      await apiWithToken(e, token, "/v1/editor/episodes/" + encodeURIComponent(episodeId), { method: "PATCH", body: { meta: JSON.stringify(meta) } });
      sendJson(res, { ok: true });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // GET /api/run/episode-meta?episodeId= → 取已发布节目的当前 meta（发布卡编辑预填；服务端权威，刷新/跨端一致）
  if (path.startsWith("/api/run/episode-meta") && req.method === "GET") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const qs = new URL(path, "http://x").searchParams;
    const episodeId = qs.get("episodeId") || null;
    if (!episodeId) { sendJson(res, { ok: false, error: "需 episodeId" }, 400); return; }
    try {
      const ep = await apiWithToken(e, token, "/v1/editor/episodes/" + encodeURIComponent(episodeId)).catch(() => null);
      if (!ep) { sendJson(res, { ok: false, error: "not_found" }, 404); return; }
      const arrOrJson = (v) => { if (Array.isArray(v)) return v; if (typeof v === 'string' && v.trim()) { try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch {} } return null; };
      const tags = Array.isArray(ep.tags) ? ep.tags : (typeof ep.tags === 'string' && ep.tags ? String(ep.tags).split(',').map(s => s.trim()).filter(Boolean) : null);
      sendJson(res, {
        ok: true,
        meta: {
          episodeId: ep.id || episodeId, slug: ep.slug || null, number: ep.number || null,
          title: ep.title || null, description: ep.description || null, category: ep.category || null,
          tags: tags || null, summary: ep.summary || null,
          references: arrOrJson(ep.references), highlights: arrOrJson(ep.highlights),
          coverUrl: ep.coverUrl || null, durationSeconds: (ep.durationSeconds != null) ? ep.durationSeconds : null,
        },
      });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/episode-save?episodeId= → 已发布节目整包更新（发布卡编辑·全改）：multipart 原样透传 api /v1/editor/episodes/:id/update（meta 全量 + 可选 cover）
  if (path.split("?")[0] === "/api/run/episode-save" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const qs = new URL(path, "http://x").searchParams;
    const episodeId = qs.get("episodeId") || null;
    if (!episodeId) { sendJson(res, { ok: false, error: "需 episodeId（query）" }, 400); return; }
    const chunks = [];
    let psize = 0;
    for await (const c2 of req) { chunks.push(c2); psize += c2.length; if (psize > 30 * 1024 * 1024) { sendJson(res, { ok: false, error: "数据过大（>30MB）" }, 413); return; } }
    const rawBody = Buffer.concat(chunks);
    const contentType = req.headers["content-type"] || "";
    try {
      const cfg = await configFor(e);
      const lib = await loadCliLib();
      const headers = { "x-lab-env": e, "content-type": contentType };
      const cookie = getCookieSession(e);
      if (cookie) headers["cookie"] = cookie;
      else if (token) headers["authorization"] = "Bearer " + token;
      const up = await lib.apiFetch(cfg.apiBase + "/v1/editor/episodes/" + encodeURIComponent(episodeId) + "/update", { method: "POST", headers, body: rawBody });
      if (!up.ok) {
        const t = await up.text().catch(() => "");
        throw new Error(up.status + ": " + t.slice(0, 200));
      }
      sendJson(res, { ok: true });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/console-import → 浏览器兜底采集入库：{id, messages?} 或 {id, html(完整渲染 DOM)}
//   浏览器只负责把页面完整 DOM 复制过来；提取/清理在 lab 端做（cheerio，规则可迭代）
if (path === "/api/run/console-import" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const chunks = [];
    let psize = 0;
    for await (const c2 of req) { chunks.push(c2); psize += c2.length; if (psize > 25 * 1024 * 1024) { sendJson(res, { ok: false, error: "数据过大（>25MB）" }, 413); return; } }
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { sendJson(res, { ok: false, error: "请求体不是合法 JSON" }, 400); return; }
    const id = (body && body.id) || null;
    const html = (body && typeof body.html === 'string' && body.html.trim()) ? body.html : null;
    let msgs = (body && Array.isArray(body.messages)) ? body.messages : null;
    const title = (body && typeof body.title === 'string' && body.title.trim()) ? body.title.trim().slice(0, 200) : null;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    try {
      if (!msgs && html) {
        const { load } = await import("cheerio");
        const $ = load(html);
        const cleanText = (t) => {
          t = (t || '').replace(/\u00a0/g, ' ');
          t = t.split(String.fromCharCode(10)).map((x) => x.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
          t = t.replace(/\n{3,}/g, '\n\n');
          return t.trim();
        };
        const compact = (t) => {
          t = cleanText(t).replace(/\n+/g, ' ');
          while (t.indexOf('  ') >= 0) t = t.replace('  ', ' ');
          return t.trim();
        };
        const okBoth = (arr) => arr && arr.length >= 2 && arr.some((m) => m.role === 'user') && arr.some((m) => m.role === 'assistant');
        const best = [];
        const run = [];
        // S1 平台作者属性（chatgpt / 旧 claude 分享页）
        run.push(() => {
          const a = [];
          $('[data-message-author-role]').each(function () {
            const r = $(this).attr('data-message-author-role');
            const t = compact($(this).text());
            if ((r === 'user' || r === 'assistant') && t) a.push({ role: r, content: t });
          });
          return a;
        });
        // S2 新版 claude 分享页：user = [data-testid="user-message"]，assistant = [data-perf-reply-text]，按文档序交错
        run.push(() => {
          const a = [];
          $('[data-testid="user-message"], [data-perf-reply-text]').each(function () {
            const isUser = $(this).attr('data-testid') === 'user-message';
            let t;
            if (isUser) {
              t = cleanText($(this).text());
            } else {
              const $c = $(this).clone();
              $c.find('[data-not-prose], svg, button, .sr-only, script, style, [aria-hidden="true"], [data-cds="MessageActions"]').remove();
              $c.find('br').replaceWith('\n');
              $c.find('td, th').append(' | ');
              $c.find('tr').append('\n');
              $c.find('li').append('\n');
              $c.find('p, blockquote, pre, h1, h2, h3, h4, h5, h6').append('\n');
              t = cleanText($c.text());
            }
            if (t) a.push({ role: isUser ? 'user' : 'assistant', content: t });
          });
          return a;
        });
        // S3 通用 testid 对（user-message / assistant-message）
        run.push(() => {
          const a = [];
          $('[data-testid]').each(function () {
            const tid = $(this).attr('data-testid');
            const role = tid === 'user-message' ? 'user' : tid === 'assistant-message' ? 'assistant' : null;
            if (!role) return;
            const t = compact($(this).text());
            if (t) a.push({ role, content: t });
          });
          return a;
        });
        for (const fn of run) {
          const arr = fn();
          if (okBoth(arr)) best.push(arr);
        }
        best.sort((x, y) => y.length - x.length);
        msgs = best.length ? best[0] : null;
      }
      if (!msgs || !msgs.length) { sendJson(res, { ok: false, error: "没能从页面里提取出对话（也可以直接粘贴 messages JSON）" }); return; }
      // 入库：R2 写入 + 服务端标记（与采集路径同一套）
      try {
        const detail = await apiWithToken(e, token, "/v1/editor/submissions/" + id).catch(() => null);
        const sourceUrl = (detail && detail.url) || "";
        const data = { sourceUrl, source: "console", title: title || null, messages: msgs };
        if (sourceUrl) {
          const { dialogueR2Key } = await import("./lib/r2key.mjs");
          await r2Put(e, token, dialogueR2Key(sourceUrl), JSON.stringify(data));
        }
        dialogueCache.set(e + ":" + id, { at: Date.now(), data });
        await markCollected(e, token, id, msgs, title || null);
      } catch (err) { console.log("[console-import] 入库异常:", String((err && err.message) || err)); }
      sendJson(res, { ok: true, count: msgs.length, messages: msgs.length, detail: msgs.length + " 条消息（浏览器兜底）" });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/full-merge → 服务端 ffmpeg 拼接（浏览器 Wasm 不可用/无跨域隔离时的兜底）
  //   body { id, si, segs: [base64...], seq: [{t:'seg',i}|{t:'gap',sec}|{t:'intro',url}], bgm?: {kind:'url',url}|{kind:'file',dataBase64}, vol, fadeIn, fadeOut }
  //   → 逐项写文件/生成静音/拉 intro → concat；带 bgm 时两段式（干声 wav + 铺 BGM 混音）→ aac 128k m4a → 返回 base64
  if (path === "/api/run/full-merge" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const chunks = [];
    let msize = 0;
    for await (const c2 of req) {
      chunks.push(c2); msize += c2.length;
      if (msize > 150 * 1024 * 1024) { sendJson(res, { ok: false, error: "数据过大（>150MB）" }, 413); return; }
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = {}; }
    const segs = Array.isArray(body && body.segs) ? body.segs : null;
    const seq = Array.isArray(body && body.seq) ? body.seq : null;
    if (!segs || !seq || !seq.length) { sendJson(res, { ok: false, error: "需 segs + seq" }, 400); return; }
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join: jn } = await import("node:path");
    const dir = mkdtempSync(jn(tmpdir(), "dailog-merge-"));
    try {
      const list = [];
      let n = 0;
      for (const item of seq) {
        if (item && item.t === "seg") {
          const b64 = segs[item.i];
          if (typeof b64 !== "string" || !b64) { sendJson(res, { ok: false, error: "段 " + item.i + " 音频缺失" }, 400); return; }
          const nm = "seg" + n + ".mp3";
          writeFileSync(jn(dir, nm), Buffer.from(b64, "base64"));
          list.push("file '" + nm + "'");
        } else if (item && item.t === "gap") {
          const sec = Math.max(0, Math.min(10, Number(item.sec) || 0));
          const nm = "sil" + n + ".mp3";
          execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(sec), "-c:a", "libmp3lame", "-q:a", "9", jn(dir, nm)], { stdio: "ignore" });
          list.push("file '" + nm + "'");
        } else if (item && item.t === "intro") {
          const resp = await fetch(String(item.url || "")).catch(() => null);
          if (!resp || !resp.ok) { sendJson(res, { ok: false, error: "intro 下载失败: " + (item.url || "") }, 400); return; }
          const nm = "intro" + n + ".mp3";
          writeFileSync(jn(dir, nm), Buffer.from(await resp.arrayBuffer()));
          list.push("file '" + nm + "'");
        } else { sendJson(res, { ok: false, error: "未知序列项" }, 400); return; }
        n++;
      }
      writeFileSync(jn(dir, "list.txt"), list.join("\n"));
      const bgmCfg = (body && body.bgm && typeof body.bgm === "object" && (body.bgm.kind === "url" || body.bgm.kind === "file")) ? body.bgm : null;
      if (bgmCfg) {
        // 带 BGM：两段式——第 1 段 concat 出干声 wav（44100 mono），第 2 段铺 BGM 混音
        execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", jn(dir, "list.txt"), "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", jn(dir, "dry.wav")], { stdio: "ignore" });
        let bgmBytes = null;
        if (bgmCfg.kind === "file" && typeof bgmCfg.dataBase64 === "string" && bgmCfg.dataBase64) {
          bgmBytes = Buffer.from(bgmCfg.dataBase64, "base64");
        } else if (bgmCfg.kind === "url" && typeof bgmCfg.url === "string" && bgmCfg.url) {
          const resp = await fetch(bgmCfg.url).catch(() => null);
          if (!resp || !resp.ok) { sendJson(res, { ok: false, error: "BGM 下载失败: " + (bgmCfg.url || "") }, 400); return; }
          bgmBytes = Buffer.from(await resp.arrayBuffer());
        }
        if (!bgmBytes || !bgmBytes.length) { sendJson(res, { ok: false, error: "BGM 内容缺失" }, 400); return; }
        writeFileSync(jn(dir, "bgm.bin"), bgmBytes);
        // 干声时长（ffprobe）→ 淡出定位
        const durStr = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", jn(dir, "dry.wav")], { encoding: "utf8" }).trim();
        const dur = Number(durStr) || 0;
        if (!(dur > 0)) { sendJson(res, { ok: false, error: "干声时长探测失败" }, 500); return; }
        const fc = serverBgmFilter(bgmCfg, dur);
        execFileSync("ffmpeg", ["-y", "-i", jn(dir, "dry.wav"), "-stream_loop", "-1", "-i", jn(dir, "bgm.bin"), "-filter_complex", fc, "-map", "[out]", "-c:a", "aac", "-b:a", "128k", jn(dir, "final.m4a")], { stdio: "ignore" });
      } else {
        // 无 BGM：保持原单段 concat（行为与改造前一致）
        execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", jn(dir, "list.txt"), "-c:a", "aac", "-b:a", "128k", jn(dir, "final.m4a")], { stdio: "ignore" });
      }
      const out = readFileSync(jn(dir, "final.m4a"));
      sendJson(res, { ok: true, audio: Buffer.from(out).toString("base64"), mime: "audio/mp4", size: out.length });
    } finally { rmSync(dir, { recursive: true, force: true }); }
    return;
  }

  // POST /api/run/tts-seg → 单段语音生成（body {id, scriptIndex, segIndex}）
  //   读该 seg（speaker/text）→ 取对应采样（host voiceSamples / guest 声线）→ ffmpeg 转 wav → fish 单说话人合成 → 返回 base64 mp3
  if (path === "/api/run/tts-seg" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    const scriptIndex = (body && body.scriptIndex !== undefined) ? Number(body.scriptIndex) : 0;
    const segIndex = (body && body.segIndex !== undefined) ? Number(body.segIndex) : 0;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    try {
      let detail = null;
      try { detail = await apiWithToken(e, token, "/v1/editor/submissions/" + id).catch(() => null); } catch {}
      // 脚本来源：优先前端工作副本（body.scripts，定稿前不落 R2）；无则 R2 权威
      const scripts = (body && Array.isArray(body.scripts) && body.scripts.length) ? body.scripts : ((detail && Array.isArray(detail.reviewScripts)) ? detail.reviewScripts : []);
      const target = scripts[scriptIndex];
      const seg = target && target.segments && target.segments[segIndex];
      if (!seg || typeof seg.text !== "string" || !seg.text.trim()) { sendJson(res, { ok: false, error: "片段不存在" }, 404); return; }
      const config = await configFor(e);
      const { synthesizeSingle } = await import("./lib/fish.mjs");
      // 参考音频：host = voiceSamples（R2 直取 + 转 wav）；guest = guests 声线（R2 audioKey + 转 wav）
      // 语种 = **投稿区**（detail.language）。兜底链与服务端 TTS **逐条对齐**，保证「试听听到的」=「最终合成的」：
      //   · 嘉宾：该语种 → en → **任意语种**（英文区没有 en 声线 → 用中文声线兜底；仍是这位嘉宾自己的音色）
      //   · 主持人：该语种 → en → 任意 ready 采样
      // 回退到非投稿区语种时打 warn（不静默）；选中的采样语种随音频一起下载（多语种时音频/文案不能错配）。
      const zone = (detail && detail.language) || "zh";
      let ref;
      if (seg.speaker === "guest") {
        const samples = await apiWithToken(e, token, "/v1/editor/guests/voice-samples").catch(() => []);
        const guestId = (detail && detail.guest && detail.guest.id) || null;
        const mine = (Array.isArray(samples) ? samples : []).filter((x) => x.guestId === guestId);
        // 兜底链（与服务端 TTS 同规则）：该语种 → en → **任意语种**（英文区没有 en 声线时用中文声线兜底）
        const row = mine.find((x) => x.language === zone) || mine.find((x) => x.language === "en") || mine[0];
        if (!row || !row.audioKey) { sendJson(res, { ok: false, error: "嘉宾 " + (guestId || "?") + " 无声线（用 guest-voice 上传后再试听）" }); return; }
        if (row.language !== zone) console.warn("[seg-tts] 嘉宾 " + guestId + " 无 " + zone + " 声线——回退 " + row.language + "（投稿 " + id + "）");
        // 音频按**选中的采样语种**下载：否则多语种嘉宾会拿到另一语种的音频（与 transcript 不匹配）
        const bytes = await apiFetchBytes(config, e, token, "/v1/editor/samples/guest/" + encodeURIComponent((detail && detail.guest && detail.guest.id) || "") + "/audio?language=" + encodeURIComponent(row.language || ""));
        ref = { audio: bytes, text: row.transcript || null };
      } else {
        // 主持人采样**严格按投稿区语种**：英文区必须用投稿人的英文采样（投稿门禁已保证存在），
        // 找不到就报错——绝不用别的语种兜底（中文采样读英文 = 口音/身份都不对，且静默出戏）。
        const samples = (detail && detail.voiceSamples) || [];
        const sample = samples.find((x) => x.language === zone);
        if (!sample || !sample.audioUrl) {
          sendJson(res, { ok: false, error: "该投稿区（" + zone + "）没有主持人采样——请投稿人先录一段 " + zone + " 采样；现有采样语种：" + (samples.map((x) => x.language).join("/") || "无") + "（不允许用别的语种兜底）" });
          return;
        }
        const bytes = await apiFetchBytes(config, e, token, "/v1/editor/samples/host/" + encodeURIComponent((detail && detail.userId) || "") + "/audio?language=" + encodeURIComponent(sample.language || ""));
        ref = { audio: bytes, text: sample.transcript || null };
      }
      // ffmpeg 转 44100Hz 单声道 wav（Fish 参考格式）
      const { execFileSync } = await import("node:child_process");
      const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const { join: jn } = await import("node:path");
      const dir = mkdtempSync(jn(tmpdir(), "dailog-seg-"));
      let wav;
      try {
        writeFileSync(jn(dir, "in.bin"), Buffer.from(ref.audio));
        execFileSync("ffmpeg", ["-y", "-i", jn(dir, "in.bin"), "-ar", "44100", "-ac", "1", jn(dir, "out.wav")], { stdio: "ignore" });
        wav = new Uint8Array(readFileSync(jn(dir, "out.wav")));
      } finally { rmSync(dir, { recursive: true, force: true }); }
      // normalize:false——关引擎文本规范化，2026 这类年份按原文读（A/B 实测正确，见 docs/spikes/fish-audio.md §10）
      const audio = await synthesizeSingle(config, seg.text, { audio: wav, text: ref.text || null }, { normalize: false });
      sendJson(res, { ok: true, audio: Buffer.from(audio).toString("base64"), mime: "audio/mpeg", speaker: seg.speaker, text: seg.text.slice(0, 50) });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/llm → 通用 LLM 调用（llm-box 组件后端）：
  //   接收 { messages: [{role, content}], config?: {temperature, seed, maxTokens, thinking} }
  //   → 调 LLM → 返回 { result(解析后JSON), usage }
  if (path === "/api/run/llm" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const body = await readBody(req);
    const messages = (body && Array.isArray(body.messages)) ? body.messages : null;
    if (!messages || messages.length === 0) { sendJson(res, { ok: false, error: "需 messages 数组" }, 400); return; }
    try {
      const cfgOverride = {};
      const cfg = (body && body.config) || {};
      if (cfg.temperature !== undefined && cfg.temperature !== "") cfgOverride.temperature = Number(cfg.temperature);
      if (cfg.seed !== undefined && cfg.seed !== "") cfgOverride.seed = Number(cfg.seed);
      if (cfg.maxTokens !== undefined && cfg.maxTokens !== "") cfgOverride.maxTokens = Number(cfg.maxTokens);
      if (cfg.thinking !== undefined) cfgOverride.thinking = cfg.thinking;
      const r = await llmComplete(null, null, cfgOverride, messages);
      const usage = r.usage;
      let result = null;
      try { result = extractJson(r.content); }
      catch (err) { result = { raw: r.content }; }
      sendJson(res, { ok: true, result, usage: fmtUsage(usage) });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

/** 打磨输入 = 这一期所有播出的话（开场 + 每一回 ask/answer + 收尾）。
 *  这里以前有 splitScriptShell / rejoinShell 一整套"拆壳—磨主体—拼回壳"的机制，
 *  那是 r3 旧草稿的遗留（那时开场收尾是固定品牌句式，所以不磨）；
 *  现在外壳是"部件必须有、话自己说"，开场收尾也是要磨的台词 → 整套拆拼机制删掉。 */
/** 素材主语言（确定性判定，不交给模型猜）：逐条消息比「中文字数 vs 拉丁词数」，多数派胜出。
 *  为什么要算：提示词是英文长文档，模型偶尔把整篇分析/脚本也写成英文——实测同一篇中文稿重跑会在中英之间摆动。
 *  所以把「这篇素材是什么语言」当成**事实**钉在 system 末尾。 */
function contentLanguageOf(dialogue) {
  const msgs = (dialogue && Array.isArray(dialogue.messages)) ? dialogue.messages : [];
  let zh = 0, en = 0;
  for (const m of msgs) {
    const t = String((m && m.content) || "");
    const c = (t.match(/[\u4e00-\u9fff]/g) || []).length;
    const w = Math.round(((t.match(/[A-Za-z]/g) || []).length) / 5);   // 拉丁字母数 ÷ 5 ≈ 词数
    if (!c && !w) continue;
    if (c >= w) zh++; else en++;
  }
  return zh >= en ? "Simplified Chinese (简体中文)" : "English";
}

/** 维度标签 → 字段名（提示词 §9/§10 用的是人话标签） */
const DIM_KEY_BY_LABEL = {
  "cognitive delta": "cognitive_delta",
  "thinking depth": "thinking_depth",          // 新稿 §14 B
  "exploration depth": "exploration_depth",    // 旧稿 §10 B（两稿各不相同，不要互相别名，否则明细对不上 key）
  "tension / stakes": "tension_stakes",
  "perspective potential": "perspective_potential",  // 新稿 §14 D
  "audience resonance": "audience_resonance",        // 旧稿 §10 E
  "surprise": "surprise",
  "source integrity": "source_integrity",
};
/** 兜底权重（提示词那张表解析不出来时用；正常走解析结果）。
 *  只用于**评分明细的展示**（各维度分 × 权重），总分不在这里算。 */
const SCORE_WEIGHTS_FALLBACK = { cognitive_delta: 6, thinking_depth: 4, tension_stakes: 3, perspective_potential: 3, surprise: 2, source_integrity: 2 };

/** 从提案提示词 §10 那张表里解析六维权重——"Cognitive Delta      × 7 = /35" → { cognitive_delta: 7, … }。
 *  这样权重**只维护在提示词一处**：改 §9/§10 的系数，服务端自动跟着变，不用两头同步。 */
function scoreWeightsFromPrompt(p) {
  const doc = ((p && p.messages) || []).map((m) => String(m.content || "")).join("\n");
  const out = {};
  doc.replace(/^([A-Za-z][A-Za-z \/]*?)\s*×\s*(\d+)\s*=\s*\/\s*(\d+)\s*$/gm, (all, label, w) => {
    const key = DIM_KEY_BY_LABEL[String(label).trim().toLowerCase().replace(/\s+/g, " ")];
    if (key) out[key] = Number(w);
    return all;
  });
  const keys = Object.values(DIM_KEY_BY_LABEL);
  return keys.every((k) => Number.isFinite(out[k])) ? out : null;
}


/** 投稿区（submissions.language）→ 提示词里的语言标签；未知区回退 null（退回"跟随原文语言"的旧行为） */
const ZONE_LABELS = { zh: "Simplified Chinese (简体中文)", en: "English" };
function zoneLabel(zone) {
  return ZONE_LABELS[String(zone || "").toLowerCase()] || null;
}

/** 把语言事实追加到 system 末尾（渲染之后调用；不改提示词文档本身，也不占占位符）。
 *  目标语言 = **投稿区**（submissions.language）——不是原文语言：
 *    · 目标 == 原文 → 与旧行为一致（"用原文语言写"）；
 *    · 目标 ≠ 原文 → 明确声明这是**译写**：保意义/事实/回合顺序/引文实质，全部用目标语言输出。
 *  为什么钉成事实：提示词是英文长文档，模型偶尔把整篇分析/脚本也写成英文——实测同一篇中文稿重跑会在中英之间摆动。 */
function withLanguageFact(msgs, dialogue, zone) {
  const sourceLang = contentLanguageOf(dialogue);
  const targetLang = zoneLabel(zone) || sourceLang;
  const translating = targetLang !== sourceLang;
  const note = "\n\n## Content language (fixed fact for this submission)\n\n"
    + "The original conversation above is written in **" + sourceLang + "**. "
    + "This submission's target zone is **" + targetLang + "**. "
    + "Write every string value in your JSON output in **" + targetLang + "**"
    + (translating
        ? " — this is a **translation/adaptation** task: keep the meaning, the facts, the order of the conversation and the substance of every quote, but render everything in " + targetLang + ". Never output " + sourceLang + " text."
        : "")
    + " JSON field names stay English, and proper nouns, product names and code identifiers keep their original form. "
    + "Do not switch the language of the analysis or the script because these task instructions are written in English.";
  return (Array.isArray(msgs) ? msgs : []).map((m, i) => (i === 0 && m && m.role === "system") ? { role: m.role, content: String(m.content) + note } : m);
}

function polishInputView(target) {
  const segs = (target && Array.isArray(target.segments)) ? target.segments : [];
  // 只喂 speaker + text。老脚本里可能残留历史字段（src / origRatio / fromTurn / chain / type / name），
  // 对模型没用：白占 token，还会被原样回显、跟着写进新脚本。顺序与条数保持不变（提示词要求一一对应）。
  return {
    segments: segs.map((s) => ({
      speaker: String((s && s.speaker) || "").toLowerCase() === "guest" ? "guest" : "host",
      text: String((s && s.text) || ""),
    })),
  };
}




// 评分唯一来源 = 模型输出里的 score.overall（提示词 §14 SCORING MODEL / §15 TOTAL SCORE 定义分档与加权）。
// 服务端**不再**重算总分：权重表只存在于提示词一处，改权重不必两头同步。
// 下面只做「形态检查」——分在不在、是不是 0–100 的数——不判断它对不对。


/** 提案锁定的素材轮次：优先 覆盖turns 数组，否则从「t3–t9、t13」这类人话里解析 */
function coveredTurnsOf(proposal) {
  if (!proposal || typeof proposal !== "object") return null;
  const arr = proposal["覆盖turns"];
  if (Array.isArray(arr)) {
    const nums = Array.from(new Set(arr.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0))).sort((a, b) => a - b);
    if (nums.length) return nums;
  }
  const s = String(proposal["覆盖轮次"] || proposal["覆盖范围"] || "");
  if (!s) return null;
  const nums = new Set();
  for (const m of s.matchAll(/t?(\d+)\s*[–—\-~至到]\s*t?(\d+)/g)) {
    const a = Number(m[1]), b = Number(m[2]);
    for (let i = a; i <= b && i - a < 500; i++) nums.add(i);
  }
  for (const m of s.matchAll(/t?(\d+)/g)) { const n = Number(m[1]); if (n > 0) nums.add(n); }
  const out = Array.from(nums).sort((a, b) => a - b);
  return out.length ? out : null;
}

/** 轮次数组 → 人话标签（连续段合并）：[3,4,5,9] → t3–t5、t9 */
function turnsLabel(nums) {
  const a = (Array.isArray(nums) ? nums.slice() : []).sort((x, y) => x - y);
  if (!a.length) return "";
  const parts = [];
  let s = a[0], prev = a[0];
  for (let i = 1; i <= a.length; i++) {
    const v = a[i];
    if (v !== prev + 1) { parts.push(s === prev ? ("t" + s) : ("t" + s + "–t" + prev)); s = v; }
    prev = v;
  }
  return parts.join("、");
}

/** 对话原文 → tN 编号素材（原文照录：一条消息一块，行首 tN + 说话人，正文不改一字）
 *  onlyTurns 给了就只放这些轮次——**锁定素材范围**，别把无关段落喂给 R2。 */
// ===== 外部粘贴/成品折叠（审题 & 创作共用一套口径）=====
/** 判定阈值。两类才算"被投进对话的成品"：
 *  ① 体型像文档：≥ 6000 字，且 ≥ 全文消息长度中位数的 4 倍；
 *  ② 身上带成品特征（剧本标记 **[01 opening]**、整份提示词 You are the **、≥3 个 Markdown 标题、两处以上代码围栏）且 ≥ 1200 字。
 *  为什么要在注入前折掉：这类内容会稀释注意力（实测一篇 53 万字投稿里，模型放着 86% 的正文不看，
 *  去给 t19 那条被贴进来的成品剧本建了三条线索），也白烧 token。
 *  为什么不只看长度：聊天里 AI 动辄回 3-5 千字，那是它自己的话，不是成品——所以必须先看特征。 */
const PASTE_HARD_CHARS = 12000;     // 单条 ≥1.2 万字：基本一定是被搬进来的文档
const PASTE_DOC_CHARS = 6000;       // 文档尺度下限（且要比这篇对话的常态长得多）
const PASTE_DOC_RATIO = 6;
const PASTE_SIG_MIN_CHARS = 1500;   // 剧本标记的有效长度下限
const PASTE_SIG_RE = /\*\*\[\s*\d{1,2}\s+[a-z]/i;   // 剧本标记：**[01 opening]

/** 像"整份文档/提示词"的形态（不是 AI 平常那种带小标题的回答——所以要 ≥5 个标题或提示词开头） */
function looksLikeDocument(t) {
  if (/^You are the \*\*/m.test(t)) return true;              // 整份提示词文档
  if (/^#\s*\d+\.\s/m.test(t)) return true;                  // 编号章节的规范文档
  return (t.match(/^#{1,3} \S/gm) || []).length >= 5;          // 多级标题的成文
}

/** 找出"像成品"的消息，返回 [{n, role, chars, head, tail, why}] */
function findPastedArtifacts(dialogue) {
  const msgs = (dialogue && Array.isArray(dialogue.messages)) ? dialogue.messages : [];
  const lens = msgs.map((m) => String((m && m.content) || "").length).filter((n) => n > 0).sort((a, b) => a - b);
  if (!lens.length) return [];
  const median = lens[Math.floor(lens.length / 2)] || 1;
  const out = [];
  msgs.forEach((m, i) => {
    const t = String((m && m.content) || "");
    const huge = t.length >= PASTE_HARD_CHARS;
    const docish = t.length >= PASTE_DOC_CHARS && t.length >= median * PASTE_DOC_RATIO && looksLikeDocument(t);
    const sigish = t.length >= PASTE_SIG_MIN_CHARS && PASTE_SIG_RE.test(t);
    if (!huge && !docish && !sigish) return;
    out.push({ n: i + 1, role: (m && m.role) || "user", chars: t.length, head: t.slice(0, 60), why: sigish ? "剧本" : (huge ? "超长" : "文档/提示词") });
  });
  return out;
}

/** 折叠：把成品的正文换成"桩"（留首尾，便于编辑核对是哪一份），返回新 dialogue + 折叠清单 */
function foldPastedArtifacts(dialogue) {
  const msgs = (dialogue && Array.isArray(dialogue.messages)) ? dialogue.messages : [];
  const found = findPastedArtifacts(dialogue);
  if (!found.length) return { dialogue, folded: [], savedChars: 0 };
  const byN = new Map(found.map((f) => [f.n, f]));
  let saved = 0;
  const messages = msgs.map((m, i) => {
    const f = byN.get(i + 1);
    if (!f) return m;
    const raw = String((m && m.content) || "");
    saved += raw.length - f.head.length;
    const stub = "〔外部粘贴/成品：" + f.chars + " 字（" + f.why + "），已折叠；开头 60 字仅供辨认：" + f.head.replace(/\s+/g, " ") + " …〕";
    return Object.assign({}, m, { content: stub });
  });
  return { dialogue: Object.assign({}, dialogue, { messages }), folded: found, savedChars: saved };
}

/** 折叠说明（拼在素材最前面，让模型知道那些桩是什么） */
function foldLegend(folded) {
  return "（说明：本素材有 " + folded.length + " 处〔外部粘贴/成品〕已折叠——它们是投进这段对话的成品或外部内容"
    + "（剧本、文章、提示词、报告、代码、别的对话）。**折叠处的内容、以及对话中围绕它们的复述与点评，都只算这段工作过程，不得作为探索线索，也不得作为 evidence 引用。**"
    + "如果去掉这些成品与外部内容之后，剩下的只是「帮我改提示词 / 评审这份成品」这类工作过程，请按 §4 判为不合格（eligible=false）。）";
}

function dialogueBlockFor(dialogue, hostName, guestName, onlyTurns) {
  const msgs = Array.isArray(dialogue && dialogue.messages) ? dialogue.messages : [];
  const keep = (Array.isArray(onlyTurns) && onlyTurns.length) ? new Set(onlyTurns.map((x) => Number(x))) : null;
  const kept = [];
  msgs.forEach((m, i) => {
    const n = i + 1;
    if (keep && !keep.has(n)) return;
    const role = (m && m.role === "user") ? (hostName || "主持人") : (guestName || "AI");
    const text = String((m && m.content) == null ? "" : m.content).replace(/\s+$/g, "");
    kept.push("[t" + n + " " + role + "]\n" + text);
  });
  return kept.join("\n\n");
}






/** draft R2 输出（hostOpen/guestOpen/turns/hostWrap/guestSum/hostOutro）→ 补出 segments（lab 的 TTS/渲染消费）；
 *  原字段一并保留，供 R3 打磨（分层：壳 + 主体）与 R4 文案消费 */
function segmentsFromDraftShape(p) {
  if (!p || typeof p !== "object") return null;
  if (Array.isArray(p.segments) && p.segments.length) return p;
  const turns = Array.isArray(p.turns) ? p.turns : null;
  if (!turns && !p.hostOpen && !p.guestOpen && !p.hostWrap) return null;
  const segs = [];
  const push = (speaker, text) => {
    const t = String(typeof text === "string" ? text : (text && text.text) || "").replace(/\s+/g, " ").trim();
    if (t) segs.push({ speaker, text: t });
  };
  push("host", p.hostOpen);
  push("guest", p.guestOpen);
  (turns || []).forEach((t) => { if (!t) return; push("host", t.ask); push("guest", t.answer); });
  push("host", p.hostWrap);
  push("guest", p.guestSum);
  push("host", p.hostOutro);
  if (!segs.length) return null;
  return Object.assign({}, p, { segments: segs });
}


  // POST /api/run/review/preview → 状态0：两轮 LLM 调用输入预览（可编辑后发送）
  //   第1轮 system=打分规则 + user=仅对话；第2轮 追加 assistant=脚本规则 + user=参数（suggestion/host/guests）
  if (path === "/api/run/review/preview" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    try {
      const dialogue = await loadDialogue(e, token, id);
      if (!dialogue) { sendJson(res, { ok: false, error: "未采集——请先采集对话" }); return; }
      // 字典消费（工程文件，热更新）
      const pScript = getPrompt("r2-script");
      // 快照（投稿时定格，直接取）
      const detail = await apiWithToken(e, token, "/v1/editor/submissions/" + id).catch(() => null);
      const hostSnap = (detail && detail.host) || null;
      const guestSnap = (detail && detail.guest) || null;
      const cfg = llmConfig();
      // 第1轮：system=打分规则文本（字典静态部分），user1=仅对话 json
      const scoreSystem = (pScore.messages.find(m => m.role === "system") || {}).content || "";
      // 第2轮：scriptRule = 渲染后的续接指令（script-material.system 素材 + script-by-proposal.user 提示词；提案由 review 运行时注入）
      const rendered = renderPrompt(pScript, {
        score: null,
        review: null,
        suggestion: (detail && detail.suggestion) || "",
        host: hostSnap ? { callName: hostSnap.callName || "主持人", personaInfo: hostSnap.personaInfo || undefined } : { callName: "主持人" },
        guests: guestSnap ? [{ name: guestSnap.name, platform: guestSnap.id, intro: guestSnap.intro || null }] : [{ name: "AI" }],
      });
      const scriptRule = (rendered[0] || {}).content || "";
      sendJson(res, {
        ok: true,
        system: scoreSystem,
        user1: JSON.stringify({ dialogue }, null, 1),
        // scriptRule = 渲染后的系统规则（{{host.callName}}/{{guests.name}} 已解析；评分/选题由 review 运行时注入）
        scriptRule,
        user2: JSON.stringify({
          suggestion: (detail && detail.suggestion) || undefined,
          host: hostSnap ? { callName: hostSnap.callName || undefined, personaInfo: hostSnap.personaInfo || undefined } : undefined,
          guests: guestSnap ? [{ name: guestSnap.name, platform: guestSnap.id, intro: guestSnap.intro || null }] : undefined,
        }, null, 1),
        temperature: cfg && cfg.temperature !== undefined ? cfg.temperature : 0.7,
        seed: cfg && cfg.seed !== undefined ? cfg.seed : 42,   // 默认固定 seed，可复现
      });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/review/round1 → 审题第1轮：评分（llm-box 组件1）
  //   接收 {id, messages?, config?, preview?}——messages/config 覆盖（预览可编辑传回）；preview=true 返回渲染预览不执行
  if (path === "/api/run/review/round1" && req.method === "POST") {
    const stopAC = new AbortController();
    res.on("close", () => { if (!res.writableEnded) stopAC.abort(); });   // 编辑点「停止」→ 断连 → 中止上游生成
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    try {
      const dialogue = await loadDialogue(e, token, id);
      if (!dialogue) { sendJson(res, { ok: false, error: "未采集——请先采集对话" }); return; }
      const detail = await apiWithToken(e, token, "/v1/editor/submissions/" + id).catch(() => null);   // 投稿区（目标语言）来源
      const p = getPrompt("r1-review");
      // 素材必须与 R2 同款渲染：行首 tN + 说话人 + 逐字正文。
      // 曾经这里塞的是 JSON.stringify(dialogue)（原始 JSON 大数组），模型得自己在 JSON 里数位置推 tN——
      // 实测 30 条以上的对话，路径证据的原话和 tN 会整段错位（原话在 t15，标成 t9），编辑核对直接对不上；
      // 而且 dialogue 是字符串时 {{dialogue.sourceUrl}} 永远渲染成空。
      const fold = foldPastedArtifacts(dialogue);   // 成品/外部内容先折叠，再进提示词
      const dlgBlock = (fold.folded.length ? foldLegend(fold.folded) + "\n\n" : "") + dialogueBlockFor(fold.dialogue, "Human", "AI", null);   // 与提案提示词里的 Human/AI 一致
      const defaultMsgs = withLanguageFact(renderPrompt(p, {
        dialogue: { messages: dlgBlock, sourceUrl: (dialogue && dialogue.sourceUrl) || "" },
        suggestion: "",
      }), fold.dialogue, detail && detail.language);
      if (fold.folded.length) console.log("[round1] 外部粘贴/成品折叠 " + fold.folded.length + " 处（省 " + fold.savedChars + " 字）：" + fold.folded.map((f) => "t" + f.n + "(" + f.chars + ")").join(" "));
      const cfgOverride = {};
      if (body && Array.isArray(body.messages) && body.messages.length) {
        const cfg = (body && body.config) || {};
        if (cfg.temperature !== undefined && cfg.temperature !== "") cfgOverride.temperature = Number(cfg.temperature);
        if (cfg.seed !== undefined && cfg.seed !== "") cfgOverride.seed = Number(cfg.seed);
        if (cfg.maxTokens !== undefined && cfg.maxTokens !== "") cfgOverride.maxTokens = Number(cfg.maxTokens);
        if (cfg.thinking !== undefined) cfgOverride.thinking = cfg.thinking;
      }
      if (body && body.preview) {
        sendJson(res, { ok: true, apiBody: previewApiBody("r1-review", defaultMsgs), preview: { messages: defaultMsgs, config: p.config || {}, name: p.name || key, description: p.description || "" } });
        return;
      }
      const msgs = (body && Array.isArray(body.messages) && body.messages.length) ? body.messages : defaultMsgs;
      console.log("[round1] 消息来源=" + (msgs === defaultMsgs ? "defaultMsgs(最新渲染)" : "body.messages(快照 " + msgs.length + " 条)"));
      // 出稿 + 兜底（实测 24 篇样本里 4 篇需要兜底）：
      //   ① 解析失败（模型偶尔截断/格式错）→ 以前直接抛错，现在带提示重试一次；
      //   ② 空对象（不合格稿子常见）→ 同上；
      //   ③ 被包了一层信封 {"type":"json_object","content":{真正的契约…}} → 直接拆开用（provider 的 json_object 模式偶发）。
      const unwrapEnvelope = (v) => (v && typeof v === "object" && !Array.isArray(v)
        && v.content && typeof v.content === "object" && !v.exploration_threads && !v.eligibility) ? v.content : v;
      const parseOnce = async (m) => {
        const rr = await llmComplete(null, null, cfgOverride, m, p.config, stopAC.signal);
        let parsed = null;
        try { parsed = extractJson(rr.content); } catch { parsed = null; }   // 解析失败不立刻抛，留给重试
        return { rr, parsed: unwrapEnvelope(parsed) };
      };
      let { rr: r, parsed: result } = await parseOnce(withRevision(msgs, (body && body.revision) || ""));
      const isEmptyResult = (v) => !v || typeof v !== "object" || !Object.keys(v).length;
      if (isEmptyResult(result)) {
        // 重试不能原样重发（同样的输入大概率同样为空）：按 round2 的老办法带一条明确要求重发。
        console.log("[round1] 出稿不可解析（" + JSON.stringify(String(r.content).slice(0, 80)) + "），带提示重试一次…");
        const nudgeR1 = "你上一轮没有返回可解析的 JSON。请只输出那一个 JSON 对象——即使这篇稿子不合格（eligible=false），也必须按契约输出 { eligibility: { eligible: false, reason: \"…\" }, exploration_threads: [], recommended_thread_id: null, creative_proposal: null }；不要解释、不要多余文字。";
        const retryMsgs = (String(r.content || "").trim() ? msgs.concat([{ role: "assistant", content: r.content }]) : msgs)
          .concat([{ role: "user", content: nudgeR1 }]);
        const again = await parseOnce(retryMsgs);
        if (!isEmptyResult(again.parsed)) { result = again.parsed; r = again.rr; }
        else console.log("[round1] 重试仍不可解析：" + JSON.stringify(String(again.rr.content).slice(0, 120)));
      }

      // 出稿校验（不阻断，仅报告）——按「提案 v2」契约（eligibility + 加权分 + recommended_thread_id）：
      //   ① eligible=false ⇒ 必须 threads=[] 且 creative_proposal=null（旧结果没这字段时按 eligible 处理）
      //   ② eligible=true  ⇒ creative_proposal 九字段齐、每条线八字段齐、有 evidence、recommended_thread_id 能对上号
      //   ③ score 只查形态（overall 是不是 0–100 的数字）——总分以模型输出为准，服务端不重算（算术只在提示词一处）
      const warnings = [];
      const WEIGHTS = scoreWeightsFromPrompt(p) || SCORE_WEIGHTS_FALLBACK;
      if (!scoreWeightsFromPrompt(p)) console.warn("[proposal-validate] 提示词 §15 的权重表没解析出来，评分明细改用兜底权重 " + JSON.stringify(SCORE_WEIGHTS_FALLBACK));
      // 八字段住在 exploration_threads 里（每条线自带）；顶层 creative_proposal 只承载 recommended_duration（提示词 §20）
      const THREAD_FIELDS = ["title", "core_question", "initial_state", "central_tension", "exploration", "turning_point", "possible_discovery", "ending_state", "open_question"];
      const filled = (v) => (typeof v === "string" ? !!v.trim() : !!v);
      const elig = (result && result.eligibility && typeof result.eligibility === "object") ? result.eligibility : null;
      const eligible = elig ? elig.eligible !== false : true;
      const threads = Array.isArray(result && result.exploration_threads) ? result.exploration_threads : [];
      const cpOut = (result && result.creative_proposal) || null;
      if (!eligible) {
        if (threads.length) warnings.push("eligibility.eligible=false 却仍返回 " + threads.length + " 条探索线（应为空数组）");
        if (cpOut) warnings.push("eligibility.eligible=false 却仍给了 creative_proposal（应为 null）");
      } else {
        if (cpOut) {
          if (!filled(cpOut.recommended_duration)) warnings.push("creative_proposal 缺 recommended_duration（顶层只承载时长；八字段应在 exploration_threads 里）");
        } else if (result) {
          warnings.push("没有 creative_proposal（提案环节没交付 recommended_duration）");
        }
        if (!elig) warnings.push("返回体缺 eligibility（新契约必须给这个对象；缺了就当成契约异常）");
        if (Object.keys(result || {}).length && !threads.length) warnings.push("eligible=true 却没有探索线");
      }
      threads.forEach((t, ti) => {
        const miss = THREAD_FIELDS.filter((k) => !filled(t[k]));
        if (miss.length) warnings.push(`T${ti + 1} 缺字段：${miss.join("、")}`);
        if (!Array.isArray(t.evidence) || !t.evidence.length) warnings.push(`T${ti + 1} 缺 evidence（这条线没有原文出处）`);
        // 总分**以模型输出为准**：提示词 §14/§15 要求它自己按 6/4/3/3/2/2 加权求和写进 score.overall，
        //   服务端不再重算、也不再拿重算值去纠正它——两套算术打架只会让编辑不知道该信哪个。
        //   服务端只做形态校验：overall 必须是 0–100 的数字。
        //   weights 仍然下发，但只用于前端展示「各维度分 × 权重」的明细。
        const sc = (t && t.score && typeof t.score === "object") ? t.score : null;
        if (!sc) { warnings.push(`T${ti + 1} 缺 score（编辑没法比较各条线）`); return; }
        sc.weights = Object.assign({}, WEIGHTS);
        const overall = Number(sc.overall);
        if (!Number.isFinite(overall)) warnings.push(`T${ti + 1} 没给 score.overall（总分缺失）`);
        else if (overall < 0 || overall > 100) warnings.push(`T${ti + 1} score.overall=${sc.overall} 不在 0–100 之间`);
      });
      if (eligible && threads.length) {
        const recId = result && result.recommended_thread_id;
        if (!recId) warnings.push("缺 recommended_thread_id（提案墙标不出推荐线）");
        else if (!threads.some((t) => t && t.id === recId)) warnings.push("recommended_thread_id=" + recId + " 不在 exploration_threads 里");
      }
      if (fold.folded.length) warnings.push("素材里有 " + fold.folded.length + " 处外部粘贴/成品已折叠（省 " + fold.savedChars + " 字）：" + fold.folded.map((f) => "t" + f.n + "(" + f.chars + "字)").join("、"));
      if (warnings.length) console.warn("[proposal-validate]", warnings.join(" | "));
      console.log("[review-debug] round1 result: eligible=" + eligible + " | threads x" + threads.length + " | recommended=" + ((result && result.recommended_thread_id) || "（无）") + " | creative_proposal=" + (cpOut ? "有" : "无"));
      sendJson(res, { ok: true, result, weights: WEIGHTS, warnings, usage: fmtUsage(r.usage) });
    } catch (err) {
      if (stopAC.signal.aborted) { console.log("[round1] 客户端已停止——已中止生成"); return; }
      sendJson(res, { ok: false, error: String((err && err.message) || err) });
    }
    return;
  }

  // POST /api/run/review/round2 → 审题第2轮：脚本创作（llm-box 组件2；依赖 round1 的 score）
  if (path === "/api/run/review/round2" && req.method === "POST") {
    const stopAC = new AbortController();
    res.on("close", () => { if (!res.writableEnded) stopAC.abort(); });
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    const score = (body && body.score !== undefined) ? Number(body.score) : null;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    try {
      const dialogue = await loadDialogue(e, token, id);
      if (!dialogue) { sendJson(res, { ok: false, error: "未采集——请先采集对话" }); return; }
      const detail = await apiWithToken(e, token, "/v1/editor/submissions/" + id).catch(() => null);
      const hostSnap = (detail && detail.host) || null;
      const guestSnap = (detail && detail.guest) || null;
      const pScript = getPrompt("r2-script");
      // R1→R2 的唯一接口：编辑锁定的 creative_proposal（新契约九字段）
      const review = (body && body.review && typeof body.review === "object") ? body.review : null;
      const cp = review || {};
      const hostName = (hostSnap && hostSnap.callName) || "主持人";
      const guestName = (guestSnap && guestSnap.name) || "AI";
      const dlgTotal = ((dialogue && dialogue.messages) || []).length;
      const fold2 = foldPastedArtifacts(dialogue);   // 与审题同一套口径：成品/外部内容先折叠
      if (fold2.folded.length) console.log("[round2] 外部粘贴/成品折叠 " + fold2.folded.length + " 处（省 " + fold2.savedChars + " 字）：" + fold2.folded.map((f) => "t" + f.n + "(" + f.chars + ")").join(" "));
      const rendered = renderPrompt(pScript, {
        dialogue: { messages: (fold2.folded.length ? foldLegend(fold2.folded) + "\n\n" : "") + dialogueBlockFor(fold2.dialogue, hostName, guestName, null), sourceUrl: (dialogue && dialogue.sourceUrl) || "" },
        suggestion: (detail && detail.suggestion) || "（无）",
        creative_proposal: JSON.stringify(cp, null, 1),
        HOST_NAME: hostName,
        GUEST_NAME: guestName,
      });
      // 素材给全篇：弧（creative_proposal）决定聚焦哪条线，对话原文提供素材
      const defaultMsgs = withLanguageFact([
        rendered[0],         // system：本期上下文（对话原文 + creative_proposal + 名字）
        rendered[1],         // user：脚本提示词（原样）
      ], fold2.dialogue, detail && detail.language);
      const zoneTag = zoneLabel(detail && detail.language) || contentLanguageOf(fold2.dialogue);
      console.log("[round2] " + hostName + " ↔ " + guestName + " | 目标语言=" + zoneTag + " | core_question=" + String(cp.core_question || "（无）").slice(0, 40) + " | 原文 " + dlgTotal + " 条 | 上下文=" + rendered[0].content.length + "字 + 规则=" + rendered[1].content.length + "字");
      const cfgOverride = {};
      if (body && Array.isArray(body.messages) && body.messages.length) {
        const cfg = (body && body.config) || {};
        if (cfg.temperature !== undefined && cfg.temperature !== "") cfgOverride.temperature = Number(cfg.temperature);
        if (cfg.seed !== undefined && cfg.seed !== "") cfgOverride.seed = Number(cfg.seed);
        if (cfg.maxTokens !== undefined && cfg.maxTokens !== "") cfgOverride.maxTokens = Number(cfg.maxTokens);
        if (cfg.thinking !== undefined) cfgOverride.thinking = cfg.thinking;
      }
      let msgs = (body && Array.isArray(body.messages) && body.messages.length) ? body.messages : defaultMsgs;
      console.log("[round2] 消息来源=" + (msgs === defaultMsgs ? "defaultMsgs(最新渲染)" : "body.messages(快照 " + msgs.length + " 条)"));
      // 人工修改意见（llm-box 重试输入框）：附带上一版脚本，追加到最后一条 user 消息
      const _rev = body && typeof body.revision === "string" ? body.revision.trim() : "";
      const _prev = (body && Array.isArray(body.previousScript) && body.previousScript.length) ? body.previousScript[0] : null;
      const _reroll = !!(body && body.reroll);   // 编辑在弹窗里显式点了「重摇一版」：不带上一版、不写意见，走全新生成
      // 「必填」在服务端也挡一道：带上一版却不写意见 = 静默重摇一版并把上一版覆盖掉（前端已拦，直调 API 也能拦住）
      if (!_rev && !_reroll && _prev && !(body && body.preview)) {
        sendJson(res, { ok: false, error: "改稿必须写修改意见——不写意见会重摇一版并覆盖上一版（要主动重摇，请用「重摇一版」）" }, 400);
        return;
      }
      if (_rev) {
        // 真·多轮改稿：上一版作为 assistant 回灌（模型是在改自己的稿，不是拿参考稿重写）；
        // 只带最近一版，不做无限历史——思考模式每轮都要重新想，上下文越长越贵越慢。
        if (_prev && !_reroll) {
          msgs = msgs.concat([
            { role: "assistant", content: JSON.stringify({ episode: _prev.episode || null, script: Array.isArray(_prev.script) ? _prev.script : null, segments: Array.isArray(_prev.segments) ? _prev.segments : null }, null, 1) },
            { role: "user", content: "编辑修改意见：\n" + _rev + "\n\n按意见改这一版：只改意见点到的地方，其余保持原样；仍然输出同一个 JSON 对象（不要解释、不要多余文字）。" },
          ]);
          console.log("[round2] 多轮改稿：上一版作为 assistant 回灌（意见 " + _rev.length + " 字）");
        } else {
          msgs = msgs.concat([{ role: "user", content: "编辑修改意见：\n" + _rev + "\n\n按意见修改后输出脚本对象（不要解释、不要多余文字）。" }]);
          console.log("[round2] 改稿：无上一版脚本，按意见重新生成（" + _rev.length + " 字）");
        }
        const _rk = cred.env + ":" + id;
        const _arr = retryDefects.get(_rk) || [];
        if (_arr.length < 20) _arr.push(_rev.slice(0, 500));
        retryDefects.set(_rk, _arr);   // 内存累积，入库时一并落盘
      } else if (_reroll) {
        console.log("[round2] 重摇一版（编辑显式要求）：不带上一版、不算改稿，也不进改稿缺陷数据");
      }
      // 预览放在追加之后：编辑在「预览 JSON」里看到的就是真正会发出去的输入（含那条修改意见）
      if (body && body.preview) {
        sendJson(res, { ok: true, apiBody: previewApiBody("r2-script", msgs), preview: { messages: msgs, config: pScript.config || {}, name: pScript.name || key, description: pScript.description || "", files: (pScript.messages || []).map((m) => ({ role: m.role, file: m.file || "" })) } });
        return;
      }
      retryAttempts.set(cred.env + ":" + id, (retryAttempts.get(cred.env + ":" + id) || 0) + 1);   // 实际生成计数（重试次数=该值-1）
      let r = await llmComplete(null, null, cfgOverride, msgs, pScript.config, stopAC.signal);
      console.log("[round2] 模型原始输出开头:", JSON.stringify(String(r.content).slice(0, 100)));
      // 新契约输出 { episode, production, script[{type,speaker,name,text}] }
      // → 在出口桥接成下游认识的 segments[{speaker: host|guest, text}]（r3 打磨 / TTS / 合成 / 发布只认它）
      const toSegments = (arr) => (Array.isArray(arr) ? arr : []).map((x) => ({
        speaker: String((x && x.speaker) || "").toLowerCase() === "host" ? "host" : "guest",
        text: String((x && x.text) || ""),
      })).filter((x) => x.text.trim());
      const buildOut = (obj) => {
        if (!obj || typeof obj !== "object") return null;
        const segs = toSegments(obj.script);
        if (!segs.length) return null;
        const out = Object.assign({}, obj, { segments: segs });
        return out;
      };
      const parseScript = (content) => { try { return buildOut(extractJson(content)); } catch (e) { return null; } };
      let out = parseScript(r.content);
      if (!out) {
        console.error("[review-debug] round2 无 script:", String(r.content).slice(0, 120));
        console.log("[round2] 出稿为空，自动重试一次…");
        const nudge = "你返回的内容里没有可用的 script 数组。这是脚本创作任务：必须输出完整 JSON 对象 { episode, production, script: [{type, speaker, name, text}] }，script 不得为空。请重新创作。";
        const retryMsgs = msgs.concat([{ role: "assistant", content: r.content }, { role: "user", content: nudge }]);
        const rr = await llmComplete(null, null, cfgOverride, retryMsgs, pScript.config, stopAC.signal);
        out = parseScript(rr.content);
        r = rr;
      }
      if (!out) { sendJson(res, { ok: false, error: "这次没有出稿（模型输出里没有可用的 script 数组）——可重试" }); return; }
      console.log("[review-debug] round2 segments:", out.segments.length);
      sendJson(res, {
        ok: true, result: { scripts: [out], episode: out.episode || null, production: out.production || null },
        usage: fmtUsage(r.usage),
        raw: String(r.content).slice(0, 400),   // 供质量标记样本（不落生产）
      });
    } catch (err) {
      if (stopAC.signal.aborted) { console.log("[round2] 客户端停止——已中止生成"); return; }
      sendJson(res, { ok: false, error: String((err && err.message) || err) });
    }
    return;
  }
  // POST /api/run/review/agent → 脚本创作 Agent（SSE 流式）：边写边说，最后给一个动作块
  //   事件：{"type":"status"} / {"type":"delta","text"} / {"type":"done", reply, action, proposals, script, reason, revision} / {"type":"error"}
  //   body: { id, phase, proposals?, chosen?, script?, text, force?, history? }
  if (path === "/api/run/review/agent" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const stopAC = new AbortController();
    res.on("close", () => { if (!res.writableEnded) stopAC.abort(); });
    const body = await readBody(req);
    const id = (body && body.id) || null;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    const phase = body.phase === "脚本" ? "脚本" : "提案";
    const text = String(body.text || "").trim();
    if (!text) { sendJson(res, { ok: false, error: "说点什么" }, 400); return; }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const send = (obj) => { try { if (!res.writableEnded) res.write("data: " + JSON.stringify(obj) + "\n\n"); } catch (err) {} };
    const hb = setInterval(() => { try { if (!res.writableEnded) res.write(": ping\n\n"); } catch (err) {} }, 10000);
    try {
      const p = getPrompt("review-agent");
      send({ type: "status", text: "读素材…" });
      const scriptView = (function () {
        const sc = body.script;
        if (!sc || typeof sc !== "object") return null;
        return { design: sc.design || "", hostOpen: sc.hostOpen || "", guestOpen: sc.guestOpen || "", turns: sc.turns || [], hostWrap: sc.hostWrap || "", guestSum: sc.guestSum || "", hostOutro: sc.hostOutro || "" };
      })();
      const detail0 = await apiWithToken(e, token, "/v1/editor/submissions/" + id).catch(() => null);
      const hostName0 = (detail0 && detail0.host && detail0.host.callName) || "主持人";
      const guestName0 = (detail0 && detail0.guest && detail0.guest.name) || "AI";
      const coveredA = coveredTurnsOf(body.proposal || null);
      const scopeA = coveredA ? (turnsLabel(coveredA) + "（共 " + coveredA.length + " 条）") : "全部原文";
      // （范围超出原文时，dialogueBlockFor 自然只放存在的那些）
      let dialogue = null, dialogueBlock = "";
      try { dialogue = await loadDialogue(e, token, id); if (dialogue) dialogueBlock = dialogueBlockFor(dialogue, hostName0, guestName0, coveredA); } catch (err) {}
      const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
      const historyText = history.length
        ? history.map((h) => ((h && h.role) === "user" ? "编辑：" : "你：") + String((h && h.content) || "").replace(/\n+/g, " ")).join("\n")
        : "（这是第一句）";
      const msgs = renderPrompt(p, {
        phase: phase,
        force: String(body.force || "").trim() || "（无）",
        // handoff（system）里用了 {{host.callName}} / {{guests.0.name}}——这里必须喂，
        // 否则 renderPrompt 会因为"占位符未在 params 声明"直接抛错（r2-script 与 review-agent 共用同一份 handoff）
        host: { callName: hostName0 },
        guests: [{ name: guestName0 }],
        history: historyText,
        scope: scopeA,
        turns: ((dialogue && dialogue.messages) || []).length,
        suggestion: (detail0 && detail0.suggestion) || "",
        dialogue: { messages: dialogueBlock || "（未取到素材）", sourceUrl: (dialogue && dialogue.sourceUrl) || "" },
        proposal: JSON.stringify(body.proposal || null, null, 1),
        script: JSON.stringify(scriptView, null, 1),
        text: text,
      });
      // 流式调用（与 llmComplete 同一套配置合并，只是 stream=true）
      const cfg = llmConfig();
      if (!cfg) throw new Error("未配置 LLM API key（DEEPSEEK_API_KEY）");
      Object.assign(cfg, p.config || {});
      if (!cfg.maxTokens) cfg.maxTokens = 8192;
      if (!cfg.thinking) cfg.thinking = { type: "disabled" };
      if (typeof cfg.thinking === "string") cfg.thinking = { type: cfg.thinking };
      send({ type: "status", text: "在想…" });
      let full = "";
      const visibleOf = (s) => { const i = String(s).indexOf("```"); return i >= 0 ? String(s).slice(0, i) : String(s); };
      let sent = 0;
      await complete(cfg, msgs, {
        stream: true,
        signal: stopAC.signal,
        onDelta: (d) => {
          full += d;
          const v = visibleOf(full);
          if (v.length > sent) { send({ type: "delta", text: v.slice(sent) }); sent = v.length; }
        },
      });
      clearInterval(hb);
      // 解析：正文 = 围栏之前的部分；动作 = 最后一个 json 块
      const jsonText = (function () {
        const all = String(full);
        const blocks = all.match(/```(?:json)?\s*[\s\S]*?```/g) || [];
        return blocks.length ? blocks[blocks.length - 1] : all;
      })();
      let parsed = null;
      try { parsed = extractJson(jsonText); } catch (err) { try { parsed = extractJson(full); } catch (err2) { parsed = null; } }
      let reply = visibleOf(String(full)).trim();
      if (!reply) reply = String((parsed && parsed.reply) || "").trim();
      if (!reply) { const raw = String(full); const cut = raw.indexOf("{"); reply = (cut > 0 ? raw.slice(0, cut) : "").trim(); }
      if (!reply) reply = "（这次没答上来——再说一次，或点「停止」重来）";
      const action = String((parsed && parsed.action) || "none");
      const revision = String((parsed && parsed.revision) || "").trim();
      let scriptOut = null;
      if (parsed && parsed.script && typeof parsed.script === "object") {
        try {
          const fixed = segmentsFromDraftShape(parsed.script);
          if (fixed && Array.isArray(fixed.segments) && fixed.segments.length) {
            scriptOut = fixed;
          }
        } catch (err) { console.log("[agent] script 解析失败：" + String((err && err.message) || err)); }
      }
      console.log("[agent] " + action + (scriptOut ? " | script " + scriptOut.segments.length + " 段" : "") + " | " + text.slice(0, 40));
      send({ type: "done", reply: reply, action: action, revision: revision, script: scriptOut });
      res.end();
    } catch (err) {
      clearInterval(hb);
      if (stopAC.signal.aborted) { console.log("[agent] 客户端停止——已中止生成"); try { res.end(); } catch (e2) {} return; }
      console.log("[agent] 失败：" + String((err && err.message) || err));
      send({ type: "error", error: String((err && err.message) || err) });
      try { res.end(); } catch (e2) {}
    }
    return;
  }

  // （拒审理由已并入 review-agent：agent 返回 action=reject + reason）
  // POST /api/feedback/review → 质量标记落盘（提示词自我进化的数据源）：追加到 feedback/review.jsonl
  //   body: { submissionId, score: 1-10, types: string[], note?, revision?, sample? }
  //   服务端只补 env。提示词版本指纹（promptSig）已按编辑要求撤掉——需要"回溯哪版提示词"时再加回来。
  if (path === "/api/feedback/review" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const body = await readBody(req);
    const sid = (body && body.submissionId) || null;
    const score = Number(body && body.score);
    if (!sid || !Number.isInteger(score) || score < 1 || score > 10) {
      sendJson(res, { ok: false, error: "需 submissionId + score(整数 1-10)" }, 400);
      return;
    }
    try {
      const dir = join(here, "feedback");
      mkdirSync(dir, { recursive: true });
      const row = {
        ts: Date.now(), iso: new Date().toISOString(),
        env: cred.env || null,
        submissionId: sid, score,
        verdict: score >= 7 ? "ok" : "problem",   // 派生，便于按二值聚合
        kind: body.kind === "adopt" ? "adopt" : null,   // 控制台采纳记录（可选）
        extras: Array.isArray(body.extras) ? body.extras.filter((t) => typeof t === "string").slice(0, 20) : [],  // 每次发送的追加提示词
        types: Array.isArray(body.types) ? body.types.filter((t) => typeof t === "string").slice(0, 6) : [],
        note: body.note ? String(body.note).slice(0, 500) : null,
        revision: body.revision ? String(body.revision).slice(0, 500) : null,
        sample: body.sample ? String(body.sample).slice(0, 400) : null,
      };
      writeFileSync(join(dir, "review.jsonl"), JSON.stringify(row) + "\n", { flag: "a" });
      sendJson(res, { ok: true });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/review/confirm → 确认提案 = 审题环节的提交点：body {id, review, proposals}
  //   ① review 入库（后端联动投稿状态 → selected）
  //   ② 本轮审题结果一并入库（换浏览器/清缓存后能拉回来）
  //   脚本不在这里动——脚本的提交点是「确认生成语音」
  if (path === "/api/run/review/confirm" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    const review = (body && body.review && typeof body.review === "object") ? body.review : null;
    const proposals = (body && body.proposals && typeof body.proposals === "object") ? body.proposals : null;
    if (!id || !review) { sendJson(res, { ok: false, error: "需 id + review" }, 400); return; }
    try {
      // 提交点①：锁定选题（后端联动投稿状态 → selected）
      const r = await apiWithToken(e, token, "/v1/editor/submissions/" + id + "/review", { method: "PUT", body: { review } });
      // 同一提交点：本轮审题结果一并入库（换浏览器/清缓存后能拉回来）
      if (proposals) await saveProduction(e, token, id, { reviewProposals: proposals }).catch(() => null);
      sendJson(res, { ok: true, saved: !!(r && r.ok) });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/review/reopen → 退回审题（selected/crafted → collected，撤销已锁定选题）
  //   编辑点「重新审题」时先调它：状态先回到 collected，再跑 R1；其余状态后端会跳过（skipped=true）
  if (path === "/api/run/review/reopen" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const body = await readBody(req);
    const id = (body && body.id) || null;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    try {
      const r = await apiWithToken(cred.env, cred.token, "/v1/editor/submissions/" + id + "/reopen", { method: "POST", body: {} });
      productionCache.delete(cred.env + ":" + id);
      sendJson(res, { ok: true, status: (r && r.status) || "collected", skipped: false });
    } catch (err) {
      const msg = String((err && err.message) || err);
      // 不该退回的状态（submitted/collected/published/rejected）：不是错误，告诉前端跳过
      if (msg.includes("invalid_state") || msg.includes("409")) { sendJson(res, { ok: true, status: null, skipped: true }); return; }
      sendJson(res, { ok: false, error: msg });
    }
    return;
  }

  // POST /api/run/review/save → 采纳审核结果入库（submissions.review jsonb；不改状态——拒稿/继续创作由编辑动作决定）
  if (path === "/api/run/review/save" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    const review = (body && body.review && typeof body.review === "object") ? body.review : null;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    if (!review) { sendJson(res, { ok: false, error: "无审核结果（review）" }, 400); return; }
    try {
      const r = await apiWithToken(e, token, "/v1/editor/submissions/" + id + "/review", { method: "PUT", body: { review } });
      sendJson(res, { ok: true, id, saved: !!(r && r.ok) });
    } catch (err) {
      console.error("[review/save]", JSON.stringify({ env: e, id, error: String((err && err.message) || err) }));
      sendJson(res, { ok: false, error: "[env:" + e + "|id:" + id + "] " + String((err && err.message) || err) });
    }
    return;
  }

  // POST /api/run/polish → 语感打磨（批量，llm-box 契约）：body {id, scriptIndex, messages?, config?, preview?}
  //   读 R2 scripts[scriptIndex] → 渲染 r3-polish（scope=all）→ LLM → 结果 segments 写回 R2
  if (path === "/api/run/polish" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    const scriptIndex = (body && body.scriptIndex !== undefined) ? Number(body.scriptIndex) : 0;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    try {
      // 打磨输入：优先前端工作副本（body.scripts，定稿前不落 R2）；无则 R2 权威
      let detail = null;
      try { detail = await apiWithToken(e, token, "/v1/editor/submissions/" + id).catch(() => null); } catch {}
      // **输入只能来自前端**（脚本编辑区里那一份最新的 segments）。
      // 以前拿不到 body.scripts 就回退服务端副本 —— 那会磨到"别的地方的内容"（陈旧/不是编辑在看的那份），已禁止。
      if (!Array.isArray(body.scripts) || !body.scripts.length) {
        sendJson(res, { ok: false, error: "打磨输入缺失：必须由前端把脚本编辑区里最新的 scripts 一起传过来（不回退服务端副本）" }, 400);
        return;
      }
      const scripts = body.scripts;
      const target = scripts[scriptIndex];
      if (!target || !Array.isArray(target.segments)) { sendJson(res, { ok: false, error: "脚本不存在（index " + scriptIndex + "）" }, 404); return; }
      const p = getPrompt("r3-polish");
      // 只注入分层脚本（壳 + 主体，含 source 标注）。
      // 不注入原文、方向、钥匙：打磨只改"怎么说"——内容关口在 R2，钥匙就在收尾那句台词里。
      // 修改意见走 withRevision 追加消息，不占模板占位符。
      const defaultMsgs = renderPrompt(p, { scripts: JSON.stringify(polishInputView(target), null, 1) });
      const cfgOverride = {};
      if (body && Array.isArray(body.messages) && body.messages.length) {
        const cfg = (body && body.config) || {};
        if (cfg.temperature !== undefined && cfg.temperature !== "") cfgOverride.temperature = Number(cfg.temperature);
        if (cfg.seed !== undefined && cfg.seed !== "") cfgOverride.seed = Number(cfg.seed);
        if (cfg.maxTokens !== undefined && cfg.maxTokens !== "") cfgOverride.maxTokens = Number(cfg.maxTokens);
        if (cfg.thinking !== undefined) cfgOverride.thinking = cfg.thinking;
      }
      if (body && body.preview) {
        sendJson(res, { ok: true, apiBody: previewApiBody("r3-polish", defaultMsgs), preview: { messages: defaultMsgs, config: p.config || {}, name: p.name || "r3-polish", description: p.description || "" } });
        return;
      }
      const msgs = (body && Array.isArray(body.messages) && body.messages.length) ? body.messages : defaultMsgs;
      const r = await llmComplete(null, null, cfgOverride, withRevision(msgs, (body && body.revision) || ""), p.config);
      let parsed = extractJson(r.content);
      let segs = Array.isArray(parsed) ? parsed : (parsed.segments || null);   // 模型返回的就是全部台词（不再需要拼壳）
      // 结果：只把打磨结果**回传**给控制台，服务端**绝不写 R2**。
      // 脚本的提交点只有一个：「确认生成语音」（merge.js 把本地终稿 PUT 到 R2 scripts）。
      if (!Array.isArray(segs)) { sendJson(res, { ok: false, error: "打磨结果缺少 segments 数组" }); return; }
      // 只留 segments：design/turns/hostOpen… 是 R2 出稿时的形态，
      // 编辑之后就过期了，带出来只会让人看到"20 个回合"这种对不上的旧话。
      const polished = { segments: segs };
      sendJson(res, { ok: true, local: true, result: polished, usage: fmtUsage(r.usage) });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/compare → 同批对比评审（跨投稿的"绝对分"）：body { ids:[2–3 个投稿 id], file?, preview? }
  //   为什么要有它：逐篇独立打分拿不到跨篇可比的分——模型每读一篇就自己重新校准一次（实测浅稿 52–78 / 正稿 82 完全重叠）。
  //   把 2–3 篇放进**同一次调用**里评，模型天然共用一把尺子 → 跨篇可比由构造保证。
  //   提示词文件默认用字典里 r1-review 的 user 文件；可用 file 覆盖（用来试 proposal.user.2.md 而**不改** prompts.json）。
  if (path === "/api/run/compare" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const body = await readBody(req);
    const ids = Array.isArray(body && body.ids) ? body.ids.filter((x) => typeof x === "string" && x) : [];
    if (ids.length < 2 || ids.length > 3) { sendJson(res, { ok: false, error: "需 2–3 个投稿 id" }, 400); return; }
    try {
      const p = getPrompt("r1-review");
      const dictUserFile = ((p.messages.find((m) => m.role === "user") || {}).file) || "";
      const userFile = (body && typeof body.file === "string" && body.file) ? body.file : dictUserFile;
      const userMsg = userFile === dictUserFile
        ? String(((p.messages.find((m) => m.role === "user") || {}).content) || "")
        : readFileSync(join(here, "prompts", userFile), "utf8");
      const LABELS = ["A", "B", "C"];
      const FENCE = String.fromCharCode(96).repeat(3);
      const parts = [];
      const meta = [];
      for (let i = 0; i < ids.length; i++) {
        const dlg = await loadDialogue(cred.env, cred.token, ids[i]);
        if (!dlg) { sendJson(res, { ok: false, error: "投稿 " + ids[i] + " 未采集——请先采集对话" }, 400); return; }
        const fo = foldPastedArtifacts(dlg);
        const dlgBlock = dialogueBlockFor(fo.dialogue, "Human", "AI", null);
        const lang = contentLanguageOf(fo.dialogue);
        const tur = ((fo.dialogue && fo.dialogue.messages) || []).length;
        parts.push("## Submission " + LABELS[i] + "  (id: " + ids[i] + ")\n\nLanguage: " + lang + " · turns: " + tur
          + (fo.folded.length ? " · folded pasted artifacts: " + fo.folded.length : "")
          + "\n\n" + FENCE + "text\n" + dlgBlock + "\n" + FENCE);
        meta.push({ ref: LABELS[i], id: ids[i], turns: tur, chars: dlgBlock.length, language: lang, folded: fo.folded.length });
      }
      const system = "# INPUT — batch comparison\n\n" + parts.join("\n\n---\n\n");
      const batchTask = [
        "", "", "---", "", "# APPENDED TASK — BATCH COMPARISON", "",
        "You are given " + ids.length + " different submissions, labelled " + LABELS.slice(0, ids.length).join(", ") + ".",
        "",
        "Score them **against each other, in this single pass**. The point of this task is cross-submission comparability:",
        "all scores must live on the same scale, so that a gap of N points means the same thing everywhere in this list.",
        "",
        "For each submission:",
        "",
        "1. pick its single strongest Thinking Scene (ignore the rest),",
        "2. score that scene on the six dimensions of §14 using the same anchors, and compute the total out of 100,",
        "3. label the scene type (§7), whether the thinking is private or public (§5), and state its Perspective in one sentence (§13),",
        "4. give the single strongest reason it is *not* better than the submission ranked above it.",
        "",
        "Then rank the submissions from strongest to weakest and justify the gaps — especially the borderline ones.",
        "Do not spread the scores artificially, and do not compress them: if they are genuinely close, say so with close scores.",
        "",
        "Return JSON only:",
        "",
        FENCE + "json",
        "{",
        "  \"submissions\": [",
        "    { \"ref\": \"A\", \"id\": \"...\", \"score\": 0, \"band\": \"strong|promising|borderline|weak\",",
        "      \"dims\": { \"cognitive_delta\": 0, \"thinking_depth\": 0, \"tension_stakes\": 0, \"perspective_potential\": 0, \"surprise\": 0, \"source_integrity\": 0 },",
        "      \"scene_type\": \"decision|creation|understanding|reframing|reflection\",",
        "      \"public_or_private\": \"public|private\", \"perspective\": \"...\",",
        "      \"strongest_reason\": \"...\", \"why_not_above_next\": \"...\" }",
        "  ],",
        "  \"ranking\": [\"A\", \"B\"], \"gap_notes\": \"...\", \"confidence\": 0.0",
        "}",
        FENCE,
      ].join("\n");
      const cmpMsgs = [{ role: "system", content: system }, { role: "user", content: userMsg + batchTask }];
      if (body && body.preview) { sendJson(res, { ok: true, preview: { messages: cmpMsgs, ids: ids, meta: meta } }); return; }
      const r = await llmComplete(null, null, {}, cmpMsgs, Object.assign({}, p.config, { maxTokens: 32768 }), null);
      const parsed = extractJson(r.content);
      console.log("[compare] n=" + ids.length + " | input " + ((r.usage && r.usage.prompt_tokens) || "?") + " tok | ranking=" + JSON.stringify(parsed && parsed.ranking));
      sendJson(res, { ok: true, result: parsed, meta: meta, usage: fmtUsage(r.usage) });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/publish → 发布元信息：script + meta 提示词（写 production.json.metadata）
  if (path === "/api/run/publish" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    try {
      // 原则①：meta 工作流输入从 store 取（前端随请求带 review + script）；回退 R2 reviewScripts
      const inScript = (body && body.script && typeof body.script === "object") ? body.script : null;
      const inSel = (body && body.review && typeof body.review === "object") ? body.review : ((body && body.selection && typeof body.selection === "object") ? body.selection : null);
      let script = inScript;
      if (!script) {
        const detail = await apiWithToken(e, token, "/v1/editor/submissions/" + id).catch(() => null);
        const rs = (detail && Array.isArray(detail.reviewScripts)) ? detail.reviewScripts : [];
        script = rs[0] || null;
      }
      if (!script || !Array.isArray(script.segments)) { sendJson(res, { ok: false, error: "尚无脚本——先执行创作" }); return; }
      // preview 模式：返回渲染后的 messages+config（llm-box 填入可编辑输入框），不执行
      if (body && body.preview) {
        const p = getPrompt("r4-meta");
        const msgs = renderPrompt(p, {
          episode: JSON.stringify(script.episode || {}, null, 1),
          production: JSON.stringify(script.production || {}, null, 1),
          script: JSON.stringify(Array.isArray(script.segments) ? script.segments : (Array.isArray(script.script) ? script.script : []), null, 1),
        });
        sendJson(res, { ok: true, apiBody: previewApiBody("r4-meta", msgs), preview: { messages: msgs, config: p.config || {}, name: p.name || "r4-meta", description: p.description || "" } });
        return;
      }
      // llm-box 契约：body.messages/config 覆盖（预览可编辑后传回）；否则字典默认渲染
      let msgs, cfgOverride = {};
      if (body && Array.isArray(body.messages) && body.messages.length) {
        msgs = body.messages;
        const cfg = (body && body.config) || {};
        if (cfg.temperature !== undefined && cfg.temperature !== "") cfgOverride.temperature = Number(cfg.temperature);
        if (cfg.seed !== undefined && cfg.seed !== "") cfgOverride.seed = Number(cfg.seed);
        if (cfg.maxTokens !== undefined && cfg.maxTokens !== "") cfgOverride.maxTokens = Number(cfg.maxTokens);
        if (cfg.thinking !== undefined) cfgOverride.thinking = cfg.thinking;
      } else {
        const p = getPrompt("r4-meta");
        msgs = renderPrompt(p, {
          episode: JSON.stringify(script.episode || {}, null, 1),
          production: JSON.stringify(script.production || {}, null, 1),
          script: JSON.stringify(Array.isArray(script.segments) ? script.segments : (Array.isArray(script.script) ? script.script : []), null, 1),
        });
      }
      const r = await llmComplete(null, null, cfgOverride, withRevision(msgs, (body && body.revision) || ""), getPrompt("r4-meta").config);
      const parsed = extractJson(r.content);
      // 自动填充：只生成 meta 返回（表单回填），不写 production
      if (body && body.fillOnly) {
        sendJson(res, { ok: true, fillOnly: true, result: parsed, usage: fmtUsage(r.usage) });
        return;
      }
      await saveProduction(e, token, id, { metadata: parsed, progress: { step: "publish", updatedAt: new Date().toISOString() } })
        .catch((err) => { console.warn("[publish] meta 落盘失败（不毁掉本次结果）:", String((err && err.message) || err)); });;
      sendJson(res, {
        ok: true, message: "发布元信息生成完成", result: parsed,
        usage: fmtUsage(r.usage),
      });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/publish-submit?id= → 发布（multipart：cover 文件 + meta JSON 含 audioKey）
  //   转发服务端 /v1/editor/submissions/:id/publish（audio 复用 R2 full/{id}.m4a，免重新上传）
  if (path.split("?")[0] === "/api/run/publish-submit" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const qs = new URL(path, "http://x").searchParams;
    const id = qs.get("id");
    if (!id) { sendJson(res, { ok: false, error: "需 id（query）" }, 400); return; }
    const chunks = [];
    let psize = 0;
    for await (const c2 of req) { chunks.push(c2); psize += c2.length; if (psize > 30 * 1024 * 1024) { sendJson(res, { ok: false, error: "数据过大（>30MB）" }, 413); return; } }
    const rawBody = Buffer.concat(chunks);
    const contentType = req.headers["content-type"] || "";
    try {
      const cfg = await configFor(e);
      const lib = await loadCliLib();
      const headers = { "x-lab-env": e, "content-type": contentType };
      const cookie = getCookieSession(e);
      if (cookie) headers["cookie"] = cookie;
      else if (token) headers["authorization"] = "Bearer " + token;
      const up = await lib.apiFetch(cfg.apiBase + "/v1/editor/submissions/" + encodeURIComponent(id) + "/publish", { method: "POST", headers, body: rawBody });
      if (!up.ok) {
        const txt = await up.text().catch(() => "");
        throw new Error(up.status + ": " + txt.slice(0, 200));
      }
      const d = await up.json().catch(() => ({}));
      sendJson(res, { ok: true, episodeId: d.episodeId || null, slug: d.slug || null, number: d.number || null });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // GET /api/overview → 环境 + 计数
  if (path === "/api/overview") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const [submissions, episodes] = await Promise.all([
      apiWithToken(e, token, "/v1/editor/submissions").catch(() => []),
      apiWithToken(e, token, "/v1/editor/episodes").catch(() => []),
    ]);
    let userEmail = "";
    try {
      const me = await apiWithToken(e, token, "/v1/me/profile");
      userEmail = (me && (me.email || me.username)) || "";
    } catch { /* 非关键 */ }
    // profile 缺失（404）时回退到投稿列表中的邮箱
    if (!userEmail && submissions.length && submissions[0].userEmail) userEmail = submissions[0].userEmail;
    sendJson(res, { ok: true, env: e, userEmail, submissions: submissions.length, episodes: episodes.length });
    return;
  }

  // GET /api/queue?status=submitted|published|rejected|all → 投稿队列（默认 submitted）
  if (path === "/api/queue" || path.startsWith("/api/queue?")) {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const qs = new URL(path, "http://x").searchParams.get("status") || "submitted";
    const url = qs === "all" ? "/v1/editor/submissions?status=published" : "/v1/editor/submissions" + (qs === "submitted" ? "" : "?status=" + qs);
    const q = await apiWithToken(e, token, url);
    sendJson(res, { ok: true, status: qs, queue: q });
    return;
  }

  // GET /api/detail/<id> → 投稿详情 + 草稿状态
  const m = path.match(/^\/api\/detail\/([0-9a-f-]+)$/);
  if (m) {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const lib = await loadCliLib();
    const id = m[1];
    let detail;
    try {
      detail = await apiWithToken(e, token, "/v1/editor/submissions/" + id);
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (msg.includes("404") || msg.includes("not_found")) {
        sendJson(res, { ok: false, error: "投稿不存在（可能已删除，或环境不对）" }, 404);
        return;
      }
      throw err;
    }
    // 审核决策从服务端 detail 派生（不依赖 review_status——通过时为空；由 status + 脚本数据驱动）
    const draftFiles = [];
    const reviewScripts = (detail && detail.reviewScripts) || null;
    const prodSummary = detail ? {
      hasSelection: true,
      reviewStatus: (detail && detail.reviewStatus) || null,
      reviewScore: (detail && detail.reviewScore) ?? null,
      rejection: (detail && detail.rejectedReason) || null,
      scriptList: detail.status === 'rejected' ? [] : (Array.isArray(reviewScripts) ? reviewScripts : []),
    } : null;
    // 对话随详情一次返回（本地工作副本，毫秒级）——前端直接渲染，不再单独请求 /api/draft
    const dialogue = await loadDialogue(e, token, id);
    // 站点基址（前端拼绝对节目 URL：siteUrl + /episode/{slug}）
    const cfg = await configFor(e).catch(() => null);
    // lab 侧生产数据（R2 workflows/{env}/{id}.json）：审题结果等——前端判断状态只认服务端，不认浏览器缓存
    const production = await loadProduction(e, token, id).catch(() => null);
    sendJson(res, {
      ok: true, id, detail, draftFiles, progress: null, prodSummary, dialogue, production,
      siteUrl: (cfg && cfg.siteUrl) || "",
    });
    return;
  }

  // POST /api/audio/guest-voice → 上传嘉宾声线（multipart 转发服务端 guests/:id/voice-sample）
  //   body: FormData { audio: file, language, transcript }; guestId 从 query 取（path 含 query）
  if (path.split("?")[0] === "/api/audio/guest-voice" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    // 读原始请求体（multipart）
    const chunks = [];
    let size = 0;
    for await (const c2 of req) { chunks.push(c2); size += c2.length; if (size > 25 * 1024 * 1024) { sendJson(res, { ok: false, error: "文件过大（>25MB）" }, 413); return; } }
    const rawBody = Buffer.concat(chunks);
    const contentType = req.headers["content-type"] || "";
    const qs = new URL(path, "http://x").searchParams;
    const guestId = qs.get("guestId");
    if (!guestId) { sendJson(res, { ok: false, error: "需 guestId" }, 400); return; }
    try {
      const cfg = await configFor(e);
      const lib = await loadCliLib();
      const headers = { "x-lab-env": e, "content-type": contentType };
      const cookie = getCookieSession(e);
      if (cookie) headers["cookie"] = cookie;
      else if (token) headers["authorization"] = "Bearer " + token;
      const up = await lib.apiFetch(cfg.apiBase + "/v1/editor/guests/" + encodeURIComponent(guestId) + "/voice-sample", {
        method: "POST", headers, body: rawBody,
      });
      const txt = await up.text().catch(() => "");
      let d = null; try { d = JSON.parse(txt); } catch {}
      if (!up.ok) { sendJson(res, { ok: false, error: (d && d.error) || ("上传失败 " + up.status + ": " + txt.slice(0, 150)) }, 502); return; }
      sendJson(res, { ok: true, message: "嘉宾声线已保存", guestId });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // GET /api/guest-voices?guestId= → 该嘉宾**已配置声线的语种清单**（声线管理弹窗展示"缺哪个语种"）
  //   注：必须注册在下面的通用 /api/audio/ 之前（那个分支不判 method）
  if (path.split("?")[0] === "/api/guest-voices" && req.method === "GET") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const guestId = new URL(path, "http://x").searchParams.get("guestId");
    const all = await apiWithToken(e, token, "/v1/editor/guests/voice-samples").catch(() => []);
    const samples = (Array.isArray(all) ? all : [])
      .filter((x) => !guestId || x.guestId === guestId)
      .map((x) => ({ guestId: x.guestId, language: x.language, transcript: x.transcript || null }));
    sendJson(res, { ok: true, samples });
    return;
  }

  // GET /api/audio/host?userId=&lang= → 主持人采样音频（转发服务端 samples/host/:userId/audio）
  // GET /api/audio/guest?platform=&lang= → 嘉宾声线音频（转发服务端 samples/guest/:guestId/audio）
  //   lang：取该语种那条（多语种时避免"播出来的语种和你看到的不是同一条"）；缺省/该语种不存在 → 服务端回退
  // 参数均来自投稿数据（detail.userId / detail.guest.id）；服务端读 R2 返回音频流
  if (path.startsWith("/api/audio/")) {
    // audio 标签无法带 X-Lab-Env 头——env 从 query 取，会话用服务端 cookie/token
    const qs = new URL(path, "http://x").searchParams;
    const env = qs.get("env") || req.headers["x-lab-env"] || null;
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    const hasCookie = env ? !!getCookieSession(env) : false;
    if (!env || (!hasCookie && !token)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const kind = path.replace("/api/audio/", "").split("?")[0];
    try {
      let fwd;
      const lang = qs.get("lang") || "";
      const langQ = /^[a-z]{2,3}$/i.test(lang) ? "?language=" + encodeURIComponent(lang.toLowerCase()) : "";
      if (kind === "host") {
        const userId = qs.get("userId");
        if (!userId) { sendJson(res, { ok: false, error: "需 userId" }, 400); return; }
        fwd = "/v1/editor/samples/host/" + encodeURIComponent(userId) + "/audio" + langQ;
      } else if (kind === "guest") {
        const platform = qs.get("platform");
        if (!platform) { sendJson(res, { ok: false, error: "需 platform" }, 400); return; }
        fwd = "/v1/editor/samples/guest/" + encodeURIComponent(platform) + "/audio" + langQ;
      } else if (kind === "full") {
        const fid = qs.get("id");
        if (!fid) { sendJson(res, { ok: false, error: "需 id" }, 400); return; }
        // 新流程：创作音频在最终位置 episodes/{userId}/{id}.m4a（合成确认写入）；旧 full/ 由转发处回退
        fwd = "/v1/editor/submissions/" + encodeURIComponent(fid) + "/audio";
      } else if (kind === "episode") {
        // 已发布节目的公开音频（episodes/{userId}/{submissionId}.{ext}——发布后成品，published 预览用）
        const eid = qs.get("episodeId");
        if (!eid) { sendJson(res, { ok: false, error: "需 episodeId" }, 400); return; }
        fwd = "/v1/public/episodes/" + encodeURIComponent(eid) + "/audio";
      } else { sendJson(res, { ok: false, error: "未知音频类型" }, 400); return; }
      const cfg = await configFor(env);
      const lib = await loadCliLib();
      const headers = { "x-lab-env": env };
      const cookie = getCookieSession(env);
      if (cookie) headers["cookie"] = cookie;
      else if (token) headers["authorization"] = "Bearer " + token;
      else throw new Error("未登录");
      let up = await lib.apiFetch(cfg.apiBase + fwd, { method: "GET", headers });
      if (!up.ok && kind === "full") {
        // 旧流程投稿无 episodes/ 产物 → 回退 full/{id}.m4a
        up = await lib.apiFetch(cfg.apiBase + "/v1/editor/full/" + encodeURIComponent(qs.get("id")) + "/audio", { method: "GET", headers });
      }
      if (!up.ok) { sendJson(res, { ok: false, error: "音频获取失败 " + up.status }, 502); return; }
      const buf = Buffer.from(await up.arrayBuffer());
      const ctype = up.headers.get("content-type") || (kind === "host" ? "audio/webm" : "audio/mpeg");
      res.writeHead(200, { "content-type": ctype, "cache-control": "private, max-age=300" });
      res.end(buf);
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // GET /api/prompts/list → 工程提示词字典文件清单（只读展示；编辑在 VSCode，lab 热更新）
  if (path === "/api/prompts/list") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    try {
      const { listPrompts } = await import("./lib/prompt.mjs");
      sendJson(res, { ok: true, files: listPrompts() });
    } catch (e) { sendJson(res, { ok: false, error: String((e && e.message) || e) }); }
    return;
  }

  // GET /api/r2title/<id> → 投稿卡片标题：从 R2 对话 JSON 取 title（缓存化，不依赖本地）
  const rt = path.match(/^\/api\/r2title\/([0-9a-f-]+)$/);
  if (rt) {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const id = rt[1];
    const d = await loadDialogue(e, token, id);
    sendJson(res, { ok: true, title: (d && d.title) || null });
    return;
  }

  // GET /api/draft/<id>/dialogue.json → 对话预览（缓存化：从 R2 读）；其他草稿文件不再提供（已 R2 化）
  const dm = path.match(/^\/api\/draft\/([0-9a-f-]+)\/([\w.-]+)$/);
  if (dm) {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    if (dm[2] !== "dialogue.json") { sendJson(res, { ok: false, error: "该草稿文件已缓存化，不再从本地提供" }, 404); return; }
    const d = await loadDialogue(e, token, dm[1]);
    if (!d) { sendJson(res, { ok: false, error: "对话不存在（未采集或 R2 无备份）" }, 404); return; }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(d));
    return;
  }

  sendJson(res, { ok: false, error: "未知端点: " + path }, 404);
}

// 防护：CLI 模块内部可能 process.exit（如 loadConfig 对非法参数）——server 里转为错误而非退出
const origExit = process.exit;
process.exit = ((code) => {
  console.error("[server] 拦截 process.exit(" + code + ")——CLI 模块不应直接退出，继续运行");
}) ;

const server = createServer((req, res) => {
  const host = req.headers.host || "";
  if (!host.startsWith("127.0.0.1") && !host.startsWith("localhost")) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  const url = new URL(req.url, "http://" + host);
  if (url.pathname.startsWith("/api/")) {
    handleApi(url.pathname + url.search, res, req).catch((e) => {
      console.error("[server] handleApi 异常:", e);
      sendJson(res, { ok: false, error: String((e && e.message) || e) }, 500);
    });
  } else {
    serveStatic(url.pathname, res);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("════════ dailog lab ════════");
  console.log("  地址: http://127.0.0.1:" + port);
  if (activeEnv()) console.log("  环境: " + activeEnv() + "（登录态有效时直进控制台）");
  else console.log("  未指定环境/未登录——打开页面走登录流程");
});

