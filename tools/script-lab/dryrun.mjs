#!/usr/bin/env node
/**
 * dryrun —— 干跑任一环节，**不改变任何业务状态**。
 *
 * 四个环节的干跑路径（服务端本就只读，这里只是把它们统一起来）：
 *   r1  POST /api/run/review/round1     出提案
 *   r2  POST /api/run/review/round2     出脚本
 *   r3  POST /api/run/polish            语感打磨
 *   r4  POST /api/run/publish (fillOnly) 发布元信息
 * 全程不写 production.json、不改投稿状态、不落 prompt 文件。
 *
 * 用法：
 *   node tools/script-lab/dryrun.mjs <投稿id>                          完整流程（向导）：选提案 → 脚本 → 打磨 → 发布文案
 *   node tools/script-lab/dryrun.mjs list [关键词]                     列出投稿（id 列就是投稿 id，直接复制来用）
 *   node tools/script-lab/dryrun.mjs material <id>                    取素材包（JSON）
 *   node tools/script-lab/dryrun.mjs r2 <id> [--file prompts/x.md]    干跑一个环节
 *   node tools/script-lab/dryrun.mjs all <id>                         四个环节依次干跑
 *   node tools/script-lab/dryrun.mjs batch <id...> --stage r2 [--outdir /tmp]
 *
 *  r1 会给出几条候选提案，挑一条喂给 r2：
 *   node tools/script-lab/dryrun.mjs r1 <id> --out /tmp/r1.json
 *   node tools/script-lab/dryrun.mjs r2 <id> --from /tmp/r1.json --thread 2
 *
 * 选项：
 *   --stage <r1|r2|r3|r4>   batch 模式必填
 *   --file <path>           用另一份提示词正文做对照（**不改** prompts.json，也不落盘）
 *   --out <path>            把结果 JSON 写到文件
 *   --outdir <dir>          batch 模式每篇一个文件写到这里
 *   --json                  原样打印结果 JSON
 *   --server <url>          默认 http://127.0.0.1:4173
 *   --env <name>            默认 local
 *   --timeout <ms>          默认 600000
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const argv = process.argv.slice(2);
// 带值的选项必须在这里登记，否则它的值会被当成位置参数（投稿 id）
const OPTS_WITH_VALUE = new Set(["stage", "file", "out", "outdir", "server", "env", "timeout", "from", "thread"]);
const PARSED = (() => {
  const pos = [], flags = new Set(), vals = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const name = a.slice(2);
    if (OPTS_WITH_VALUE.has(name)) { vals[name] = argv[++i]; } else flags.add(name);
  }
  return { pos, flags, vals };
})();
const opt = (name, dflt) => (PARSED.vals[name] !== undefined ? PARSED.vals[name] : dflt);
const flag = (name) => PARSED.flags.has(name);
const SERVER = opt("server", process.env.LAB_URL || "http://127.0.0.1:4173").replace(/\/+$/, "");
const ENV = opt("env", "local");
const TIMEOUT = Number(opt("timeout", "600000"));
const AS_JSON = flag("json");

const STAGE = {
  r1: { endpoint: "/api/run/review/round1", base: () => ({}), preview: true },
  r2: { endpoint: "/api/run/review/round2", base: (m, o) => ({ review: need((o && o.review) || (m.proposal && m.proposal.value), "提案") }), preview: true },
  r3: { endpoint: "/api/run/polish", base: (m, o) => ({ scripts: need((o && o.scripts) || (m.scripts && m.scripts.length ? m.scripts : null), "脚本") }), preview: true },
  r4: { endpoint: "/api/run/publish", base: (m, o) => ({ script: need((o && o.script) || (m.scripts || [])[0] || null, "脚本"), fillOnly: true }), preview: true },
};

/** 从 r1 的产物里挑一条线，做成 r2 要的提案（thread 省略 → 用模型推荐的那条） */
function buildReview(r1raw, threadN) {
  const r1 = (r1raw && r1raw.result) || r1raw || {};     // 兼容 dryrun 自己的输出包裹与裸的 r1 结果
  const th = (r1 && r1.exploration_threads) || [];
  if (!th.length) throw new Error("这份 r1 结果里没有 exploration_threads");
  let src, recommended;
  if (threadN) {
    const i = Number(threadN) - 1;
    if (!(i >= 0 && i < th.length)) throw new Error("--thread 只有 1–" + th.length);
    src = th[i]; recommended = false;
  } else {
    src = th.filter((t) => t.id === (r1 && r1.recommended_thread_id))[0] || th[0];
    recommended = true;
  }
  const F8 = ["core_question", "initial_state", "central_tension", "exploration", "turning_point", "possible_discovery", "ending_state", "open_question"];
  const cp = {};
  for (const k of F8) cp[k] = src[k] || "";
  cp.title = src.title || "";
  cp.thread_id = src.id || src.thread_id || "";
  cp.score = src.score || null;
  cp.evidence = src.evidence || null;
  cp.editorial_reason = src.editorial_reason || "";
  cp.recommended_duration = ((r1 && r1.creative_proposal) || {}).recommended_duration || src.recommended_duration || { category: "standard", minutes: "8–10" };
  cp.__recommended = recommended;
  return cp;
}

