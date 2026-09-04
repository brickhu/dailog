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
const CLI_DIST = join(here, "..", "dailog-cli", "dist");
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
const FB_DIR = join(here, "feedback");
const FB_FILE = join(FB_DIR, "review.jsonl");
const FB_SIG_FILES = ["prompts.json", "review.score.system.md", "review.score.user.md", "review.script.user.md", "review.script.handoff.md"];

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
  return import(join(CLI_DIST, "lib.js"));
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
    const { dialogueR2Key } = await import(join(CLI_DIST, "r2.js"));   // 纯哈希函数，无网络
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

/** 读制作产物：内存缓存 → R2 workflows/{env}/{id}.json */
async function loadProduction(envName, token, id) {
  const key = envName + ":" + id;
  if (productionCache.has(key)) return productionCache.get(key);
  try {
    const d = await withTimeout(apiWithToken(envName, token, "/v1/editor/submissions/" + id + "/workflow", { method: "GET" }), 30000, "R2 读取");
    const p = (d && d.production) || null;
    productionCache.set(key, p);
    return p;
  } catch (err) {
    console.error("[loadProduction]", envName, id, String((err && err.message) || err));
    productionCache.set(key, null);
    return null;
  }
}
/** 保存制作产物：合并更新内存 + 推 R2 */
async function saveProduction(envName, token, id, patch) {
  const key = envName + ":" + id;
  try {
    const d = await withTimeout(apiWithToken(envName, token, "/v1/editor/submissions/" + id + "/workflow", {
      method: "POST", body: { patch },
    }), 30000, "R2 写入");
    const cur = (d && d.production) || { id, env: envName, ...patch };
    productionCache.set(key, cur);
    return cur;
  } catch (err) {
    console.error("[saveProduction]", envName, id, String((err && err.message) || err));
    const cur = { ...((await loadProduction(envName, token, id)) || { id, env: envName }), ...patch, updatedAt: Date.now() };
    productionCache.set(key, cur);
    return cur;
  }
}

/** 已废弃：webui 登录态完全在浏览器 localStorage（请求头携带），不再读 CLI session.json */
async function envLoggedIn(name) { return false; }

