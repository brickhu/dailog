#!/usr/bin/env node
// script-lab web 层：投稿列表 + 分步采编发布控制台（调共享 CLI 底座 tools/dailog-cli）
// 用法：node tools/script-lab/server.mjs [--port 4173] [--env dev]
// 安全：绑定 127.0.0.1 + Host 头校验（防 DNS rebinding）
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLlmConfig } from "./lib/config.mjs";
import { complete } from "./lib/llm.mjs";

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

/** 超时包装：防沙箱/网络异常导致请求挂死 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label + " 超时（" + ms + "ms）")), ms)),
  ]);
}

// ===== R2 权威 + 进程内存缓存（提示词 / 制作产物 / 对话不依赖本地文件）=====
let promptsCache = null;
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

/** 读对话：内存缓存 → 本地草稿工作副本（快）→ R2 兜底（按 URL 哈希） */
async function loadDialogue(envName, token, id) {
  const key = envName + ":" + id;
  if (dialogueCache.has(key)) return dialogueCache.get(key);
  // ① 本地草稿工作副本优先（采集时落盘，毫秒级）
  try {
    const lib = await loadCliLib();
    const localPath = join(lib.draftDir(id), "dialogue.json");
    if (existsSync(localPath)) {
      const d = JSON.parse(readFileSync(localPath, "utf-8"));
      dialogueCache.set(key, d);
      return d;
    }
  } catch { /* 本地无 → R2 兜底 */ }
  // ② R2 兜底（本地丢失/跨端时）
  try {
    const detail = await apiWithToken(envName, token, "/v1/editor/submissions/" + id).catch(() => null);
    if (!detail || !detail.url) return null;
    const { dialogueR2Key } = await import(join(CLI_DIST, "r2.js"));   // 纯哈希函数，无网络
    const content = await r2Get(envName, token, dialogueR2Key(detail.url));
    if (!content) return null;
    const d = JSON.parse(content);
    dialogueCache.set(key, d);
    return d;
  } catch (err) {
    // 404（R2 上不存在）→ 缓存 null 避免重复拉取；其他错误不缓存以便重试
    const msg = String((err && err.message) || err);
    if (msg.includes("404") || msg.includes("NoSuchKey")) dialogueCache.set(key, null);
    return null;
  }
}