function need(v, what) {
  if (!v) throw new Error("素材包缺少" + what + "——这个环节跑不了（先跑上游环节，或换一篇投稿）");
  return v;
}

async function api(path, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(SERVER + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-lab-env": ENV, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const txt = await res.text();
    let json = null;
    try { json = JSON.parse(txt); } catch { /* 非 JSON */ }
    if (!json) throw new Error("服务端返回非 JSON（HTTP " + res.status + "）：" + txt.slice(0, 200));
    if (!json.ok && json.error) throw new Error(json.error);
    return json;
  } finally { clearTimeout(t); }
}

/** 列出投稿：dryrun 的前提是先找到 id */
async function listSubmissions(keyword) {
  const out = [];
  for (const page of [1, 2]) {
    const d = await api("/api/submissions?page=" + page + "&pageSize=100");
    const rows = d.rows || [];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  const kw = keyword ? String(keyword).toLowerCase() : null;
  return out.filter((r) => !kw || String(r.title || "").toLowerCase().includes(kw) || String(r.id).startsWith(kw));
}

/** 允许只写前 8 位（界面上显示的就是 8 位）；不足 36 位时去投稿列表里补全 */
async function resolveId(id) {
  if (!id) throw new Error("缺投稿 id");
  if (id.length >= 36) return id;
  const rows = await listSubmissions(null);
  const hit = rows.filter((r) => String(r.id).startsWith(id));
  if (hit.length === 1) return hit[0].id;
  if (!hit.length) throw new Error("找不到投稿 " + id);
  throw new Error(id + " 匹配到 " + hit.length + " 篇，请多写几位：" + hit.slice(0, 4).map((r) => r.id.slice(0, 12)).join(" / "));
}

/** 老服务端没有 /api/dryrun/material 时，客户端自己从 /api/detail 拼一份（行为完全一致，不写任何状态） */
async function materialFallback(full) {
  const d = await api("/api/detail/" + full);
  const det = d.detail || {};
  const prod = d.production || {};
  const msgs = (d.dialogue && d.dialogue.messages) || [];
  let proposal = null, source = null;
  if (det.review && det.review.core_question) { proposal = det.review; source = "review"; }
  else {
    const rp = prod.reviewProposals || null;
    if (rp && Array.isArray(rp.proposals) && rp.proposals.length) {
      const rec = rp.creative_proposal || {};
      const rid = rp.recommended_thread_id || rec.thread_id || "";
      const src = rp.proposals.filter((p) => p.thread_id === rid)[0] || rp.proposals[0];
      proposal = Object.assign({}, src, { recommended_duration: rec.recommended_duration || src.recommended_duration || null });
      source = "reviewProposals";
    }
  }
  const scripts = (d.prodSummary && Array.isArray(d.prodSummary.scriptList) && d.prodSummary.scriptList.length)
    ? d.prodSummary.scriptList
    : (Array.isArray(det.reviewScripts) ? det.reviewScripts : []);
  const miss = (a) => a.filter(Boolean);
  return {
    ok: true, mode: "dryrun（客户端拼装：服务端版本较旧）", writes: "none", id: full,
    title: det.title || (d.dialogue && d.dialogue.title) || null,
    stage: det.status || null, language: det.language || null,
    host: { callName: det.callName || null },
    guest: (det.guest && { id: det.guest.id, name: det.guest.name }) || null,
    dialogue: {
      sourceUrl: (d.dialogue && d.dialogue.sourceUrl) || null,
      source: (d.dialogue && d.dialogue.source) || null,
      title: (d.dialogue && d.dialogue.title) || null,
      count: msgs.length, messages: msgs,
    },
    proposal: { source, value: proposal },
    scripts, prompts: {},
    stages: {
      r1: { endpoint: "POST /api/run/review/round1", ready: msgs.length > 0, needs: miss([!msgs.length && "对话原文"]) },
      r2: { endpoint: "POST /api/run/review/round2", ready: msgs.length > 0 && !!proposal, needs: miss([!msgs.length && "对话原文", !proposal && "提案（锁定稿或 reviewProposals）"]) },
      r3: { endpoint: "POST /api/run/polish", ready: scripts.length > 0, needs: miss([!scripts.length && "脚本"]) },
      r4: { endpoint: "POST /api/run/publish（fillOnly）", ready: scripts.length > 0, needs: miss([!scripts.length && "脚本"]) },
    },
  };
}

const material = async (id) => {
  const full = await resolveId(id);
  try {
    return await api("/api/dryrun/material/" + full);
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (!/未知端点|404|not found/i.test(msg)) throw e;   // 只有"这条路由不存在"才降级
    return await materialFallback(full);
  }
};

/** 干跑一个环节：先 preview 拿渲染好的 messages，必要时换掉提示词正文，再真跑一次 */
async function runStage(stage, id, mat, fileOverride, opts) {
  const s = STAGE[stage];
  if (!s) throw new Error("未知环节：" + stage + "（可选 r1/r2/r3/r4）");
  const base = s.base(mat, opts || {});
  const t0 = Date.now();
  const pv = await api(s.endpoint, Object.assign({ id }, base, { preview: true }));
  if (!pv.preview || !Array.isArray(pv.preview.messages)) throw new Error("该环节没有返回 preview.messages");
  let messages = pv.preview.messages;
  let usedFile = pv.preview.config && pv.preview.name ? (mat.prompts && Object.values(mat.prompts).find((p) => p.name === pv.preview.name) || {}).file || null : null;
  if (fileOverride) {
    const doc = readFileSync(resolve(fileOverride), "utf8");
    const idx = messages.map((m) => m.role).lastIndexOf("user");
    if (idx < 0) throw new Error("渲染结果里没有 user 消息，无法替换提示词正文");
    messages = messages.map((m, i) => (i === idx ? { role: m.role, content: doc } : m));
    usedFile = fileOverride + "（覆盖，未落盘）";
  }
  const out = await api(s.endpoint, Object.assign({ id }, base, { messages }));
  const ms = Date.now() - t0;
  return { stage, id, ms, usedFile, result: out.result || out, usage: out.usage || null };
}

function summarize(stage, result) {
  const segs = (result && Array.isArray(result.segments)) ? result.segments : null;
  const sc = (result && Array.isArray(result.scripts)) ? result.scripts[0] : result;
  const ep = (sc && sc.episode) || (result && result.episode) || null;
  const lines = [];
  if (ep && ep.title) lines.push("标题  " + ep.title);
  const list = segs || (sc && Array.isArray(sc.segments) ? sc.segments : null);
  if (list && list.length) {
    const chars = list.reduce((a, x) => a + String(x.text || "").length, 0);
    lines.push("段数  " + list.length + " ｜ 字符 " + chars);
    for (const x of list.slice(0, 3)) lines.push("  " + (x.speaker === "host" ? "主持" : "嘉宾") + "｜" + String(x.text || "").slice(0, 90));
  }
  if (stage === "r1") {
    const th = (result && result.exploration_threads) || [];
    const rec = (result && result.recommended_thread_id) || "";
    lines.push("这条投稿给出 " + th.length + " 个提案，挑一条喂给 r2：");
    th.forEach((x, i) => lines.push("  " + (i + 1) + ") " + String(x.title || "").slice(0, 60) + (x.id === rec ? "   ★模型推荐" : "")));
    lines.push("用法：--from <这份r1结果.json> --thread <上面那个序号>");
  }
  if (stage === "r4" && result && !list) lines.push(JSON.stringify(result).slice(0, 300));
  return lines.join("\n");
}

function writeOut(path, obj) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), JSON.stringify(obj, null, 1));
}


