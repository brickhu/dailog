// 编造候选检测：稿子里"主持人说的判断句"，在原文他自己那部分里有没有根据
import fs from "node:fs";
const strip = s => String(s).replace(/\[citation:\d+\]/g, "").replace(/\*\*|__|`|^#+\s*/g, "").replace(/\s+/g, "").trim();
function grams(s, n = 2) { const t = strip(s); const out = new Map(); for (let i = 0; i + n <= t.length; i++) { const g = t.slice(i, i + n); out.set(g, (out.get(g) || 0) + 1); } return out; }
function cover(text, source) {
  const A = grams(text), B = grams(source);
  let hit = 0, total = 0;
  for (const [g, c] of A) { total += c; if (B.has(g)) hit += c; }
  return total ? hit / total : 0;
}
const samples = { 2: "/tmp/e2e-2.json", 3: "/tmp/e2e-3.json", 4: "/tmp/e2e-4.json", 6: "/tmp/e2e-6.json", 10: "/tmp/e2e-10.json" };
const prefix = process.argv[2] || "/tmp/new";
const SKEL = /^大家好，我是|^感谢大家收听|^OK，感谢|^不客气|^好，那么我们就聊到这里/;
let flagged = 0, checked = 0;
for (const [n, path] of Object.entries(samples)) {
  const src = JSON.parse(fs.readFileSync(path, "utf8")).messages;
  const hostSrc = strip(src.filter(m => m.role === "user").map(m => m.content).join(""));
  const guestSrc = strip(src.filter(m => m.role === "assistant").map(m => m.content).join(""));
  const out = JSON.parse(fs.readFileSync(prefix + n + ".json", "utf8"));
  const list = [];
  for (const l of out.lines) {
    const t = strip(l.text);
    if (SKEL.test(t)) continue;
    if (/[？?]$/.test(t)) continue;                    // 问句不算表态
    if (t.length < 8) continue;
    const mine = l.speaker === "host" ? hostSrc : guestSrc;
    const other = l.speaker === "host" ? guestSrc : hostSrc;
    const c = cover(t, mine), c2 = cover(t, other);
    checked++;
    if (c < 0.35 && c2 < 0.5) { flagged++; list.push((l.speaker === "host" ? "主持人" : "嘉宾") + "（自述依据 " + Math.round(c * 100) + "%）」" + t.slice(0, 40) + "」"); }
  }
  if (list.length) { console.log("e2e-" + n + " 需人核：" + list.length + " 句"); list.slice(0, 4).forEach(x => console.log("    " + x)); }
}
console.log("\n判断句共 " + checked + " 句，需人核（可能编造）" + flagged + " 句 = " + Math.round(flagged / Math.max(1, checked) * 100) + "%");