/** 读提示词：内存缓存 → R2 拉取 */
async function getPrompts(envName, token) {
  if (promptsCache) return promptsCache;
  try {
    const content = await r2Get(envName, token, "prompts/prompts.json");
    promptsCache = content ? JSON.parse(content) : {};
  } catch { promptsCache = {}; }
  return promptsCache;
}
/** 保存提示词：更新内存 + 推 R2 */
async function savePrompt(envName, token, name, content) {
  const p = (await getPrompts(envName, token)) || {};
  p[name] = content;
  p.updatedAt = Date.now();
  promptsCache = p;
  try { await r2Put(envName, token, "prompts/prompts.json", JSON.stringify(p, null, 2)); return true; }
  catch { return false; }
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
async function runSingleFetch(envName, token, id, url) {
  const fkey = envName + ":" + id;
  fetchingSet.add(fkey);
  if (url) fetchingInfo.set(fkey, { url });
  try {
    // ① R2 缓存判断（lab 管缓存）：同一 URL 已采集 → 直接用，跳过抓取
    if (url) {
      const cached = await readDialogueR2(envName, token, url);
      if (cached && Array.isArray(cached.messages) && cached.messages.length > 0) {
        await markCollected(envName, token, id, cached.messages, cached.title || null);
        dialogueCache.set(fkey, cached);
        fetchResults.set(fkey, { ok: true, detail: cached.messages.length + " 条消息（R2 缓存）", at: Date.now() });
        return { ok: true, messages: cached.messages };
      }
    }
    // ② CLI 纯功能采集（不写文件、不标记，只返回数据）
    const fetchMod = await import(join(CLI_DIST, "fetch.js"));
    const lib = await loadCliLib();
    lib.setApiCookie(getCookieSession(envName) || null);
    lib.setApiToken(token || null);
    const r = await fetchMod.extractSubmission(await configFor(envName), id, token);
    // ③ lab 接管存储：R2 写入 + 服务端标记
    if (r.ok && Array.isArray(r.messages) && r.messages.length > 0) {
      const sourceUrl = r.sourceUrl || url;
      const data = { sourceUrl, source: r.source || "", title: r.title || null, messages: r.messages };
      // 写本地工作副本（review 等流程毫秒级读取）
      try {
        const lib2 = await loadCliLib();
        mkdirSync(lib2.draftDir(id), { recursive: true });
        writeFileSync(join(lib2.draftDir(id), "dialogue.json"), JSON.stringify(data, null, 2), "utf-8");
      } catch { /* 本地写失败不阻塞 */ }
      // R2 备份（多端同步）
      try {
        const { dialogueR2Key } = await import(join(CLI_DIST, "r2.js"));   // 纯哈希函数
        await r2Put(envName, token, dialogueR2Key(sourceUrl), JSON.stringify(data));
        dialogueCache.set(fkey, data);
      } catch { /* R2 上传失败不阻塞标记 */ }
      await markCollected(envName, token, id, r.messages, r.title || null);
    } else {
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
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
}

async function handleApi(path, res, req) {
  // 提示词权威存储（.dailog-editor/prompts.json）——置于顶部避免 TDZ
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
    const [pub, rej] = await Promise.all([
      apiWithToken(e, token, "/v1/editor/submissions?status=published").catch(() => []),
      apiWithToken(e, token, "/v1/editor/submissions?status=rejected").catch(() => []),
    ]);
    const sub = await apiWithToken(e, token, "/v1/editor/submissions").catch(() => []);
    const all = [...sub, ...pub, ...rej];
    const rows = all.map((r) => {
      let stage = "待采集";
      if (r.status === "published") stage = "已发布";
      else if (r.status === "rejected") stage = "拒稿";
      else {
        // 采集状态权威判据：服务端 collected（-1=失败 / 0=未采集 / 1=成功）——纯服务端字段，不依赖本地
        const collected = r.collected;
        if (collected === 1) stage = "制作中";        // 采集成功 → 制作中
        else if (collected === -1) stage = "采集失败";
        else stage = "待采集";                              // collected=0 → 待采集
      }
      return {
        id: r.id, url: r.url, title: r.title, collected: r.collected, dialogueCount: r.dialogueCount,
        displayName: r.displayName || r.userEmail || "?", userEmail: r.userEmail,
        createdAt: r.createdAt, hasVoiceSample: r.hasVoiceSample, stage,
      };
    });
    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const total = rows.length;
    const pendingCount = rows.filter((r) => r.stage === "待采集").length;
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
    runSingleFetch(e, token, id, (sub && sub.url) || null).catch(() => {});
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
        await runSingleFetch(e, token, row.id, row.url || null);
      }
    };
    // 异步启动，不等待（返回已入队数量；进度由 /api/status/fetch 轮询）
    Promise.all(Array.from({ length: Math.min(4, Math.max(pending.length, 1)) }, worker)).catch(() => {});
    sendJson(res, { ok: true, queued: pending.length, total: q.length });
    return;
  }

  /** 从 LLM 输出中提取 JSON（容忍 ```json 围栏与前后文字） */
  function extractJson(text) {
    const m = String(text).match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/);
    const s = m ? m[1] : String(text);
    const start = s.indexOf("{"); const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const candidate = s.slice(start, end + 1);
      try { return JSON.parse(candidate); } catch (err) {
        console.error("[extractJson] 解析失败，输出长度", String(text).length, "开头:", String(text).slice(0, 150));
        throw new Error("LLM 输出不是合法 JSON（截断或格式错误）");
      }
    }
    console.error("[extractJson] 未找到 JSON 对象，输出长度", String(text).length, "开头:", String(text).slice(0, 200));
    throw new Error("LLM 输出不是合法 JSON（未找到 JSON 对象）");
  }
  function llmConfig() {
    const cfg = resolveLlmConfig(process.argv);
    return cfg && cfg.apiKey ? cfg : null;
  }
  async function llmComplete(system, user, cfgOverride = {}) {
    const cfg = llmConfig();
    if (!cfg) throw new Error("未配置 LLM API key（DEEPSEEK_API_KEY）");
    if (!cfg.maxTokens) cfg.maxTokens = 8192;   // 大输出（审题含脚本）设足够上限，防截断导致 JSON 不完整
    Object.assign(cfg, cfgOverride);            // 前端状态0 可覆盖 temperature/seed
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 120000);   // 生成超时 120s，防挂起
    let usage = null;
    try {
      const out = await complete(cfg, [
        { role: "system", content: system },
        { role: "user", content: typeof user === "string" ? user : JSON.stringify(user, null, 1) },
      ], { stream: false, signal: ac.signal, onUsage: (u) => { usage = u; } });
      return { content: out, usage };
    } finally { clearTimeout(timer); }
  }

  // POST /api/run/review/preview → 状态0：LLM 调用输入预览（system/user 提示词 + 温度/seed，可编辑后发送）
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
      const prompts = (await getPrompts(e, token)) || {};
      if (!prompts.selection) { sendJson(res, { ok: false, error: "缺少 selection 提示词（设置页配置）" }); return; }
      // 组装完整用户提示词：dialogue + suggestion + host/guest 快照（投稿时定格，直接取）
      const detail = await apiWithToken(e, token, "/v1/editor/submissions/" + id).catch(() => null);
      const hostSnap = (detail && detail.host) || null;
      const guestSnap = (detail && detail.guest) || null;
      const userPayload = {
        dialogue,
        suggestion: (detail && detail.suggestion) || undefined,
        host: hostSnap ? { callName: hostSnap.callName || undefined, personaInfo: hostSnap.personaInfo || undefined } : undefined,
        guests: guestSnap ? [{ name: guestSnap.name, platform: guestSnap.id, intro: guestSnap.intro || null }] : undefined,
      };
      const cfg = llmConfig();
      sendJson(res, {
        ok: true,
        system: prompts.selection,
        user: JSON.stringify(userPayload, null, 1),
        temperature: cfg && cfg.temperature !== undefined ? cfg.temperature : 0.7,
        seed: cfg && cfg.seed !== undefined ? cfg.seed : 42,   // 默认固定 seed，可复现
      });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/review → 创作审题：dialogue + selection 提示词 → LLM 审核结果（暂存，不入库；前端确认后才落库）
  if (path === "/api/run/review" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    try {
      const t0 = Date.now();
      const dialogue = await loadDialogue(e, token, id);   // 共享 dialogueCache——详情页加载后直接命中内存，不走远程
      console.log("[review-debug] loadDialogue", Date.now() - t0, "ms");
      if (!dialogue) { sendJson(res, { ok: false, error: "未采集——请先采集对话" }); return; }
      const t1 = Date.now();
      const prompts = (await getPrompts(e, token)) || {};
      console.log("[review-debug] getPrompts", Date.now() - t1, "ms");
      if (!prompts.selection) { sendJson(res, { ok: false, error: "缺少 selection 提示词（设置页配置）" }); return; }
      const t2 = Date.now();
      // 状态0 可编辑覆盖：system/user/temperature/seed（前端传入则使用）
      const sysMsg = (body && typeof body.system === "string" && body.system.trim()) ? body.system : prompts.selection;
      const userMsg = (body && typeof body.user === "string" && body.user.trim()) ? body.user : { dialogue };
      const cfgOverride = {};
      if (body && body.temperature !== undefined && body.temperature !== "") cfgOverride.temperature = Number(body.temperature);
      if (body && body.seed !== undefined && body.seed !== "") cfgOverride.seed = Number(body.seed);
      // LLM 间歇性空响应/输出异常 → 自动重试一次
      let result = null, usage = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await llmComplete(sysMsg, userMsg, cfgOverride);
          usage = r.usage;
          result = extractJson(r.content);
          break;
        } catch (err) {
          if (attempt === 0) console.error("[review] 审题失败，自动重试:", String((err && err.message) || err));
          else throw err;
        }
      }
      console.log("[review-debug] llmComplete", Date.now() - t2, "ms");
      sendJson(res, {
        ok: true, result,
        usage: usage ? { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 } : null,
      });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/review/confirm → 确认入库：读取暂存的审核结果 → production.selection + script
  if (path === "/api/run/review/confirm" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    // 审题结果由前端持有并随确认请求传回（不依赖 server 内存——重启/多实例不丢）
    const result = (body && body.result && typeof body.result === "object") ? body.result : null;
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
      sendJson(res, { ok: true, rejected, message: d.message || (rejected ? "已标注审核不通过" : "审核通过") });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/script → 创作：dialogue + selection 提示词 → 脚本结构（写 production.json.selection + script）
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
      const prompts = (await getPrompts(e, token)) || {};
      if (!prompts.selection) { sendJson(res, { ok: false, error: "缺少 selection 提示词（设置页配置）" }); return; }
      const { content: out } = await llmComplete(prompts.selection, { dialogue });
      const parsed = extractJson(out);
      const prod = await saveProduction(e, token, id, {
        selection: parsed,
        script: Array.isArray(parsed.scripts) ? parsed.scripts[0] : null,
        progress: { step: "script", updatedAt: new Date().toISOString() },
      });
      sendJson(res, { ok: true, message: "脚本生成完成" + (prod.script ? "" : "（未解析到 scripts，请查看 production.json）") });
    } catch (err) { sendJson(res, { ok: false, error: String((err && err.message) || err) }); }
    return;
  }

  // POST /api/run/polish → 语感打磨：script + polish 提示词（body: {id, scope?, target?, revision?}）
  if (path === "/api/run/polish" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const body = await readBody(req);
    const id = (body && body.id) || null;
    if (!id) { sendJson(res, { ok: false, error: "需指定投稿 id" }, 400); return; }
    try {
      const prod = await loadProduction(e, token, id);
      if (!prod || !prod.script) { sendJson(res, { ok: false, error: "尚无脚本——先执行创作（生成脚本）" }); return; }
      const prompts = (await getPrompts(e, token)) || {};
      if (!prompts.polish) { sendJson(res, { ok: false, error: "缺少 polish 提示词（设置页配置）" }); return; }
      const scope = (body.scope) || "all";
      const { content: out } = await llmComplete(prompts.polish, { scripts: prod.script, scope, target: body.target || null, revision: body.revision || null });
      const parsed = extractJson(out);
      let patch = { progress: { step: "polish", updatedAt: new Date().toISOString() } };
      if (scope === "all" && parsed.parts) patch.script = parsed;
      else patch.polishResult = parsed;   // one/line：结果暂存，前端定位回填
      await saveProduction(e, token, id, patch);
      sendJson(res, { ok: true, message: scope === "all" ? "语感打磨完成" : "打磨结果已生成" });
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
      const prod = await loadProduction(e, token, id);
      if (!prod || !prod.script) { sendJson(res, { ok: false, error: "尚无脚本——先执行创作" }); return; }
      const prompts = (await getPrompts(e, token)) || {};
      if (!prompts.meta) { sendJson(res, { ok: false, error: "缺少 meta 提示词（设置页配置）" }); return; }
      const { content: out } = await llmComplete(prompts.meta, { script: prod.script, chosenIdea: prod.chosenIdea || prod.selection || null });
      const parsed = extractJson(out);
      await saveProduction(e, token, id, { metadata: parsed, progress: { step: "publish", updatedAt: new Date().toISOString() } });
      sendJson(res, { ok: true, message: "发布元信息生成完成" });
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
    // 审核决策从服务端 detail 派生（DB：review_status/review_score + R2：reviewScripts）
    const draftFiles = [];
    const reviewStatus = (detail && detail.reviewStatus) || null;
    const reviewScripts = (detail && detail.reviewScripts) || null;
    const prodSummary = reviewStatus ? {
      hasSelection: true,
      reviewStatus,
      reviewScore: detail.reviewScore ?? null,
      rejection: detail.rejectedReason || null,
      scriptList: reviewStatus === 'rejected' ? [] : (Array.isArray(reviewScripts) ? reviewScripts : []),
    } : null;
    // 对话随详情一次返回（本地工作副本，毫秒级）——前端直接渲染，不再单独请求 /api/draft
    const dialogue = await loadDialogue(e, token, id);
    sendJson(res, {
      ok: true, id, detail, draftFiles, progress: null, prodSummary, dialogue,
    });
    return;
  }

  // 提示词管理（R2 权威 + 进程内存缓存）
  if (path === "/api/prompts" && req.method === "GET") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    try {
      const p = (await getPrompts(cred.env, cred.token)) || { updatedAt: 0 };
      const prompts = Object.entries(p)
        .filter(([k, v]) => typeof v === "string" && k !== "updatedAt")
        .map(([k, v]) => ({ name: k, content: v }));
      sendJson(res, { ok: true, prompts, updatedAt: p.updatedAt || null });
    } catch (e) { sendJson(res, { ok: false, error: String((e && e.message) || e) }); }
    return;
  }
  const pm = path.match(/^\/api\/prompts\/([a-zA-Z0-9_-]+)$/);
  if (pm && req.method === "PUT") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const name = pm[1];
    const body = await readBody(req);
    const content = (body && typeof body.content === "string") ? body.content : null;
    if (content === null) { sendJson(res, { ok: false, error: "需 content 字段" }, 400); return; }
    try {
      const pushed = await savePrompt(cred.env, cred.token, name, content);
      sendJson(res, { ok: true, message: "已保存" + (pushed ? "" : "（R2 推送失败，内存保留）") });
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