/* ─────────────────────────  完整流程（向导）  ───────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 上下键选择；不是终端时退化成输入序号 */
async function choose(title, items, allowBack) {
  const labels = items.map((x) => (typeof x === "string" ? x : x.label));
  const hints = items.map((x) => (typeof x === "string" ? "" : x.hint || ""));
  if (!process.stdin.isTTY) {
    // 非终端（管道/重定向）：整条流只读一次，逐行发号，避免每次新建 readline 把缓冲吃掉
    for (let i = 0; i < labels.length; i++) console.log("  " + (i + 1) + ") " + labels[i] + (hints[i] ? "   " + hints[i] : ""));
    if (!choose._lines) {
      choose._lines = [];
      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin });
      await new Promise((done) => {
        rl.on("line", (l) => choose._lines.push(l));
        rl.on("close", done);
        if (process.stdin.readableEnded) done();
      });
    }
    const ans = String(choose._lines.shift() || "").trim();
    if (allowBack && /^b$/i.test(ans)) return -1;
    const n = Number(ans);
    return Number.isFinite(n) && n >= 1 && n <= labels.length ? n - 1 : 0;
  }
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  readline.emitKeypressEvents(process.stdin, rl);
  process.stdin.setRawMode(true);
  let cur = 0, drawn = 0;
  const paint = () => {
    if (drawn) process.stdout.write("\x1b[" + drawn + "A\x1b[J");
    const out = [title];
    labels.forEach((l, i) => out.push((i === cur ? "  \x1b[7m▸ " + l + "\x1b[0m" : "    " + l) + (hints[i] ? "   \x1b[2m" + hints[i] + "\x1b[0m" : "")));
    out.push("  \x1b[2m↑↓ 选择 · Enter 确认" + (allowBack ? " · b 返回" : "") + "\x1b[0m");
    process.stdout.write(out.join("\n") + "\n");
    drawn = out.length;
  };
  paint();
  return await new Promise((resolve) => {
    const done = (v) => { process.stdin.setRawMode(false); process.stdin.removeListener("keypress", onKey); rl.close(); resolve(v); };
    const onKey = (str, key) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") { done(-2); process.exit(130); }
      if (key.name === "up" || key.name === "k") { cur = (cur - 1 + labels.length) % labels.length; paint(); }
      else if (key.name === "down" || key.name === "j") { cur = (cur + 1) % labels.length; paint(); }
      else if (key.name === "return" || key.name === "enter") { done(cur); }
      else if (allowBack && (key.name === "b" || key.name === "escape")) { done(-1); }
    };
    process.stdin.on("keypress", onKey);
  });
}

