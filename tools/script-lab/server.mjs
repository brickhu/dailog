#!/usr/bin/env node
// script-lab web 层：投稿列表 + 分步采编发布控制台（调共享 CLI 底座 tools/dailog-cli）
// 用法：node tools/script-lab/server.mjs [--port 4173] [--env dev]
// 安全：绑定 127.0.0.1 + Host 头校验（防 DNS rebinding）
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

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

/** 已废弃：webui 登录态完全在浏览器 localStorage（请求头携带），不再读 CLI session.json */
async function envLoggedIn(name) { return false; }

/** 密码登录的 cookie 会话（按 env 存内存；webui 登录后后续 API 调用带此 cookie） */
const cookieSessions = new Map();  // env → cookie 字符串
export function getCookieSession(envName) { return cookieSessions.get(envName) || null; }

/** 调 API：cookie 会话优先（密码登录），其次 Bearer token（配对码登录）；401 抛错 */
async function apiWithToken(envName, token, path, opts = {}) {
  const cfg = await configFor(envName);
  const lib = await loadCliLib();
  const headers = {};
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
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
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
      sendJson(res, { ok: true, env: name });
      return;
    } catch (e) {
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
      sendJson(res, { ok: false, error: String((err && err.message) || err) }, 401);
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
        // 采集状态权威判据：服务端 dialogueR2Key（有值=已采集，多端共享）；本地文件兜底
        const hasDialogue = !!r.dialogueR2Key || existsSync(join(lib.draftDir(r.id), "dialogue.json"));
        const progress = existsSync(join(lib.draftDir(r.id), "progress.json"))
          ? JSON.parse(readFileSync(join(lib.draftDir(r.id), "progress.json"), "utf-8"))
          : null;
        if (progress && progress.step === "rejected") stage = "拒稿";
        else if (progress && progress.step) stage = "制作中";
        else if (hasDialogue) stage = "制作中";
        else stage = "待采集";
      }
      return {
        id: r.id, url: r.url, title: r.title, dialogueR2Key: r.dialogueR2Key,
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

  // POST /api/run/batch → 批量采集 submitted 队列（复用 CLI fetch 逻辑，并发 4）
  if (path === "/api/run/batch" && req.method === "POST") {
    const cred = reqCred(req);
    if (!isAuthed(cred)) { sendJson(res, { ok: false, error: "未登录——请先登录" }, 401); return; }
    const { env: e, token } = cred;
    const lib = await loadCliLib();
    const q = await apiWithToken(e, token, "/v1/editor/submissions").catch(() => []);
    const fetchMod = await import(join(CLI_DIST, "fetch.js"));
    // 把登录凭证注入 CLI 底座（cookie 或 token）——fetch 内部 api() 用注入值
    const cliLib = await loadCliLib();
    cliLib.setApiCookie(getCookieSession(e) || null);
    cliLib.setApiToken(token || null);
    const results = [];
    const CONCURRENCY = 4;
    let idx = 0;
    async function worker() {
      while (idx < q.length) {
        const row = q[idx++];
        const dir = lib.draftDir(row.id);
        if (existsSync(join(dir, "dialogue.json"))) {
          results.push({ id: row.id, ok: true, skipped: true });
          continue;
        }
        try {
          const r = await fetchMod.extractSubmission(await configFor(e), row.id, token);
          results.push({ id: row.id, ok: r.ok, detail: r.error ? String(r.error).slice(0, 120) : (r.messages ? r.messages.length + " 条消息" : "") });
        } catch (err) {
          results.push({ id: row.id, ok: false, detail: String((err && err.message) || err).slice(0, 120) });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(q.length, 1)) }, worker));
    sendJson(res, { ok: true, total: q.length, results });
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
    const detail = await apiWithToken(e, token, "/v1/editor/submissions/" + id);
    const dir = lib.draftDir(id);
    const draftFiles = ["dialogue.json", "selection.json", "chosen-idea.json", "script.json", "metadata.json", "info.json"]
      .filter((f) => existsSync(join(dir, f)));
    const progress = existsSync(join(dir, "progress.json"))
      ? JSON.parse(readFileSync(join(dir, "progress.json"), "utf-8"))
      : null;
    sendJson(res, { ok: true, id, detail, draftFiles, progress });
    return;
  }

  // GET /api/draft/<id>/<file> → 草稿目录文件（dialogue/script/selection 等）
  const dm = path.match(/^\/api\/draft\/([0-9a-f-]+)\/([\w.-]+)$/);
  if (dm) {
    const lib = await loadCliLib();
    const dir = lib.draftDir(dm[1]);
    const file = join(dir, dm[2]);
    if (!file.startsWith(dir) || !existsSync(file)) {
      sendJson(res, { ok: false, error: "草稿文件不存在" }, 404);
      return;
    }
    const body = readFileSync(file, "utf-8");
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(body);
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
      console.error(e);
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
