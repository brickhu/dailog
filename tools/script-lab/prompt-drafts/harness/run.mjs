// 一次调用出稿 + 程序拼壳 + 两条校验 + 有问题回灌重写一次。
// 用法：node run.mjs <sample.json> [r1.txt] <outPrefix>
import fs from "node:fs";
import { checkScript, formatReport } from "./gates.mjs";
import { report as healthReport } from "./metrics.mjs";

const env = Object.fromEntries(fs.readFileSync("/Users/free/Projects/dailogues/tools/script-lab/.env", "utf8").split("\n")
  .filter(l => l.includes("=") && !l.trim().startsWith("#"))
  .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["\x27]|["\x27]$/g, "")]; }));
const D = "/Users/free/Projects/dailogues/tools/script-lab/prompt-drafts/";
const [, , samplePath, r1Path, outPrefix] = process.argv;
const sample = JSON.parse(fs.readFileSync(samplePath, "utf8"));
const r1 = r1Path ? JSON.parse(fs.readFileSync(r1Path, "utf8").replace(/```json/, "").replace(/```/, "").trim()) : null;
const proposal = r1 ? r1.proposals[0] : null;
const messages = sample.messages;
const argOf = (name) => { const hit = process.argv.find(a => a.startsWith("--" + name + "=")); return hit ? hit.split("=").slice(1).join("=") : ""; };
// 嘉宾名：参数 → 样本字段 → 从来源推断 → 默认
const GUEST_BY_SOURCE = { deepseek: "DeepSeek", doubao: "豆包", chatgpt: "ChatGPT", openai: "ChatGPT", claude: "Claude", gemini: "Gemini", kimi: "Kimi", tongyi: "通义", yuanbao: "元宝" };
const src = ((sample.source || "") + " " + (sample.sourceUrl || "")).toLowerCase();
const inferredGuest = Object.keys(GUEST_BY_SOURCE).find(k => src.includes(k));
const HOST = argOf("host") || sample.host || sample.author || sample.hostName || "飞";
const GUEST = argOf("guest") || sample.guest || sample.guestName || (inferredGuest ? GUEST_BY_SOURCE[inferredGuest] : "") || "DeepSeek";
const BRAND = argOf("brand") || env.BRAND || "dailog";

const strip = s => String(s).replace(/\[citation:\d+\]/g, "").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").replace(/([\u4e00-\u9fa5]) +([\u4e00-\u9fa5])/g, "$1$2").trim();
const sents = m => String(m.content).split(/(?<=[。！？!?])/).map(x => x.trim()).filter(Boolean);
const dialogueBlock = messages.map((m, i) => "[t" + (i + 1) + " " + (m.role === "user" ? HOST : GUEST) + "] " + sents(m).map((s, j) => "t" + (i + 1) + "." + (j + 1) + " " + strip(s)).join(" / ")).join("\n\n");
const contract = proposal ? JSON.stringify({ who: proposal.who, value: proposal.value, endpoint: proposal.endpoint, solve: proposal.solve, 这一期要走完的几步: (proposal.process || []).map(p => p.no + ". " + p.step) }, null, 2) : "（无）";

function fill(t, v) { let s = t; for (const [k, val] of Object.entries(v)) s = s.split("{{" + k + "}}").join(val == null ? "" : String(val)); return s; }
const COMMON = { "host.callName": HOST, "guests.0.name": GUEST, "brand": BRAND };
const system = fill(fs.readFileSync(D + "r2-script.system.draft.md", "utf8"), COMMON);
const user = fill(fs.readFileSync(D + "r2-script.user.draft.md", "utf8"), Object.assign({}, COMMON, {
  "proposal": contract, "dialogue.messages": dialogueBlock, "suggestion": sample.suggestion || "（无）",
}));

async function call(msgs, temperature) {
  const res = await fetch((env.LLM_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "") + "/chat/completions", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + env.LLM_API_KEY },
    body: JSON.stringify({ model: env.LLM_MODEL || "deepseek-v4-flash", messages: msgs, temperature, max_tokens: 12000, thinking: { type: "disabled" }, response_format: { type: "json_object" } }),
  });
  const j = await res.json();
  if (!j.choices) throw new Error("LLM 失败: " + JSON.stringify(j).slice(0, 240));
  const raw = j.choices[0].message.content;
  try { return JSON.parse(raw); }
  catch (e) {
    // 输出被截断或带了多余字符时，再要一次（跑批稳定性，不是校验）
    const retry = await fetch((env.LLM_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "") + "/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + env.LLM_API_KEY },
      body: JSON.stringify({ model: env.LLM_MODEL || "deepseek-v4-flash", messages: msgs.concat([{ role: "user", content: "上一条输出不是合法 JSON（可能被截断）。请只输出那个 JSON 对象本身，不要任何其他文字。" }]), temperature, max_tokens: 12000, thinking: { type: "disabled" }, response_format: { type: "json_object" } }),
    });
    const j2 = await retry.json();
    return JSON.parse(j2.choices[0].message.content);
  }
}