/** 把一版脚本全文打出来 */
function printScript(script, heading) {
  const segs = (script && (script.segments || script.script)) || [];
  const ep = (script && script.episode) || {};
  console.log("\n" + "═".repeat(64));
  if (heading) console.log(heading);
  if (ep.title) console.log("标题　" + ep.title);
  if (ep.hook) console.log("钩子　" + ep.hook);
  console.log("─".repeat(64));
  segs.forEach((g, i) => {
    const who = String(g.speaker).toLowerCase() === "host" ? "主持" : "嘉宾";
    console.log(String(i + 1).padStart(2, "0") + " " + who + "｜" + g.text);
  });
  console.log("─".repeat(64) + "\n共 " + segs.length + " 段\n");
}

/** 一个投稿走完全程：R1 选提案 → R2 脚本 → (R3 打磨) → (R4 发布文案) */
async function flow(rawId) {
  const id = await resolveId(rawId);
  const m = await material(id);
  console.log("\n投稿　" + id + "\n标题　" + (m.title || "") + "\n");

  // —— R1 ——
  console.log("① 提案生成中…");
  const t1 = Date.now();
  let r1;
  try { r1 = await runStage("r1", id, m, null, {}); }
  catch (e) { console.log("提案没出来：" + e.message); return; }
  const th = (r1.result && r1.result.exploration_threads) || [];
  if (!th.length) { console.log("这条投稿没给出提案（" + ((r1.result && r1.result.eligibility && r1.result.eligibility.reason) || "无说明") + "）"); return; }
  console.log("　✓ " + ((Date.now() - t1) / 1000).toFixed(0) + "s，给出 " + th.length + " 条\n");
  const pick = await choose("挑一条提案（Enter 确认）", th.map((t) => ({ label: String(t.title || "").slice(0, 70), hint: t.id === r1.result.recommended_thread_id ? "★模型推荐" : "" })));
  if (pick < 0) return;
  const review = buildReview(r1.result, String(pick + 1));
  console.log("\n已选：" + review.title);

  // —— R2 ——
  console.log("\n② 脚本创作中…");
  let r2;
  try { r2 = await runStage("r2", id, m, null, { review }); }
  catch (e) { console.log("脚本没出来：" + e.message + "（可重跑）"); return; }
  let cur = (r2.result.scripts || [])[0] || null;
  if (!cur) { console.log("脚本没出来（模型这次没给 script 数组）—— 重跑一次通常就有。"); return; }
  printScript(cur, "脚本");

  // —— 菜单循环 ——
  for (;;) {
    const menu = [{ label: "打磨脚本" }, { label: "生成发布文案" }, { label: "退出" }];
    const k = await choose("下一步", menu);
    if (k === -1 || k === 2) { console.log("\n结束。"); return; }

    if (k === 0) {
      console.log("\n③ 脚本打磨中…");
      let r3;
      try { r3 = await runStage("r3", id, m, null, { scripts: [{ segments: cur.segments }] }); }
      catch (e) { console.log("打磨失败：" + e.message); continue; }
      const segs = (r3.result && (r3.result.segments || (r3.result.script && r3.result.script.segments))) || null;
      if (!segs) { console.log("打磨没返回 segments。"); continue; }
      cur = Object.assign({}, cur, { segments: segs });
      printScript(cur, "打磨后脚本");
      continue;
    }

    if (k === 1) {
      console.log("\n④ 发布文案生成中…");
      let r4;
      try { r4 = await runStage("r4", id, m, null, { script: cur }); }
      catch (e) { console.log("发布文案失败：" + e.message); continue; }
      const meta = r4.result && r4.result.result ? r4.result.result : r4.result;
      console.log("\n" + "═".repeat(64));
      console.log("发布文案");
      console.log("─".repeat(64));
      if (meta && typeof meta === "object") {
        for (const [kk, vv] of Object.entries(meta)) console.log(kk + "：\n  " + String(vv).replace(/\n/g, "\n  ") + "\n");
      } else console.log(String(meta));
      const again = await choose("还要做什么", [{ label: "回去继续打磨" }, { label: "退出" }]);
      if (again === 0) continue;
      console.log("\n结束。");
      return;
    }
  }
}

