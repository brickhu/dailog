// 观点错位检测：原文里某人的观点句，在稿子里必须由同一个人说
import fs from "node:fs";
const strip = s => String(s).replace(/\[citation:\d+\]/g, "").replace(/\*\*|__|`|^#+\s*/g, "").replace(/\s+/g, "").trim();
const VIEW = /(是|要|不要|不能|应该|关键|核心|最好|建议|其实|就是|不在于|必须|别|不想|更|最)/;
const samples = { 2: "/tmp/e2e-2.json", 3: "/tmp/e2e-3.json", 4: "/tmp/e2e-4.json", 6: "/tmp/e2e-6.json", 10: "/tmp/e2e-10.json" };
const prefix = process.argv[2] || "/tmp/new";
function viewpoints(src) {
  const out = [];
  for (const m of src) {
    const role = m.role === "user" ? "host" : "guest";
    for (const clause of String(m.content).split(/[。！？；\n]/)) {
      const t = strip(clause);
      if (t.length < 8 || t.length > 24) continue;
      if (/[？?]|什么样|怎么|为什么|多少|吗$|呢$/.test(t)) continue;   // 疑问不算观点
      if (!VIEW.test(t)) continue;
      out.push({ role, text: t });
    }
  }
  return out;
}
let total = 0, matched = 0, wrong = 0;
const wrongList = [];
for (const [n, path] of Object.entries(samples)) {
  const src = JSON.parse(fs.readFileSync(path, "utf8")).messages;
  const out = JSON.parse(fs.readFileSync(prefix + n + ".json", "utf8"));
  const lines = out.lines.map(l => ({ speaker: l.speaker, text: strip(l.text) }));
  for (const v of viewpoints(src)) {
    const key = v.text.slice(0, 10);
    const hit = lines.find(l => l.text.includes(key));
    if (!hit) continue;
    total++;
    if (hit.speaker === v.role) matched++;
    else { wrong++; wrongList.push("e2e-" + n + " 原文[" + (v.role === "host" ? "主持人" : "嘉宾") + "]「" + v.text.slice(0, 18) + "」→ 稿里由" + (hit.speaker === "host" ? "主持人" : "嘉宾") + "说"); }
  }
}
console.log("可定位的观点句 " + total + " 句：归属正确 " + matched + "，错位 " + wrong);
wrongList.slice(0, 12).forEach(w => console.log("  ✗ " + w));