// 说话人由原文那一轮决定；壳由程序按容器模板拼
// 台词由模型创作：按骨架拼成一期（ask＝主持人，answer＝嘉宾）
function assemble(out) {
  const lines = [];
  const push = (speaker, text) => { const t = strip(typeof text === "string" ? text : (text && text.text) || ""); if (t) lines.push({ speaker, kind: "new", text: t }); };
  push("host", out.hostOpen);
  push("guest", out.guestOpen);
  for (const t of out.turns || []) { if (!t) continue; push("host", t.ask); push("guest", t.answer); }
  push("host", out.hostWrap);
  push("guest", out.guestSum);
  push("host", out.hostOutro);
  return lines;
}
function buildShell(lines, topic) {
  const firstHost = lines.find(l => l.speaker === "host");
  const r = firstHost ? resolveSrc(firstHost.src, messages) : null;
  // 起点话题优先用模型设计的 startTopic；没有或太长时，退回 host 首句的第一个短句（兜底，避免又长又剧透）
  let opening = strip(topic || "");
  if (!opening || opening.length > 40) {
    const src = r ? strip(sents(messages[r.turn - 1])[0]) : (firstHost ? firstHost.text : "");
    opening = strip(src.split(/[，,。！？；;]/)[0]).slice(0, 25);
  }
  const frames = ["聊一个我一直没想明白的方向", "聊一个我最近反复推翻自己的方向", "聊一件我总在想的事"];
  return {
    hostOpen: "欢迎收听 " + BRAND + "，我是" + HOST + "。今天请来 dailog 的 AI 嘉宾 " + GUEST + "，" + frames[opening.length % frames.length] + "——" + opening,
    guestOpen: "大家好，我是" + GUEST + "。" + HOST + "，这个话题我也很感兴趣，咱们从你这句开始聊吧。",
    hostClose: "感谢收听 " + BRAND + "，我们下期再见。",
  };
}

const t0 = Date.now();
let out = await call([{ role: "system", content: system }, { role: "user", content: user }], 0.5);
let attempts = 1, report = null, lines = null;
const errors = [];
let best = null; // 三稿里保留最合格的一稿（错误最少；同分取更早的）
for (let round = 0; round < 3; round++) {
  errors.length = 0;
  lines = assemble(out);
  report = checkScript({ lines }, messages);
  report.errors = errors.concat(report.errors);
  report.pass = report.errors.length === 0;
  if (!best || report.errors.length < best.report.errors.length) best = { lines, report, out };
  if (!report.errors.length || round === 2) break;
  const fix = ["这一稿有几处过不了校验，请重写一版并**只改这些地方**：",
    ...report.errors.map(e => "- " + e.message + (e.evidence ? "  <" + e.evidence + ">" : "")),
    "",
    "提醒：整期就是一条线（开场 → 来回 → 收束），骨架句照抄；src 要指到原文真实存在的句子；",
    "顺口可以，但判断词、程度词、否定、数字必须跟出处一致；src:new 只写接话和气口，不许带原文没有的话题。",
    "修法：",
    "- 读稿（READING_ALOUD）：把这一段拆成两段——中间插一句主持人的短追问或应声（20 字以内），嘉宾接着说第二段；",
    "- 回合太多（TOO_MANY_TURNS）：把不承载认知探索的回合并掉或删掉，别逐条念；",
    "- 观点错位（VIEW_MISATTRIBUTED）：这句话原文里是谁说的，就还给谁说——别把嘉宾的判断安到主持人嘴里；",
    "- 数字不对（NUMBER_MISMATCH）：改成原文里的数字，或者干脆去掉这个数字；",
    "- 独白（MONOLOGUE）：同一个人连说三段以上，中间插一句对方的接话；",
    "- 嘉宾从不反问（GUEST_NEVER_ASKS）：让嘉宾至少两个回合把问题问回主持人（一句带问号的话）；",
    "只输出同一个 JSON。",
  ].join("\n");
  out = await call([{ role: "system", content: system }, { role: "user", content: user }, { role: "assistant", content: JSON.stringify(out) }, { role: "user", content: fix }], 0.6);
  attempts++;
}

if (best) { lines = best.lines; report = best.report; out = best.out; }
const shell = {
  hostOpen: lines.length ? lines[0].text : "",
  guestOpen: lines.length > 1 ? lines[1].text : "",
  hostClose: lines.length ? lines[lines.length - 1].text : "",
};
const script = Object.assign({ lines }, shell, { host: HOST, guest: GUEST, lang: "zh", design: out.design || "" });
const rendered = lines.map(l => "[" + (l.speaker === "host" ? "host" : "guest") + "/" + l.kind + (l.src ? " " + l.src : "") + "] " + l.text).join("\n");
fs.writeFileSync(outPrefix + ".json", JSON.stringify(script, null, 2));
fs.writeFileSync(outPrefix + "-rendered.txt", rendered);
fs.writeFileSync(outPrefix + "-gate.txt", formatReport(report));
console.log("耗时 " + (Date.now() - t0) + "ms，写了 " + attempts + " 稿；" + HOST + " × " + GUEST + "（品牌 " + BRAND + "）");
console.log(formatReport(report));
const health = healthReport(messages, lines, proposal);
console.log("体检：情绪标记 " + health.markers + " | 探索链覆盖 " + health.chain + (health.chainMissing.length ? "（漏：" + health.chainMissing.slice(0, 2).map(x => x.slice(0, 12)).join("；") + "）" : "") + " | 观点归属 " + health.attribution + (health.wrong.length ? "（错位 " + health.wrong.length + "）" : "") + " | 需人核 " + health.fabrication + (health.recap ? " | 收尾复盘「" + health.recap + "」" : "") + " | 咬合 " + health.bite.bit + "/" + health.bite.pairs);
console.log("");
console.log(rendered);