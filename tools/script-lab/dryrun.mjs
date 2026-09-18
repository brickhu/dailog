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
 *   node tools/script-lab/dryrun.mjs material <id>                    取素材包（JSON）
 *   node tools/script-lab/dryrun.mjs r2 <id> [--file prompts/x.md]    干跑一个环节
 *   node tools/script-lab/dryrun.mjs all <id>                         四个环节依次干跑
 *   node tools/script-lab/dryrun.mjs batch <id...> --stage r2 [--outdir /tmp]
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
const opt = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
const flag = (name) => argv.includes("--" + name);
const SERVER = opt("server", process.env.LAB_URL || "http://127.0.0.1:4173").replace(/\/+$/, "");
const ENV = opt("env", "local");
const TIMEOUT = Number(opt("timeout", "600000"));
const AS_JSON = flag("json");

const STAGE = {
  r1: { endpoint: "/api/run/review/round1", base: () => ({}), preview: true },
  r2: { endpoint: "/api/run/review/round2", base: (m) => ({ review: need(m.proposal && m.proposal.value, "提案") }), preview: true },
  r3: { endpoint: "/api/run/polish", base: (m) => ({ scripts: need(m.scripts && m.scripts.length ? m.scripts : null, "脚本") }), preview: true },
  r4: { endpoint: "/api/run/publish", base: (m) => ({ script: need((m.scripts || [])[0] || null, "脚本"), fillOnly: true }), preview: true },
};

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

const material = (id) => api("/api/dryrun/material/" + id);

/** 干跑一个环节：先 preview 拿渲染好的 messages，必要时换掉提示词正文，再真跑一次 */
async function runStage(stage, id, mat, fileOverride) {
  const s = STAGE[stage];
  if (!s) throw new Error("未知环节：" + stage + "（可选 r1/r2/r3/r4）");
  const base = s.base(mat);
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
    lines.push("线程  " + th.length + " ｜ 推荐 " + ((result && result.recommended_thread_id) || "—"));
    for (const x of th) lines.push("  · " + String(x.title || "").slice(0, 70));
  }
  if (stage === "r4" && result && !list) lines.push(JSON.stringify(result).slice(0, 300));
  return lines.join("\n");
}

function writeOut(path, obj) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), JSON.stringify(obj, null, 1));
}

(async () => {
  const cmd = argv[0];
  const ids = argv.slice(1).filter((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--stage" && argv[argv.indexOf(a) - 1] !== "--file" && argv[argv.indexOf(a) - 1] !== "--out" && argv[argv.indexOf(a) - 1] !== "--outdir" && argv[argv.indexOf(a) - 1] !== "--server" && argv[argv.indexOf(a) - 1] !== "--env" && argv[argv.indexOf(a) - 1] !== "--timeout");
  const file = opt("file", null);

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

  for (const id of targets) {
    const m = await material(id);
    for (const st of stages) {
      try {
        const r = await runStage(st, id, m, file);
        const label = st + "  " + id.slice(0, 8) + "  " + (r.ms / 1000).toFixed(1) + "s" + (r.usedFile ? "  提示词=" + r.usedFile : "");
        if (AS_JSON) console.log(JSON.stringify(r, null, 1));
        else { console.log("─".repeat(60)); console.log(label); const s = summarize(st, r.result); if (s) console.log(s); }
        const out = opt("out", null) || (outdir ? outdir.replace(/\/+$/, "") + "/dryrun-" + st + "-" + id.slice(0, 8) + ".json" : null);
        if (out) writeOut(out, r);
      } catch (e) {
        console.log("─".repeat(60));
        console.log(st + "  " + id.slice(0, 8) + "  失败：" + String(e.message || e));
      }
    }
  }
})().catch((e) => { console.error("dryrun 失败：" + String(e.message || e)); process.exit(1); });