/** 密码登录的 cookie 会话（按 env 存文件——重启不丢；webui 登录后后续 API 调用带此 cookie） */
const COOKIE_FILE = join(here, ".lab-cookies.json");
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
    const { dialogueR2Key } = await import(join(CLI_DIST, "r2.js"));   // 纯哈希函数
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
async function runSingleFetch(envName, token, id, url, title) {
  const fkey = envName + ":" + id;
  fetchingSet.add(fkey);
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
    // ② 采集（lab 自包含 collect.mjs——原始对话内容采集不再依赖 CLI；url/title 由 lab 侧已获取，直接解码）
    const collect = await import("./lib/collect.mjs");
    const r = await collect.collectDialogue(url, { title: title ?? null });
    // ③ lab 接管存储：R2 写入 + 服务端标记
    if (r.ok && Array.isArray(r.messages) && r.messages.length > 0) {
      const sourceUrl = r.sourceUrl || url;
      const data = { sourceUrl, source: r.source || "", title: r.title || null, messages: r.messages };
      // R2 备份（多端同步）——不写本地（彻底解耦）
      try {
        const { dialogueR2Key } = await import(join(CLI_DIST, "r2.js"));   // 纯哈希函数
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
    const [pub, rej, crafted, col] = await Promise.all([
      apiWithToken(e, token, "/v1/editor/submissions?status=published").catch(() => []),
      apiWithToken(e, token, "/v1/editor/submissions?status=rejected").catch(() => []),
      apiWithToken(e, token, "/v1/editor/submissions?status=crafted").catch(() => []),
      apiWithToken(e, token, "/v1/editor/submissions?status=collected").catch(() => []),
    ]);
    const sub = await apiWithToken(e, token, "/v1/editor/submissions").catch(() => []);
    const all = [...sub, ...col, ...pub, ...rej, ...crafted];
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
  async function llmComplete(system, user, cfgOverride = {}, messages = null, promptCfg = {}) {
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
    let usage = null;
    try {
      // messages 传入则直接使用（多轮对话：第2轮带上第1轮完整历史 + assistant 回传 → system+user 前缀命中缓存）
      const msgs = messages || [
        { role: "system", content: system },
        { role: "user", content: typeof user === "string" ? user : JSON.stringify(user, null, 1) },
      ];
      const _fp = msgs.slice(0, 2).map(m => (m.role || "?") + "(" + String(m.content).length + "):" + String(m.content).slice(0, 30).replace(/\n/g, "\\n")).join(" || ");
      console.log("[llm-prefix] " + _fp);   // 诊断：R1/R2 前缀是否逐字一致（缓存命中的前提）
      const out = await complete(cfg, msgs, { stream: false, signal: ac.signal, onUsage: (u) => { usage = u; } });
      if (usage) {
        const hit = usage.prompt_cache_hit_tokens ?? 0, miss = usage.prompt_cache_miss_tokens ?? 0, tot = usage.prompt_tokens ?? 0;
        console.log("[llm-usage] prompt=" + tot + " (cache_hit=" + hit + " cache_miss=" + miss + " 命中率=" + (tot ? Math.round(hit / tot * 100) : 0) + "%) output=" + (usage.completion_tokens ?? 0) + " model=" + cfg.model);
      }
      return { content: out, usage };
    } finally { clearTimeout(timer); }
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
      const detail = await apiWithToken(e, token, "/v1/editor/submissions/" + id);
      const scripts = (detail && Array.isArray(detail.reviewScripts)) ? detail.reviewScripts : [];
      const target = scripts[scriptIndex];
      const seg = target && target.segments && target.segments[segIndex];
      if (!seg || typeof seg.text !== "string" || !seg.text.trim()) { sendJson(res, { ok: false, error: "片段不存在" }, 404); return; }
      const config = await configFor(e);
      const { getR2Object } = await import(join(CLI_DIST, "r2.js"));
      const { synthesizeSingle } = await import(join(CLI_DIST, "fish.js"));
      // 参考音频：host = voiceSamples（R2 直取 + 转 wav）；guest = guests 声线（R2 audioKey + 转 wav）
      let ref;
      if (seg.speaker === "guest") {
        const samples = await apiWithToken(e, token, "/v1/editor/guests/voice-samples").catch(() => []);
        const guestId = (detail && detail.guest && detail.guest.id) || null;
        const mine = (Array.isArray(samples) ? samples : []).filter((x) => x.guestId === guestId);
        const row = mine.find((x) => x.language === "zh") || mine[0];
        if (!row || !row.audioKey) { sendJson(res, { ok: false, error: "嘉宾 " + (guestId || "?") + " 无声线（guest-voice 上传）" }); return; }
        const bytes = await getR2Object(config, row.audioKey);
        ref = { audio: bytes, text: row.transcript || null };
      } else {
        const samples = (detail && detail.voiceSamples) || [];
        const sample = samples.find((x) => x.status === "ready") || samples[0];
        if (!sample || !sample.audioUrl) { sendJson(res, { ok: false, error: "主持人无声样" }); return; }
        const bytes = await getR2Object(config, sample.audioUrl);
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
      const pScore = getPrompt("review.score");
      const pScript = getPrompt("review.script");
      // 快照（投稿时定格，直接取）
      const detail = await apiWithToken(e, token, "/v1/editor/submissions/" + id).catch(() => null);
      const hostSnap = (detail && detail.host) || null;
      const guestSnap = (detail && detail.guest) || null;
      const cfg = llmConfig();
      // 第1轮：system=打分规则文本（字典静态部分），user1=仅对话 json
      const scoreSystem = (pScore.messages.find(m => m.role === "system") || {}).content || "";
      // 第2轮：scriptRule = 渲染后的续接指令（review.script 单条 user：规则 + 数据；评分由 review 运行时注入）
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
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    try {
      const dialogue = await loadDialogue(e, token, id);
      if (!dialogue) { sendJson(res, { ok: false, error: "未采集——请先采集对话" }); return; }
      const p = getPrompt("review.score");
      const defaultMsgs = renderPrompt(p, { dialogue: JSON.stringify(dialogue), suggestion: "" });
      const cfgOverride = {};
      if (body && Array.isArray(body.messages) && body.messages.length) {
        const cfg = (body && body.config) || {};
        if (cfg.temperature !== undefined && cfg.temperature !== "") cfgOverride.temperature = Number(cfg.temperature);
        if (cfg.seed !== undefined && cfg.seed !== "") cfgOverride.seed = Number(cfg.seed);
        if (cfg.maxTokens !== undefined && cfg.maxTokens !== "") cfgOverride.maxTokens = Number(cfg.maxTokens);
        if (cfg.thinking !== undefined) cfgOverride.thinking = cfg.thinking;
      }
      if (body && body.preview) {
        sendJson(res, { ok: true, apiBody: previewApiBody("review.score", defaultMsgs), preview: { messages: defaultMsgs, config: p.config || {}, name: p.name || key, description: p.description || "" } });
        return;
      }
      const msgs = (body && Array.isArray(body.messages) && body.messages.length) ? body.messages : defaultMsgs;
      console.log("[round1] 消息来源=" + (msgs === defaultMsgs ? "defaultMsgs(最新渲染)" : "body.messages(快照 " + msgs.length + " 条)"));
      const r = await llmComplete(null, null, cfgOverride, withRevision(msgs, (body && body.revision) || ""), p.config);
      const result = extractJson(r.content);
      console.log("[review-debug] round1 score:", result.score);
      sendJson(res, { ok: true, result, usage: fmtUsage(r.usage) });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/review/round2 → 审题第2轮：脚本创作（llm-box 组件2；依赖 round1 的 score）
  if (path === "/api/run/review/round2" && req.method === "POST") {
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
      const pScore = getPrompt("review.score");
      const pScript = getPrompt("review.script");
      // 原则①：round2 输入从 store 取（前端随请求带 round1 审核采纳结果 review；兼容旧 selection 键）
      const review = (body && body.review && typeof body.review === "object") ? body.review : ((body && body.selection && typeof body.selection === "object") ? body.selection : null);
      // B' 续接式：R2 前两条复用 R1 的 system+user（与 round1 请求逐字一致 → 命中 DeepSeek 前缀缓存，对话原文不再全价重付）；
      // [2] assistant=审题交接（评分+主线+价值锚点+创作建议 advice——模型视为自己说过的结论，遵循度最高）；
      // [3] user=创作规则 + 角色数据（不含对话原文、不含 review JSON）
      const msgs1 = renderPrompt(pScore, { dialogue: JSON.stringify(dialogue), suggestion: "" });
      const rendered = renderPrompt(pScript, {
        score,
        review,
        suggestion: (detail && detail.suggestion) || "",
        host: hostSnap ? { callName: hostSnap.callName || "主持人", personaInfo: hostSnap.personaInfo || undefined } : { callName: "主持人" },
        guests: guestSnap ? [{ name: guestSnap.name, platform: guestSnap.id, intro: guestSnap.intro || null }] : [{ name: "AI" }],
      });
      const defaultMsgs = [
        msgs1[0],            // system：review.score（与 R1 相同 → 前缀缓存）
        msgs1[1],            // user：对话全文（与 R1 相同 → 前缀缓存）
        rendered[0],         // assistant：审题交接（handoff，含 advice）
        rendered[1],         // user：创作规则 + 角色数据
      ];
      console.log("[round2] review=" + (review ? "有(" + Object.keys(review).join(",") + ")" : "无") + " | handoff=" + rendered[0].content.length + "字 含advice=" + rendered[0].content.includes("advice") + " | rules=" + rendered[1].content.length + "字");
      const cfgOverride = {};
      if (body && Array.isArray(body.messages) && body.messages.length) {
        const cfg = (body && body.config) || {};
        if (cfg.temperature !== undefined && cfg.temperature !== "") cfgOverride.temperature = Number(cfg.temperature);
        if (cfg.seed !== undefined && cfg.seed !== "") cfgOverride.seed = Number(cfg.seed);
        if (cfg.maxTokens !== undefined && cfg.maxTokens !== "") cfgOverride.maxTokens = Number(cfg.maxTokens);
        if (cfg.thinking !== undefined) cfgOverride.thinking = cfg.thinking;
      }
      if (body && body.preview) {
        sendJson(res, { ok: true, apiBody: previewApiBody("review.script", defaultMsgs), preview: { messages: defaultMsgs, config: pScript.config || {}, name: pScript.name || key, description: pScript.description || "" } });
        return;
      }
      let msgs = (body && Array.isArray(body.messages) && body.messages.length) ? body.messages : defaultMsgs;
      console.log("[round2] 消息来源=" + (msgs === defaultMsgs ? "defaultMsgs(最新渲染)" : "body.messages(快照 " + msgs.length + " 条)"));
      retryAttempts.set(cred.env + ":" + id, (retryAttempts.get(cred.env + ":" + id) || 0) + 1);   // 实际生成计数（重试次数=该值-1）
      // 人工修改意见（llm-box 重试输入框）：附带上一版脚本，追加到最后一条 user 消息
      const _rev = body && typeof body.revision === "string" ? body.revision.trim() : "";
      if (_rev) {
        const _prev = (body && Array.isArray(body.previousScript)) ? JSON.stringify(body.previousScript, null, 1) : null;
        const _last = msgs[msgs.length - 1];
        msgs = msgs.slice(0, -1).concat([{
          role: _last ? _last.role : "user",
          content: (_last ? _last.content : "") + "\n\n---\n"
            + (_prev ? "上一版脚本（供修改参考）：\n" + _prev + "\n\n" : "")
            + "编辑修改意见：\n" + _rev + "\n\n请按意见逐条修改后，输出最终脚本对象（不要解释、不要输出多余文字）。",
        }]);
        console.log("[round2] 携带人工修改意见重新生成（" + _rev.length + " 字）");
        const _rk = cred.env + ":" + id;
        const _arr = retryDefects.get(_rk) || [];
        if (_arr.length < 20) _arr.push(_rev.slice(0, 500));
        retryDefects.set(_rk, _arr);   // 内存累积，入库时一并落盘
      }
      let r = await llmComplete(null, null, cfgOverride, msgs, pScript.config);
      console.log("[round2] 模型原始输出开头:", JSON.stringify(String(r.content).slice(0, 100)));
      let scripts = [];
      const parseScripts = (content) => {
        try {
          const p = extractJson(content);
          if (Array.isArray(p)) return p;
          if (Array.isArray(p.scripts)) return p.scripts;
          if (p && Array.isArray(p.segments)) return [p];
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
        const rr = await llmComplete(null, null, cfgOverride, retryMsgs, pScript.config);
        const again = parseScripts(rr.content);
        if (again !== null && again.length) scripts = again;
        r = rr;
      }
      console.log("[review-debug] round2 scripts:", scripts.length);
      sendJson(res, {
        ok: true, result: { scripts },
        usage: fmtUsage(r.usage),
        raw: String(r.content).slice(0, 400),   // 供质量标记样本（不落生产）
      });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

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
      const sigFiles = ["prompts.json", "review.score.system.md", "review.score.user.md", "review.script.user.md", "review.script.handoff.md"];
      const sig = sigFiles
        .map((f) => { try { return statSync(join(here, "prompts", f)).mtimeMs; } catch { return 0; } })
        .join(":");
      const row = {
        ts: Date.now(), iso: new Date().toISOString(),
        env: cred.env || null, promptKey: "review.script", promptSig: sig,
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
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/review/confirm → 确认入库：读取暂存的审核结果 → production.review + script
  if (path === "/api/run/review/confirm" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    // 审题结果由前端持有并随确认请求传回（不依赖 server 内存——重启/多实例不丢）
    const result = (body && body.result && typeof body.result === "object") ? body.result : null;
    const score = Number(body && body.score);
    const fbScore = Number.isInteger(score) && score >= 1 && score <= 10 ? score : null;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    if (!result) { sendJson(res, { ok: false, error: "无审题结果——请先执行审题" }); return; }
    try {
      // 调服务端业务接口：服务端内部写 DB 决策 + R2 scripts + 拒稿联动 reject + 通知
      const d = await apiWithToken(e, token, "/v1/editor/submissions/" + id + "/review", {
        method: "POST",
        body: { result },
      });
      // 服务端写入成功后，同步本地内存缓存（读 DB 决策状态）
      const rejected = d.rejected === true;
      const detail = await apiWithToken(e, token, "/v1/editor/submissions/" + id).catch(() => null);
      productionCache.set(e + ":" + id, detail || null);
      // 标题回写兜底：后端 /review 已按 result.title setTitle；此处 lab 再幂等确认一次（防后端旧版未实现/漏写）
      if (!rejected && result.title && typeof result.title === "string" && result.title.trim()) {
        try { await apiWithToken(e, token, "/v1/editor/submissions/" + id + "/title", { method: "PATCH", body: { title: result.title.trim() } }); }
        catch (err) { console.log("[review/confirm] title 回写失败:", String((err && err.message) || err).slice(0, 200)); }
      }
      // 入库打分（一次）→ 与重试轨迹合并成一条自进化记录 kind:"final"：
      //   "重试了 X 次之后给出 N 分，其中暴露缺陷：[1. … 2. …]"
      if (fbScore) {
        const _fk = e + ":" + id;
        const _attempts = retryAttempts.get(_fk) || 1;
        const _defects = retryDefects.get(_fk) || [];
        appendFeedback({
          ts: Date.now(), iso: new Date().toISOString(),
          env: e, promptKey: "review.script", promptSig: promptSig(),
          submissionId: id, kind: "final",
          retries: Math.max(0, _attempts - 1),   // 重试次数 = 实际生成次数 - 首次
          score: fbScore,
          verdict: fbScore >= 7 ? "ok" : "problem",
          defects: _defects,                      // 每次带意见重试的缺陷（1..N）
          types: Array.isArray(body.fbTypes) ? body.fbTypes.filter((t) => typeof t === "string").slice(0, 6) : [],
          note: body.note ? String(body.note).slice(0, 500) : null,
        });
        retryAttempts.delete(_fk); retryDefects.delete(_fk);   // 记录完成后清空该投稿轨迹
      }
      sendJson(res, { ok: true, rejected, message: d.message || (rejected ? "已标注审核不通过" : "审核通过") });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/script → 创作：dialogue + review 提示词 → 脚本结构（写 production.json.review + script）
  if (path === "/api/run/script" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    try {
      const dialogue = await loadDialogue(e, token, id);
      if (!dialogue) { sendJson(res, { ok: false, error: "未采集——请先采集对话" }); return; }
      const p = getPrompt("review.score");
      const msgs = renderPrompt(p, { dialogue: JSON.stringify(dialogue) });
      const { content: out } = await llmComplete(msgs[0].content, msgs[1].content, undefined, undefined, p.config);
      const parsed = extractJson(out);
      const prod = await saveProduction(e, token, id, {
        review: parsed,
        script: Array.isArray(parsed.scripts) ? parsed.scripts[0] : null,
        progress: { step: "script", updatedAt: new Date().toISOString() },
      });
      sendJson(res, { ok: true, message: "脚本生成完成" + (prod.script ? "" : "（未解析到 scripts，请查看 production.json）") });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/polish → 语感打磨（批量，llm-box 契约）：body {id, scriptIndex, messages?, config?, preview?}
  //   读 R2 scripts[scriptIndex] → 渲染 polish.all（scope=all）→ LLM → 结果 segments 写回 R2
  if (path === "/api/run/polish" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    const scriptIndex = (body && body.scriptIndex !== undefined) ? Number(body.scriptIndex) : 0;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    try {
      // 读当前 scripts（R2 权威）
      const detail = await apiWithToken(e, token, "/v1/editor/submissions/" + id);
      const scripts = (detail && Array.isArray(detail.reviewScripts)) ? detail.reviewScripts : [];
      const target = scripts[scriptIndex];
      if (!target || !Array.isArray(target.segments)) { sendJson(res, { ok: false, error: "脚本不存在（index " + scriptIndex + "）" }, 404); return; }
      const p = getPrompt("polish.all");
      const dialogue = await loadDialogue(e, token, id).catch(() => null);   // 定稿对照：polish 需比对原始对话
      const defaultMsgs = renderPrompt(p, { scripts: JSON.stringify(target, null, 1), dialogue: dialogue ? JSON.stringify(dialogue, null, 1) : "", scope: "all", target: "", revision: "" });
      const cfgOverride = {};
      if (body && Array.isArray(body.messages) && body.messages.length) {
        const cfg = (body && body.config) || {};
        if (cfg.temperature !== undefined && cfg.temperature !== "") cfgOverride.temperature = Number(cfg.temperature);
        if (cfg.seed !== undefined && cfg.seed !== "") cfgOverride.seed = Number(cfg.seed);
        if (cfg.maxTokens !== undefined && cfg.maxTokens !== "") cfgOverride.maxTokens = Number(cfg.maxTokens);
        if (cfg.thinking !== undefined) cfgOverride.thinking = cfg.thinking;
      }
      if (body && body.preview) {
        sendJson(res, { ok: true, apiBody: previewApiBody("polish.all", defaultMsgs), preview: { messages: defaultMsgs, config: p.config || {}, name: p.name || "polish.all", description: p.description || "" } });
        return;
      }
      const msgs = (body && Array.isArray(body.messages) && body.messages.length) ? body.messages : defaultMsgs;
      // 防回显：LLM 偶发把输入 segments 原样复制（creationNote 却声称已打磨）——检测逐字一致则带修正指示自动重试一次
      const segsIdentical = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
        && a.every((s, i) => (s && s.text || '') === ((b[i] && b[i].text) || ''));
      let r = await llmComplete(null, null, cfgOverride, withRevision(msgs, (body && body.revision) || ""), p.config);
      let parsed = extractJson(r.content);
      let segs = Array.isArray(parsed) ? parsed : (parsed.segments || null);
      let retried = false;
      if (Array.isArray(segs) && segsIdentical(segs, target.segments)) {
        retried = true;
        const retryMsgs = msgs.concat([
          { role: "assistant", content: r.content },
          { role: "user", content: "检测到上述输出与输入脚本逐字相同，未执行任何打磨。请重新打磨：按准则实际修改（口语化/听感/情绪标签/停顿至少落实其一，全脚本通常 3 项都动），禁止原样复制输入；同时禁止新增对话原文之外的内容。" },
        ]);
        r = await llmComplete(null, null, cfgOverride, retryMsgs, p.config);
        parsed = extractJson(r.content);
        segs = Array.isArray(parsed) ? parsed : (parsed.segments || null);
      }
      // 结果：segments 数组（新结构）——校验；dry=true（控制台多候选）时不落 R2，由业务采纳后保存
      if (!Array.isArray(segs)) { sendJson(res, { ok: false, error: "打磨结果缺少 segments 数组" }); return; }
      const polished = { ...target, segments: segs };
      if (body && body.dry === true) {
        sendJson(res, { ok: true, dry: true, result: polished, retried, usage: fmtUsage(r.usage) });
        return;
      }
      scripts[scriptIndex] = polished;
      await apiWithToken(e, token, "/v1/editor/submissions/" + id + "/scripts", { method: "PUT", body: { scripts } });
      productionCache.delete(e + ":" + id);
      sendJson(res, {
        ok: true, message: "语感打磨完成（" + segs.length + " 段）" + (retried ? "（首次输出未改动，已自动重试）" : ""), result: polished,
        retried,
        usage: fmtUsage(r.usage),
      });
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
        const p = getPrompt("meta");
        const msgs = renderPrompt(p, { script, review: inSel });
        sendJson(res, { ok: true, apiBody: previewApiBody("meta", msgs), preview: { messages: msgs, config: p.config || {}, name: p.name || "meta", description: p.description || "" } });
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
        const p = getPrompt("meta");
        msgs = renderPrompt(p, { script, review: inSel });
      }
      const r = await llmComplete(null, null, cfgOverride, withRevision(msgs, (body && body.revision) || ""), getPrompt("meta").config);
      const parsed = extractJson(r.content);
      // 自动填充：只生成 meta 返回（表单回填），不写 production
      if (body && body.fillOnly) {
        sendJson(res, { ok: true, fillOnly: true, result: parsed, usage: fmtUsage(r.usage) });
        return;
      }
      await saveProduction(e, token, id, { metadata: parsed, progress: { step: "publish", updatedAt: new Date().toISOString() } });
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
    sendJson(res, {
      ok: true, id, detail, draftFiles, progress: null, prodSummary, dialogue,
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