(async () => {
  const cmd = PARSED.pos[0];
  const ids = PARSED.pos.slice(1);
  const KNOWN = ["list", "material", "all", "batch", "r1", "r2", "r3", "r4"];

  // 不带已知命令 → 直接当投稿 id，走完整流程（向导）
  if (cmd && !KNOWN.includes(cmd)) { await flow(cmd); return; }
  if (cmd === "run") { await flow(need(ids[0], "投稿 id")); return; }
  const file = opt("file", null);

  if (cmd === "list") {
    const rows = await listSubmissions(ids[0] || null);
    console.log("共 " + rows.length + " 篇    （下面这一列就是投稿 id，直接复制给命令用）");
    for (const r of rows) console.log("  " + r.id + "  " + String(r.stage || "?").padEnd(10) + "  " + String(r.title || "(无标题)").slice(0, 40));
    return;
  }

  if (cmd === "material") {
    const m = await material(need(ids[0], "投稿 id"));
    const out = opt("out", null);
    if (out) writeOut(out, m);
    if (AS_JSON || out) console.log(JSON.stringify(m, null, 1).slice(0, AS_JSON ? undefined : 0) || "");
    else {
      console.log("投稿    " + m.id.slice(0, 8) + "  " + (m.title || "") + "  [" + (m.stage || "?") + "]");
      console.log("对话    " + m.dialogue.count + " 条" + (m.dialogue.messages.length ? "（前 2 条）" : ""));
      for (const x of m.dialogue.messages.slice(0, 2)) console.log("   " + x.role + ": " + String(x.content).slice(0, 80));
      console.log("提案    " + (m.proposal.source || "无") + (m.proposal.value && m.proposal.value.core_question ? "  " + String(m.proposal.value.core_question).slice(0, 70) : ""));
      console.log("脚本    " + m.scripts.length + " 版" + (m.scripts[0] ? "（" + (m.scripts[0].segments || []).length + " 段）" : ""));
      console.log("环节    " + Object.keys(m.stages).map((k) => k + (m.stages[k].ready ? "✓" : "✗")).join("  "));
      if (out) console.log("已写    " + out);
    }
    return;
  }

  const stages = cmd === "all" ? ["r1", "r2", "r3", "r4"] : cmd === "batch" ? [need(opt("stage", null), "batch 模式要 --stage")] : [cmd];
  const targets = need(ids.length ? ids : null, "投稿 id");
  const outdir = opt("outdir", null);
  const fromFile = opt("from", null);
  const opts = {};
  if (fromFile) opts.review = buildReview(JSON.parse(readFileSync(resolve(fromFile), "utf8")), opt("thread", null));

  for (const rawId of targets) {
    const id = await resolveId(rawId);          // 只写前 8 位也行；补全后再传给各环节端点
    const m = await material(id);
    for (const st of stages) {
      try {
        const r = await runStage(st, id, m, file, opts);
        const label = st + "  " + id + "  " + (r.ms / 1000).toFixed(1) + "s" + (r.usedFile ? "  提示词=" + r.usedFile : "");
        if (AS_JSON) console.log(JSON.stringify(r, null, 1));
        else { console.log("─".repeat(60)); console.log(label); const s = summarize(st, r.result); if (s) console.log(s); }
        const out = opt("out", null) || (outdir ? outdir.replace(/\/+$/, "") + "/dryrun-" + st + "-" + id.slice(0, 8) + ".json" : null);
        if (out) writeOut(out, r);
      } catch (e) {
        console.log("─".repeat(60));
        console.log(st + "  " + id + "  失败：" + String(e.message || e));
      }
    }
  }
})().catch((e) => { console.error("dryrun 失败：" + String(e.message || e)); process.exit(1); });
