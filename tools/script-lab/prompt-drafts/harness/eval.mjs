// 评测（新标准里机器能查的部分）：情绪标记保留、主题词覆盖、回合数、字数、数字一致
import fs from "node:fs";
const strip = s => String(s).replace(/\[citation:\d+\]/g, "").replace(/\*\*|__|`|^#+\s*/g, "").replace(/\s+/g, "").trim();
const STOP = new Set(["我们","他们","这个","那个","什么","自己","一个","这样","其实","然后","所以","因为","如果","可以","不会","没有","已经","还是","不是","这种","问题","东西","时候","现在","知道","觉得","可能","应该","就是","但是","而且","比如","如果","这些","那些","非常","特别","主要","需要","进行","通过","对于","关于","这样","那样","怎么","为什么","什么样"]);
const samples = { 2: "/tmp/e2e-2.json", 3: "/tmp/e2e-3.json", 4: "/tmp/e2e-4.json", 6: "/tmp/e2e-6.json", 10: "/tmp/e2e-10.json" };
const prefix = process.argv[2] || "/tmp/new";
function markersOf(src) {
  const out = new Set();
  for (const m of src.filter(x => x.role === "user")) {
    const c = String(m.content);
    for (const mm of c.matchAll(/[\u4e00-\u9fa5]{2,6}个屁/g)) out.add(mm[0]);
    for (const w of ["太复杂", "太难", "不行", "不好", "废话", "算了", "不想做", "没必要", "不靠谱"]) if (c.includes(w)) out.add(w);
    for (const s of c.split(/[。！？\n]/)) { const t = s.trim(); if (/^(难|对|嗯|不|是)$/.test(t)) out.add(t); }
  }
  return [...out];
}
function termsOf(src) { // 原文里的特征话题词（2-4 字、出现≥2 次）
  const c = src.map(m => strip(m.content)).join("");
  const count = new Map();
  for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= c.length; i++) { const g = c.slice(i, i + n); if ([...g].every(ch => /[\u4e00-\u9fa5]/.test(ch)) && !STOP.has(g)) count.set(g, (count.get(g) || 0) + 1); }
  const sorted = [...count.entries()].filter(([g, c2]) => c2 >= 3 && g.length >= 3).sort((a, b) => b[1] - a[1]);
  const picked = [];
  for (const [g] of sorted) { if (picked.some(p => p.includes(g) || g.includes(p))) continue; picked.push(g); if (picked.length >= 25) break; }
  return picked;
}
const nums = s => (String(s).match(/\d[\d,]*(?:\.\d+)?/g) || []).map(x => Number(x.replace(/,/g, "")));
let totM = 0, hitM = 0, totT = 0, hitT = 0, badNum = 0, allTurns = [], allChars = [];
const detail = [];
for (const [n, path] of Object.entries(samples)) {
  const src = JSON.parse(fs.readFileSync(path, "utf8")).messages;
  const out = JSON.parse(fs.readFileSync(prefix + n + ".json", "utf8"));
  const text = out.lines.map(l => strip(l.text)).join("|");
  const mk = markersOf(src), kept = mk.filter(m => text.includes(m));
  const terms = termsOf(src), cov = terms.filter(t => text.includes(t));
  const srcNums = new Set(nums(src.map(m => m.content).join("")));
  const bad = [...new Set(nums(text))].filter(x => !srcNums.has(x) && x > 1);
  const turns = out.lines.filter(l => l.speaker === "host").length - 2;
  const chars = out.lines.reduce((a, x) => a + strip(x.text).length, 0);
  totM += mk.length; hitM += kept.length; totT += terms.length; hitT += cov.length; badNum += bad.length;
  allTurns.push(turns); allChars.push(chars);
  detail.push("e2e-" + n + " 情绪 " + kept.length + "/" + mk.length + " 主题词 " + cov.length + "/" + terms.length + " 回合 " + turns + " 字数 " + chars + " 越界数字 " + (bad.join(",") || "无"));
}
detail.forEach(d => console.log("  " + d));
console.log("情绪标记保留 " + hitM + "/" + totM + "；主题词覆盖 " + hitT + "/" + totT + " = " + Math.round(hitT / Math.max(1, totT) * 100) + "%；越界数字 " + badNum + " 处");