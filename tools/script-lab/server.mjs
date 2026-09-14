#!/usr/bin/env node
// script-lab web 层：投稿列表 + 分步采编发布控制台
//   采集（原始对话内容）已自包含：lib/collect.mjs（不依赖 CLI）；TTS 合成/环境配置等仍复用 CLI 底座（迁移中）
// 用法：node tools/script-lab/server.mjs [--port 4173] [--env dev]
// 安全：绑定 127.0.0.1 + Host 头校验（防 DNS rebinding）
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLlmConfig } from "./lib/config.mjs";
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

// ===== 提示词进化数据（feedback/review.jsonl）=====
const FB_DIR = join(process.env.LAB_STATE_DIR || here, "feedback");
const FB_FILE = join(FB_DIR, "review.jsonl");
const FB_SIG_FILES = ["prompts.json", "material.system.md", "r1-review.user.md", "r2-script.user.md"];

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
/** 提示词版本指纹（md mtime）——回溯"哪版规则产生了这个结果" */
function promptSig() {
  return FB_SIG_FILES
    .map((f) => { try { return statSync(join(here, "prompts", f)).mtimeMs; } catch { return 0; } })
    .join(":");
}
/** 追加一行反馈（不抛错） */
function appendFeedback(row) {
  try {
    mkdirSync(FB_DIR, { recursive: true });
    writeFileSync(FB_FILE, JSON.stringify(row) + "\n", { flag: "a" });
  } catch { /* 反馈落盘失败不阻塞主流程 */ }
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
function setReviewState(envName, id, phase, detail) {
  reviewState.set(envName + ":" + id, { phase, detail: detail || null, at: Date.now() });
}

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
async function r2Delete(envName, token, key) {
  await withTimeout(apiWithToken(envName, token, "/v1/editor/storage/delete", { method: "POST", body: { key } }), 30000, "R2 删除");
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

/** 已废弃：webui 登录态完全在浏览器 localStorage（请求头携带），不再读 CLI session.json */
async function envLoggedIn(name) { return false; }

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
    const rows = all.map((r) => {
      // 列表状态与详情页对齐：直接展示状态值（submitted/collected/crafted/published/rejected）
      const stage = r.status || "submitted";
      return {
        id: r.id, url: r.url, title: r.title, collected: r.collected, dialogueCount: r.dialogueCount,
        displayName: r.displayName || r.userEmail || "?", userEmail: r.userEmail,
        createdAt: r.createdAt, hasVoiceSample: r.hasVoiceSample, stage,
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
    // 未采集的投稿（服务端 collected !== 1 且不在 fetching）→ 异步逐个采集（并发 4）
    const pending = q.filter((row) => row.collected !== 1 && !fetchingSet.has(e + ":" + row.id));
    let idx = 0;
    const worker = async () => {
      while (idx < pending.length) {
        const row = pending[idx++];
        await runSingleFetch(e, token, row.id, row.url || null, row.title || null);
      }
    };
    // 异步启动，不等待（返回已入队数量；进度由 /api/status/fetch 轮询）
    Promise.all(Array.from({ length: Math.min(4, Math.max(pending.length, 1)) }, worker)).catch(() => {});
    sendJson(res, { ok: true, queued: pending.length, total: q.length });
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
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    if (!reason) { sendJson(res, { ok: false, error: "请填写拒稿原因" }, 400); return; }
    try {
      const r = await apiWithToken(e, token, "/v1/editor/submissions/" + id + "/reject", { method: "POST", body: { reason } });
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
      let ref;
      if (seg.speaker === "guest") {
        const samples = await apiWithToken(e, token, "/v1/editor/guests/voice-samples").catch(() => []);
        const guestId = (detail && detail.guest && detail.guest.id) || null;
        const mine = (Array.isArray(samples) ? samples : []).filter((x) => x.guestId === guestId);
        const row = mine.find((x) => x.language === "zh") || mine[0];
        if (!row || !row.audioKey) { sendJson(res, { ok: false, error: "嘉宾 " + (guestId || "?") + " 无声线（guest-voice 上传）" }); return; }
        const bytes = await apiFetchBytes(config, e, token, "/v1/editor/samples/guest/" + encodeURIComponent((detail && detail.guest && detail.guest.id) || "") + "/audio");
        ref = { audio: bytes, text: row.transcript || null };
      } else {
        const samples = (detail && detail.voiceSamples) || [];
        const sample = samples.find((x) => x.status === "ready") || samples[0];
        if (!sample || !sample.audioUrl) { sendJson(res, { ok: false, error: "主持人无声样" }); return; }
        const bytes = await apiFetchBytes(config, e, token, "/v1/editor/samples/host/" + encodeURIComponent((detail && detail.userId) || "") + "/audio");
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
function polishInputView(target) {
  return { segments: (target && Array.isArray(target.segments)) ? target.segments : [] };
}



/** R1 评审权重（**和为 10**）：模型只给三个维度分（各 0-10），总分由这里算——
 *  乘法和加总不交给模型（它会算错，而且权重一改就要重跑提示词）。
 *  改权重只改这一行；改完新出的提案自动按新权重重排，存量提案用的是当时存的 score。 */
const REVIEW_WEIGHTS = { "受众基础": 2, "立场共鸣度": 3, "思辨张力": 2, "钥匙的锐度": 3 };   // = 10
/** 按权重算总分（0-10）。缺维度的按现有维度归一化，不把总分压低。 */
function weightedScoreOf(proposal) {
  const dims = Array.isArray(proposal && proposal["score-detail"]) ? proposal["score-detail"] : [];
  let sum = 0, wsum = 0;
  for (const d of dims) {
    if (!d || typeof d !== "object") continue;
    const name = String(d.dimension || d.d || "").trim();
    const w = Number(REVIEW_WEIGHTS[name]);
    const s = Number(d.score != null ? d.score : d.s);
    if (!Number.isFinite(w) || !w || !Number.isFinite(s)) continue;
    d.weight = w;                       // 顺手把权重盖到卡上，编辑能看到"这个分是怎么来的"
    sum += s * w; wsum += w;
  }
  if (!wsum) return null;
  return Math.round((sum / wsum) * 10) / 10;   // 权重和为 10 → 总分与维度同刻度（0-10）
}

/** 听众钥匙（新字段名；「解题思路」是存量旧名） */
function proposalKeyOf(p) {
  if (!p || typeof p !== "object") return "";
  const v = p["钥匙"] || p["尖"] || p["听众钥匙"] || p["解题思路"];
  return (typeof v === "string") ? v.trim() : "";
}

/** 提案 → R2 能读的台阶文本。v7 契约：立场 → 思辨 → 钥匙。
 *  存量老提案（认知探索/探索结构）走下面的兜底分支，别让老卡片拿到空简报。 */
function structureTextOf(p, total) {
  if (!p || typeof p !== "object") return "";
  const cap = Number(total) > 0 ? Number(total) : null;
  const okN = (n) => Number.isInteger(n) && n >= 1 && (!cap || n <= cap);
  const one = (x) => (Array.isArray(x) ? x.map(Number).filter(okN) : (okN(Number(x)) ? [Number(x)] : []));
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const lines = [];
  const stance = str(p["立场"] || p["刺"] || p["认知探索"]);              // v7 立场；v6 旧名「刺」；v4 旧名「认知探索」
  const key = str(p["钥匙"] || p["尖"] || p["听众钥匙"] || p["解题思路"]);  // v7 钥匙；v6 旧名「尖」
  const topic = str(p["话题"]);
  const toward = str(p["对手"] || p["刺向"]);
  const flowRaw = p["思辨"] || p["思辨过程"];
  const flowTxt = (typeof flowRaw === "string") ? str(flowRaw)
    : (flowRaw && typeof flowRaw === "object") ? [str(flowRaw["从"]), str(flowRaw["到"])].filter(Boolean).join(" → ") : "";
  if (stance) lines.push("· 立场（他开口带的那个立场）：「" + stance + "」");
  if (key) lines.push("· 钥匙（听众要带走的那一句）：「" + key + "」" + (toward ? "　— 对手：" + toward : ""));
  if (topic) lines.push("· 话题：" + topic);
  if (flowTxt) lines.push("· 思辨（这一期要走的台阶，按顺序走、不许重排）：" + flowTxt);
  if (lines.length) return lines.join("\n");
  // ↓ 存量提案兜底（v4 及更早：认知探索 + 探索结构）
  const oldLine = str(p["认知探索"]);
  if (oldLine) lines.push("· 立场（他站在哪个位置看这件事）：" + oldLine);
  const st = (typeof p["探索结构"] === "object" && p["探索结构"]) ? p["探索结构"] : null;
  if (!st) return lines.join("\n");
  const fmt = (v) => {
    if (!Array.isArray(v) || !v.length) return "";
    // 起点/终点是一个问答组（平铺编号）；过程是多组（数组的数组）
    if (v.every((x) => !Array.isArray(x))) return one(v).map((n) => "t" + n).join("、");
    return v.map((x) => one(x).map((n) => "t" + n).join("、")).filter(Boolean).join(" ／ ");
  };
  const start = fmt(st["起点问答"]), mid = fmt(st["过程问答"]), end = fmt(st["终点问答"]);
  if (start) lines.push("· 起点问答：" + start + "（他问什么、AI 怎么答）");
  if (mid) lines.push("· 过程问答（一组一组按顺序走）：" + mid);
  if (end) lines.push("· 终点问答：" + end + "（他最后落到哪）");
  return lines.join("\n");
}

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

/** 取脚本的「六字段」（回灌成 assistant 消息用）：segments 是派生的，不回灌；
 *  老数据没有 turns 时，从 segments 反推（前两段=壳头，后三段=壳尾，中间按 host/guest 成对）。 */
function sixFieldsOf(sc) {
  if (!sc || typeof sc !== "object") return {};
  // **segments 是唯一真相**：卡片显示、编辑、打磨、TTS 改的都是它；
  // 六字段（hostOpen/turns/…）是 R2 出稿时的形态，编辑之后就不再同步了——
  // 所以只要 segments 在，就一律从它现算，避免把陈旧版本回灌给模型（曾经踩过）。
  const hasSegs = Array.isArray(sc.segments) && sc.segments.length > 0;
  const out = {
    design: sc.design || "",
    hostOpen: hasSegs ? "" : (sc.hostOpen || ""),
    guestOpen: hasSegs ? "" : (sc.guestOpen || ""),
    turns: hasSegs ? [] : (Array.isArray(sc.turns) ? sc.turns : []),
    hostWrap: hasSegs ? "" : (sc.hostWrap || ""),
    guestSum: hasSegs ? "" : (sc.guestSum || ""),
    hostOutro: hasSegs ? "" : (sc.hostOutro || ""),
  };
  if (hasSegs) {
    const segs = sc.segments;
    const t = (i) => (segs[i] && segs[i].text) || "";
    out.hostOpen = out.hostOpen || t(0);
    out.guestOpen = out.guestOpen || t(1);
    out.hostOutro = out.hostOutro || t(segs.length - 1);
    out.guestSum = out.guestSum || t(segs.length - 2);
    out.hostWrap = out.hostWrap || t(segs.length - 3);
    const body = segs.slice(2, Math.max(2, segs.length - 3));
    for (let i = 0; i + 1 < body.length; i += 2) {
      if (body[i] && body[i].speaker === "host" && body[i + 1] && body[i + 1].speaker === "guest") {
        out.turns.push({ ask: body[i].text, answer: body[i + 1].text });
      }
    }
  }
  return out;
}

/** 文本归一（去标记/标点/空白）——保真标注用 */
function normTxt2(s) {
  return String(s || '').toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** 最长公共子序列长度 */
function lcsLen(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return 0;
  const dp = new Array(m + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= n; i++) {
    let prev = 0;
    for (let j = 1; j <= m; j++) {
      const cur = dp[j];
      if (a[i - 1] === b[j - 1]) { dp[j] = prev + 1; if (dp[j] > best) best = dp[j]; } else dp[j] = 0;
      prev = cur;
    }
  }
  return best;
}

/** 原话保真标注（编辑选稿依据，确定性、无 LLM）：host 段 → original（原话）/ rewrite（改写）/ new（接话） */
function labelScripts(scripts, dialogue) {
  const dlgUsers = (dialogue && Array.isArray(dialogue.messages) ? dialogue.messages : []).map((m, mi) => ({ mi, t: normTxt2(m && m.content) }));
  (Array.isArray(scripts) ? scripts : []).forEach((sc) => {
    if (!sc || !Array.isArray(sc.segments)) return;
    let hostOriginal = 0, hostRewrite = 0, hostNew = 0;
    sc.segments.forEach((seg) => {
      if (!seg || seg.speaker !== 'host') return;
      const t = normTxt2(seg.text);
      if (!t) { seg.src = 'new'; seg.origRatio = 0; hostNew++; return; }
      let best = null;
      dlgUsers.forEach((u) => {
        if (!u.t) return;
        const len = lcsLen(t, u.t);
        const cov = len / t.length;
        if (!best || cov > best.cov || (cov === best.cov && len > best.len)) best = { cov, len, mi: u.mi };
      });
      const cov = best ? best.cov : 0;
      let src = 'new';
      if (best && best.len >= 6 && cov >= 0.9) src = 'original';
      else if (best && best.len >= 4 && cov >= 0.5) src = 'rewrite';
      seg.src = src;
      if (best) seg.fromTurn = best.mi;
      seg.origRatio = Math.round(cov * 100);
      if (src === 'original') hostOriginal++; else if (src === 'rewrite') hostRewrite++; else hostNew++;
    });
    const contentTotal = hostOriginal + hostRewrite;
    sc.fidelity = { hostOriginal, hostRewrite, hostNew, contentTotal, originalRate: contentTotal ? Math.round((hostOriginal / contentTotal) * 100) : 0 };
  });
}

/** R1 → R2 的唯一输入：一句话创作指引（起点 → 走向 → 终点）。
 *  存量老提案没有这个字段时，用它的结论拼一句话兜底，保证过渡期 R2 仍有方向可用。 */
function directionOf(proposal) {
  if (!proposal || typeof proposal !== "object") return "（无指引——按素材里投稿人自己的探索方向走）";
  const d = proposal["创作意见"] || proposal["创作建议"] || proposal["创作指引"] || proposal.direction;
  if (typeof d === "string" && d.trim()) return d.trim();
  const bits = [];
  if (proposal.value) bits.push(String(proposal.value));
  const steps = (Array.isArray(proposal.process) ? proposal.process : []).filter((p) => p && p.step).map((p) => String(p.step));
  if (steps.length) bits.push("中间依次走到：" + steps.join("、"));
  if (proposal.solve) bits.push("最后落到「" + String(proposal.solve) + "」");
  return bits.length ? bits.join("；") : "（无指引——按素材里投稿人自己的探索方向走）";
}

/** R1 → 编辑/文案：选题说明（新契约；老提案按字段兜底） */
function briefOf(proposal) {
  if (!proposal || typeof proposal !== "object") return null;
  const b = proposal["选题说明"];
  if (b && typeof b === "object") return b;
  if (typeof b === "string") return b;
  // 卡片字段在提案顶层。v7 = 立场/钥匙/话题/思辨/创作意见；旧名一起认。
  const keyOf = (p) => p["钥匙"] || p["尖"] || p["听众钥匙"] || p["解题思路"] || null;
  const stanceOf = (p) => p["立场"] || p["刺"] || p["认知探索"] || null;
  const dirOf = (p) => p["创作意见"] || p["创作建议"] || p["创作指引"] || null;
  if (stanceOf(proposal) || proposal["目标听众"] || keyOf(proposal) || dirOf(proposal)) {
    const out = {
      对话总结: proposal["对话总结"] || null,
      立场: stanceOf(proposal),
      钥匙: keyOf(proposal),
      话题: proposal["话题"] || null,
      思辨: proposal["思辨"] || null,
      覆盖turns: Array.isArray(proposal["覆盖turns"]) ? proposal["覆盖turns"] : null,
      受众: proposal["目标听众"] || null,
      创作意见: dirOf(proposal),
    };
    // 旧名只在对应新字段缺失时补（给还在读旧名的老模板兜底）——
    // 否则简报里同一件事会出现两个名字，模型会当成两个字段各自脑补。
    if (!out.立场) out.认知探索 = stanceOf(proposal);
    if (!out.钥匙) { out.听众钥匙 = keyOf(proposal); out.解题思路 = keyOf(proposal); }
    if (!out.创作意见) out.创作建议 = dirOf(proposal);
    return out;
  }
  return { 切片: proposal.carrier || proposal.topic || null, 为什么值得做: proposal.value || null, 受众: proposal.who || null, 禁区: proposal.avoid || [] };
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

/** 提案结构归一化（旧审题契约 → 新收敛契约）：兼容历史已选提案（main_topic/confusion/storyline.beats/event...）渲染新提示词模板
 *  新契约：{ topic, chain:[{question,turns}], storyline(一句话), takeaway }
 *  旧结构转换：topic=main_topic；chain 由旧节型链（confusion/pursuit/reframe/event 含 turns+quote）折成 user 问题序列——取 user 节的原话为 question，
 *  非 user 节并入前一问的 turns（AI 回合是素材，不进问题本身）；storyline=storyline.topic 的人话（去外壳）或 storyline.event；takeaway=storyline.takeaway。 */
function normalizeProposal(proposal) {
  if (!proposal || typeof proposal !== "object") return proposal;
  // 新契约（v7）：{ 立场, 钥匙, 话题, 思辨, 覆盖turns, 目标听众, 创作意见, score-detail } —— 原样直通
  if (proposal["创作意见"] || proposal["立场"] || proposal["钥匙"] || proposal["创作建议"] || proposal["创作指引"] || proposal["选题说明"] || proposal.direction) return proposal;
  // draft 契约（R1 判别先行版）：who/value/carrier/endpoint/solve/process —— 原样直通，另补 lab 消费的等价字段
  const isDraft = ("who" in proposal) || ("value" in proposal) || ("solve" in proposal) || (Array.isArray(proposal.process) && proposal.process.length > 0);
  if (isDraft) {
    const copy = Object.assign({}, proposal);
    if (!copy.topic) copy.topic = copy.carrier || copy.who || null;
    if (!copy.takeaway) copy.takeaway = copy.solve || null;
    if (!copy.storyline) copy.storyline = copy.value || null;
    if (!Array.isArray(copy.chain)) {
      copy.chain = (Array.isArray(proposal.process) ? proposal.process : []).map(function (x) {
        return {
          type: "ask",
          text: (x && (x.quote || x.step)) || "",
          step: (x && x.step) || "",
          turns: Array.isArray(x && x.turns) ? x.turns.slice() : [],
        };
      });
    }
    if (typeof copy.chainText !== "string" && copy.chain.length) {
      copy.chainText = copy.chain.map(function (c, i) {
        const ts = Array.isArray(c && c.turns) ? c.turns : [];
        const range = ts.length ? (ts.length === 1 ? String(ts[0]) : String(ts[0]) + "-" + String(ts[ts.length - 1])) : "";
        return "步骤" + (i + 1) + (range ? "（回合 " + range + "）" : "") + "：" + String((c && c.text) || "").replace(/\n+/g, " ");
      }).join("\n");
    }
    return copy;
  }
  const hasNew = Array.isArray(proposal.chain) && proposal.chain.length > 0 && proposal.chain[0] && typeof proposal.chain[0] === "object" && (("question" in proposal.chain[0]) || ("text" in proposal.chain[0]));
  if (hasNew && proposal.topic) {
    // 已是新契约：原样直通，但确保 chainText 已生成（R2 user.md 直接消费人话问题链）
    if (typeof proposal.chainText !== "string") {
      const copy = Object.assign({}, proposal);
      if (Array.isArray(copy.chain) && copy.chain.length) {
        copy.chainText = copy.chain.map(function (c, i) {
          const ts = Array.isArray(c && c.turns) ? c.turns : [];
          const range = ts.length ? (ts.length === 1 ? String(ts[0]) : String(ts[0]) + "-" + String(ts[ts.length - 1])) : "";
          const txt = (c && typeof c.text === "string") ? c.text : (c && typeof c.question === "string") ? c.question : (c && c.quote) || "";
          const tag = (c && c.type === "reaction") ? "反应" : "问题";
          return tag + (i + 1) + (range ? "（回合 " + range + "）" : "") + "：" + String(txt).replace(/\n+/g, " ");
        }).join("\n");
      }
      return copy;
    }
    return proposal;
  }
  const n = {};
  n.topic = proposal.topic || proposal.main_topic || (proposal.storyline && proposal.storyline.topic) || null;
  // chain 归一
  const oldChain = Array.isArray(proposal.chain) ? proposal.chain : [];
  if (oldChain.length > 0 && !hasNew) {
    const chain = [];
    let lastUser = null;
    for (const c of oldChain) {
      const q = (c && typeof c.question === "string") ? c.question : (c && c.quote) || "";
      const turns = Array.isArray(c && c.turns) ? c.turns : [];
      if (c && (c.speaker === "user" || c.type === "confusion" || c.type === "event" || c.type === "pursuit") && q) {
        // 是 user 的推进问题 → 开新节点
        chain.push({ question: q, turns: turns.slice() });
        lastUser = chain[chain.length - 1];
      } else if (lastUser && turns.length) {
        // AI 回合/reframe → 并入前一问素材范围
        for (const t of turns) if (!lastUser.turns.includes(t)) lastUser.turns.push(t);
      } else if (!q && turns.length && lastUser) {
        for (const t of turns) if (!lastUser.turns.includes(t)) lastUser.turns.push(t);
      }
    }
    n.chain = chain;
  } else if (Array.isArray(proposal.chain)) {
    n.chain = proposal.chain;
  }
  n.storyline = proposal.storyline && typeof proposal.storyline === "string"
    ? proposal.storyline
    : (proposal.storyline && typeof proposal.storyline === "object")
      ? ((proposal.storyline.topic || "").replace(/^这是关于「|」的对话$/g, "") || proposal.storyline.event || "")
      : (proposal.main_topic || null);
  n.takeaway = (proposal.takeaway && typeof proposal.takeaway === "string") ? proposal.takeaway
    : (proposal.storyline && typeof proposal.storyline === "object" && proposal.storyline.takeaway) || null;
  n.angle = (proposal.angle && typeof proposal.angle === "string") ? proposal.angle : null;   // 叙事主线分类（五种打造视角取一）
  n.chain_type = n.angle;   // 兼容：R1 新契约输出字段为 chain_type，旧结构用 angle 兜底
  // chainText：人话行格式（Q1 (回合4-5): 问题原话）——给 R2 user.md 直接读，避免 JSON 多行
  if (Array.isArray(n.chain) && n.chain.length) {
    n.chainText = n.chain.map(function (c, i) {
      const ts = Array.isArray(c && c.turns) ? c.turns : [];
      const range = ts.length ? (ts.length === 1 ? String(ts[0]) : String(ts[0]) + "-" + String(ts[ts.length - 1])) : "";
      const txt = (c && typeof c.text === "string") ? c.text : (c && typeof c.question === "string") ? c.question : (c && c.quote) || "";
      const tag = (c && c.type === "reaction") ? "反应" : "问题";
      return tag + (i + 1) + (range ? "（回合 " + range + "）" : "") + "：" + String(txt).replace(/\n+/g, " ");
    }).join("\n");
  }
  n.score = (typeof proposal.score === "number") ? proposal.score : null;
  n.category = proposal.category || null;
  n['score-detail'] = Array.isArray(proposal['score-detail']) ? proposal['score-detail'] : null;
  return n;
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
      // 第2轮：scriptRule = 渲染后的续接指令（r2-script handoff + user：规则 + 数据；评分由 review 运行时注入）
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
      const p = getPrompt("r1-review");
      // 素材必须与 R2 同款渲染：行首 tN + 说话人 + 逐字正文。
      // 曾经这里塞的是 JSON.stringify(dialogue)（原始 JSON 大数组），模型得自己在 JSON 里数位置推 tN——
      // 实测 30 条以上的对话，路径证据的原话和 tN 会整段错位（原话在 t15，标成 t9），编辑核对直接对不上；
      // 而且 dialogue 是字符串时 {{dialogue.sourceUrl}} 永远渲染成空。
      const dlgBlock = dialogueBlockFor(dialogue, "用户", "AI", null);
      const defaultMsgs = renderPrompt(p, {
        dialogue: { messages: dlgBlock, sourceUrl: (dialogue && dialogue.sourceUrl) || "" },
        turns: ((dialogue && dialogue.messages) || []).length,
        suggestion: "",
      });
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
      const r = await llmComplete(null, null, cfgOverride, withRevision(msgs, (body && body.revision) || ""), p.config, stopAC.signal);
      const result = extractJson(r.content);
      // 总分由服务端按权重算（模型只给三个维度分）——算完直接盖到提案上，编辑按它排序
      if (result && Array.isArray(result.proposals)) {
        result.proposals.forEach((pp) => {
          const ws = weightedScoreOf(pp);
          if (ws != null) pp.score = ws;
        });
      }
      // 提案版出稿校验（不阻断，仅报告）：链节 turns 越界 / event 引文未在原文找到 → 人工核对
      const warnings = [];
      const dlgMsgs = Array.isArray(dialogue && dialogue.messages) ? dialogue.messages : [];
      if (result && Array.isArray(result.proposals)) {
        result.proposals.forEach((pp, pi) => {
          // R1 v7 契约：立场 → 思辨 → 钥匙 + 话题 + 目标听众 + 创作意见
          const need = ["立场", "钥匙", "话题", "目标听众", "创作意见"];
          const miss = need.filter((k) => !(typeof pp[k] === "string" && pp[k].trim()));
          if (miss.length) warnings.push(`P${pi + 1} 缺字段：${miss.join("、")}`);
          if (!Array.isArray(pp["覆盖turns"]) || !pp["覆盖turns"].length) warnings.push(`P${pi + 1} 缺「覆盖turns」（这条线用了原文哪几条）`);
          // 覆盖turns 的编号必须落在原文范围内（超出 = 模型把轮次算错了，实测出现过 t8）
          const nums = [];
          if (Array.isArray(pp["覆盖turns"])) pp["覆盖turns"].forEach((x) => nums.push(Number(x)));
          const total = dlgMsgs.length;
          const bad = Array.from(new Set(nums)).filter((n) => Number.isInteger(n) && (n < 1 || n > total));
          if (bad.length) warnings.push(`P${pi + 1} 编号超出原文（原文 ${total} 条）：${bad.map((n) => "t" + n).join("、")}`);
          const dir = (typeof pp["创作意见"] === "string") ? pp["创作意见"].trim() : "";
          if (dir) {
            if (!/[「『"]/.test(dir)) warnings.push(`P${pi + 1} 创作意见里没有引原文（立场/钥匙要用「」把原话写出来）`);
            if (/who|value|endpoint|solve|process/.test(dir)) warnings.push(`P${pi + 1} 创作意见里混进了字段名`);
          }
        });
      }
      if (warnings.length) console.warn("[proposals-validate]", warnings.join(" | "));
      console.log("[review-debug] round1 result:", Array.isArray(result && result.proposals) ? ("proposals x" + result.proposals.length) : (result && result.score !== undefined ? "single score=" + result.score : "?"));
      sendJson(res, { ok: true, result, warnings, usage: fmtUsage(r.usage) });
    } catch (err) {
      if (stopAC.signal.aborted) { console.log("[round1] 客户端停止——已中止生成"); return; }
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
      // 原则①：round2 输入从 store 取（前端随请求带 round1 审核采纳结果 review；兼容旧 selection 键）
      const review = (body && body.review && typeof body.review === "object") ? body.review : ((body && body.selection && typeof body.selection === "object") ? body.selection : null);
      // R1 交下来的两样东西：一句话创作指引（R2 唯一的输入）+ 选题说明（编辑挑选用、R4 文案用）
      const reviewObj = (review && typeof review === "object") ? review : null;
      const direction = directionOf(normalizeProposal(reviewObj));   // 一句话创作指引（兼容存量提案）
      const hostParam = hostSnap ? { callName: hostSnap.callName || "主持人", personaInfo: hostSnap.personaInfo || undefined } : { callName: "主持人" };
      const guestParam = guestSnap ? [{ name: guestSnap.name, platform: guestSnap.id, intro: guestSnap.intro || null }] : [{ name: "AI" }];
      // 素材范围由 R1 的提案锁定（覆盖turns / 覆盖轮次）：只喂这一段，别把无关段落塞进稿子
      const dlgTotal = ((dialogue && dialogue.messages) || []).length;
      const coveredRaw = coveredTurnsOf(reviewObj);
      const covered = coveredRaw ? coveredRaw.filter((n) => n >= 1 && n <= dlgTotal) : null;
      if (coveredRaw && covered && covered.length !== coveredRaw.length) console.warn("[round2] 提案里的覆盖轮次超出原文（原文 " + dlgTotal + " 条）：" + coveredRaw.join(","));
      const scope = covered && covered.length ? (turnsLabel(covered) + "（共 " + covered.length + " 条）") : "全部原文";
      // R1 的字段**分开传**（不拼成一段 structure）：任务描述由 user 模板自己组织
      const P0 = (reviewObj && typeof reviewObj === "object") ? reviewObj : {};
      const s0 = (v) => (typeof v === "string" ? v.trim() : "");
      const rendered = renderPrompt(pScript, {
        direction: direction,
        stance: s0(P0["立场"] || P0["刺"] || P0["认知探索"]),
        thought: s0(P0["思辨"] || P0["思辨过程"]),
        key: proposalKeyOf(reviewObj),
        topic: s0(P0["话题"]),
        audience: s0(P0["目标听众"]),
        scope: scope,
        suggestion: (detail && detail.suggestion) || "（无）",
        turns: dlgTotal,
        host: hostParam,
        guests: guestParam,
        // 素材给**全篇**：R2 要能自己从原文里取上下文（谁、什么事），覆盖范围只作为"这条线用哪几条"的提示
        dialogue: { messages: dialogueBlockFor(dialogue, hostParam.callName, guestParam[0] && guestParam[0].name, null), sourceUrl: (dialogue && dialogue.sourceUrl) || "" },
      });
      console.log("[round2] 素材范围=" + scope + " | 原文 " + ((dialogue && dialogue.messages) || []).length + " 条 → 喂 " + (covered ? covered.length : "全部") + " 条");
      // R2 单发（与 harness 一致）：规则 + 素材与契约两条消息，对话原文只以 tN.M 编号块出现一次。
      // 早前挂 R1 的 system+user 前缀（为命中前缀缓存）会把同一份原文注入两遍——原始 JSON 一次、编号块一次，
      // 既多花一份全价 token，又让模型面对两套指认口径（JSON 序号 vs tN.M）。
      const defaultMsgs = [
        rendered[0],         // system：R2 创作规则
        rendered[1],         // user：契约 + tN.M 素材 + 投稿建议
      ];
      console.log("[round2] 指引=" + (direction || "无").slice(0, 40) + " | 规则=" + rendered[0].content.length + "字 | 素材与方向=" + rendered[1].content.length + "字 | 输入合计=" + (rendered[0].content.length + rendered[1].content.length) + "字");
      const cfgOverride = {};
      if (body && Array.isArray(body.messages) && body.messages.length) {
        const cfg = (body && body.config) || {};
        if (cfg.temperature !== undefined && cfg.temperature !== "") cfgOverride.temperature = Number(cfg.temperature);
        if (cfg.seed !== undefined && cfg.seed !== "") cfgOverride.seed = Number(cfg.seed);
        if (cfg.maxTokens !== undefined && cfg.maxTokens !== "") cfgOverride.maxTokens = Number(cfg.maxTokens);
        if (cfg.thinking !== undefined) cfgOverride.thinking = cfg.thinking;
      }
      if (body && body.preview) {
        sendJson(res, { ok: true, apiBody: previewApiBody("r2-script", defaultMsgs), preview: { messages: defaultMsgs, config: pScript.config || {}, name: pScript.name || key, description: pScript.description || "" } });
        return;
      }
      let msgs = (body && Array.isArray(body.messages) && body.messages.length) ? body.messages : defaultMsgs;
      console.log("[round2] 消息来源=" + (msgs === defaultMsgs ? "defaultMsgs(最新渲染)" : "body.messages(快照 " + msgs.length + " 条)"));
      retryAttempts.set(cred.env + ":" + id, (retryAttempts.get(cred.env + ":" + id) || 0) + 1);   // 实际生成计数（重试次数=该值-1）
      // 人工修改意见（llm-box 重试输入框）：附带上一版脚本，追加到最后一条 user 消息
      const _rev = body && typeof body.revision === "string" ? body.revision.trim() : "";
      if (_rev) {
        // 真·多轮改稿：上一版作为 assistant 回灌（模型是在改自己的稿，不是拿参考稿重写）；
        // 只带最近一版，不做无限历史——思考模式每轮都要重新想，上下文越长越贵越慢。
        const _prev = (body && Array.isArray(body.previousScript) && body.previousScript.length) ? body.previousScript[0] : null;
        if (_prev) {
          msgs = msgs.concat([
            { role: "assistant", content: JSON.stringify(sixFieldsOf(_prev), null, 1) },
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
      }
      let r = await llmComplete(null, null, cfgOverride, msgs, pScript.config, stopAC.signal);
      console.log("[round2] 模型原始输出开头:", JSON.stringify(String(r.content).slice(0, 100)));
      let scripts = [];
      const parseScripts = (content) => {
        try {
          const p = extractJson(content);
          const arr = Array.isArray(p) ? p : (Array.isArray(p && p.scripts) ? p.scripts : (p && typeof p === "object" ? [p] : null));
          if (!arr) return null;
          // 兼容 draft 契约（hostOpen/guestOpen/turns/hostWrap/guestSum/hostOutro）→ 补出 segments
          const out = arr.map(segmentsFromDraftShape).filter(Boolean);
          return out.length ? out : [];
        } catch (e) { /* 解析失败按空处理 */ }
        return null;   // null = 解析失败/结构不对；[] = 明确空数组
      };
      let parsedKind = parseScripts(r.content);
      if (parsedKind !== null) scripts = parsedKind;
      else console.error("[review-debug] round2 无 scripts:", String(r.content).slice(0, 120));
      // 兜底：空 scripts 自动重试一次（模型偶发沿用第1轮"判断型输出"或输出空数组）
      if (!scripts.length) {
        console.log("[round2] scripts 为空，自动重试一次…");
        const nudge = "你返回的脚本为空。注意：这是审题第2轮的脚本创作任务（第1轮判断已通过、审题流程已结束），必须实际创作并输出完整的脚本对象（segments 含全部台词，直接输出脚本对象、不要包 scripts 数组、不得为空）。请重新创作。";
        const retryMsgs = msgs.concat([{ role: "assistant", content: r.content }, { role: "user", content: nudge }]);
        const rr = await llmComplete(null, null, cfgOverride, retryMsgs, pScript.config, stopAC.signal);
        const again = parseScripts(rr.content);
        if (again !== null && again.length) scripts = again;
        r = rr;
      }
      // 原话保真标注（编辑选稿依据，只做显示用）：给每个 host 段标 原话/改写/接话
      labelScripts(scripts, dialogue);
      console.log("[review-debug] round2 scripts:", scripts.length);
      sendJson(res, {
        ok: true, result: { scripts },
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
            if (dialogue) labelScripts([fixed], dialogue);
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
  //   服务端补：env + 提示词版本指纹（md mtime）——回溯"哪版规则产生了这个结果"
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
      const sigFiles = ["prompts.json", "material.system.md", "r1-review.user.md", "r2-script.user.md"];
      const sig = sigFiles
        .map((f) => { try { return statSync(join(here, "prompts", f)).mtimeMs; } catch { return 0; } })
        .join(":");
      const row = {
        ts: Date.now(), iso: new Date().toISOString(),
        env: cred.env || null, promptKey: "r2-script", promptSig: sig,
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
      // 只留 segments（+ fidelity 供界面提示"接话 N 段"）：design/turns/hostOpen… 是 R2 出稿时的形态，
      // 编辑之后就过期了，带出来只会让人看到"20 个回合"这种对不上的旧话。
      const polished = { segments: segs };
      if (target && target.fidelity) polished.fidelity = target.fidelity;
      sendJson(res, { ok: true, local: true, result: polished, usage: fmtUsage(r.usage) });
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
        const msgs = renderPrompt(p, { script: script, direction: directionOf(normalizeProposal(inSel)), brief: JSON.stringify(briefOf(normalizeProposal(inSel)) || {}, null, 1) });
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
        msgs = renderPrompt(p, { script: script, direction: directionOf(normalizeProposal(inSel)), brief: JSON.stringify(briefOf(normalizeProposal(inSel)) || {}, null, 1) });
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

  // GET /api/audio/host?userId= → 主持人采样音频（转发服务端 samples/host/:userId/audio）
  // GET /api/audio/guest?platform= → 嘉宾声线音频（转发服务端 samples/guest/:guestId/audio）
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
      if (kind === "host") {
        const userId = qs.get("userId");
        if (!userId) { sendJson(res, { ok: false, error: "需 userId" }, 400); return; }
        fwd = "/v1/editor/samples/host/" + encodeURIComponent(userId) + "/audio";
      } else if (kind === "guest") {
        const platform = qs.get("platform");
        if (!platform) { sendJson(res, { ok: false, error: "需 platform" }, 400); return; }
        fwd = "/v1/editor/samples/guest/" + encodeURIComponent(platform) + "/audio";
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

