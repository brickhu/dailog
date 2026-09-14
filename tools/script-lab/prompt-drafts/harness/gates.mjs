// 机器闸：只查"新标准"里机器能查的部分——结构、回合数、读稿、数字一致。
// 立场/感受/观点是否编造、现场感好不好，机器查不了，归人判。

const SKELETON_RE = /^大家好，我是|^感谢大家收听|^OK，感谢|^好，感谢|^不客气[,，。]?\s*总的来说|^好，[么那]?我们就聊到这里|感谢嘉宾|感谢嘉宾/;
const TEMPLATE_RE = [/我感觉跟你聊(下来|完)/, /最大的收获是/, /受益匪浅/, /希望对你有帮助/];
const UNIT = "个|人|条|位|名|美元|元|块|%|％|月|年|天|次|倍|万|亿|分|头|只|家";

export function strip(s) { return String(s).replace(/\[citation:\d+\]/g, "").replace(/\*\*|__|`|^#+\s*|[-–—]{2,}/g, "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s+/g, " ").replace(/([\u4e00-\u9fa5]) +([\u4e00-\u9fa5])/g, "$1$2").trim(); }
function cnToInt(s) {
  const D = { "零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  const U = { "十": 10, "百": 100, "千": 1000 };
  let total = 0, section = 0, num = 0;
  for (const ch of s) {
    if (ch in D) num = D[ch];
    else if (ch in U) { section += (num === 0 ? 1 : num) * U[ch]; num = 0; }
    else if (ch === "万" || ch === "亿") { total += (section + num) * (ch === "万" ? 10000 : 100000000); section = 0; num = 0; }
  }
  return total + section + num;
}
function extractNumbers(text) {
  const found = new Map();
  const reAr = new RegExp("(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?=(" + UNIT + "))|\\b(\\d{2,}(?:\\.\\d+)?)\\b", "g");
  let m;
  while ((m = reAr.exec(text))) { const raw = (m[1] || m[3] || "").replace(/,/g, ""); if (raw) found.set(raw, Number(raw)); }
  const reCn = new RegExp("[零一二两三四五六七八九十百千万亿]+(?=(" + UNIT + "))", "g");
  while ((m = reCn.exec(text))) { const v = cnToInt(m[0]); if (v > 0) found.set(m[0], v); }
  return found;
}
function coverBigrams(text, source) {
  const A = new Map(), B = new Set();
  for (let i = 0; i + 2 <= text.length; i++) { const x = text.slice(i, i + 2); A.set(x, (A.get(x) || 0) + 1); }
  for (let i = 0; i + 2 <= source.length; i++) B.add(source.slice(i, i + 2));
  let hit = 0, total = 0;
  for (const [x, c] of A) { total += c; if (B.has(x)) hit += c; }
  return total ? hit / total : 0;
}
function isListCount(text, num) {
  const re = /(?:[零一二两三四五六七八九十]+|\d+)/g;
  let m;
  while ((m = re.exec(text))) {
    const val = /^\d+$/.test(m[0]) ? Number(m[0]) : cnToInt(m[0]);
    if (val !== num) continue;
    const clause = text.slice(0, m.index).split(/[。！？；，,]/).pop() || "";
    const items = clause.split("、").map(s => s.trim()).filter(Boolean);
    if (items.length === num) return true;
  }
  return false;
}

// 观点句：原文里某人说过的、带判断的陈述句（疑问句不算观点）
const VIEW_RE = /(是|不要|不能|应该|关键|核心|最好|建议|其实|就是|不在于|必须|不想|根本不|没必要)/;
export function viewpointsOf(messages) {
  const out = [];
  for (const m of messages) {
    const role = m.role === "user" ? "host" : "guest";
    for (const clause of String(m.content).split(/[。！？；\n]/)) {
      const t = strip(clause);
      if (t.length < 8 || t.length > 24) continue;
      if (/[？?]|什么样|怎么|为什么|多少|吗$|呢$/.test(t)) continue;   // 疑问不算观点
      if (!VIEW_RE.test(t)) continue;
      out.push({ role, text: t });
    }
  }
  return out;
}
export function checkScript({ lines }, messages) {
  const errors = [], warnings = [];
  const add = (arr, code, message, evidence) => arr.push({ code, message, evidence });
  const segs = lines || [];
  const dlgNums = new Set(messages.flatMap(m => [...extractNumbers(m.content).values()]).map(String));

  if (!segs.length) { add(errors, "NO_LINES", "lines 为空", ""); return { pass: false, errors, warnings, stats: {} }; }

  segs.forEach((ln, i) => {
    const text = strip(ln.text);
    const tag = "第 " + (i + 1) + " 段（" + (ln.speaker === "host" ? "主持人" : "嘉宾") + "）";
    if (!text) { add(errors, "EMPTY_TEXT", tag + " 是空的", ""); return; }
    if (ln.speaker !== "host" && ln.speaker !== "guest") add(errors, "BAD_SPEAKER", tag + " speaker 非法", "");
    let runLen = 1, runStart = i + 1;
    for (let k = i; k > 0 && segs[k - 1].speaker === ln.speaker; k--) { runLen++; runStart = k; }
    if (runLen === 2) add(warnings, "SAME_SPEAKER", tag + " 与上一段同一人连着说", text.slice(0, 20));
    if (runLen === 3) add(errors, "MONOLOGUE", "第 " + runStart + "-" + (i + 1) + " 段同一人连说——访谈是一来一往，中间要有人接话", text.slice(0, 24));
    // 对手戏里不许出现壳词
    if (i >= 2 && i < segs.length - 3) for (const w of ["欢迎收听", "感谢收听", "下期再见"]) if (text.includes(w)) add(errors, "SHELL_WORD", tag + " 里出现壳词：" + w, "");
    for (const re of TEMPLATE_RE) if (re.test(text)) add(warnings, "TEMPLATE_SENTENCE", tag + " 出现公式化模板句", text.slice(0, 24));
    // 读稿：嘉宾一段太长
    const len = text.length;
    if (ln.speaker === "guest" && !SKELETON_RE.test(text)) {
      if (len > 250) add(errors, "READING_ALOUD", tag + " 一口气说了 " + len + " 字——这是念稿，拆成两句或分到两个回合", text.slice(0, 24));
      else if (len > 200) add(warnings, "ANSWER_LONG", tag + " 说了 " + len + " 字（偏长）", text.slice(0, 22));
    }
    // 数字必须与原文一致
    for (const [raw, n] of extractNumbers(text)) {
      if (dlgNums.has(String(n))) continue;
      if (isListCount(text, n)) continue;
      if (text.includes("第" + raw)) continue;   // 序数（"第二个 action"）不是数据
      add(errors, "NUMBER_MISMATCH", tag + " 的数字 " + n + " 在原文里没有——不能把 100 写成 200", text.slice(0, 26));
    }
  });

  if (!/感谢大家收听/.test(strip(segs[segs.length - 1].text))) add(errors, "CLOSING_SHAPE", "最后一句不是收播语", strip(segs[segs.length - 1].text).slice(0, 22));

  const hostN = segs.filter(s => s.speaker === "host").length, guestN = segs.filter(s => s.speaker === "guest").length;
  const turns = Math.min(hostN - 2, guestN - 2);
  if (turns > 20) add(errors, "TOO_MANY_TURNS", "对手戏 " + turns + " 个回合（上限 20）", "");
  else if (turns > 16) add(warnings, "MANY_TURNS", "对手戏 " + turns + " 个回合（偏多）", "");
  if (turns < 8) add(warnings, "FEW_TURNS", "对手戏只有 " + turns + " 个回合（这类素材通常该有 8-20 个）", "");

  const chars = segs.reduce((a, l) => a + strip(l.text).length, 0);
  if (chars > 4000) add(errors, "TOO_LONG", "全篇 " + chars + " 字——一期装不下这么多，砍回合", "");
  else if (chars > 3600) add(warnings, "LONG", "全篇 " + chars + " 字（偏长）", "");

  // 悬空指代：说「第三种方案」时，前面得出现过「第一种方案」
  {
    const text = segs.map(l => strip(l.text)).join("|");
    for (const m of text.matchAll(/第([二三四五六七八九十])种(方案|做法|思路|路子)/g)) {
      const first = text.indexOf("第一种" + m[2]);
      if (first < 0) add(errors, "DANGLING_ORDINAL", "稿里说「第" + m[1] + "种" + m[2] + "」，但前面从没出现过「第一种" + m[2] + "」——听众不知道这是哪几种", m[0]);
    }
  }

  // 嘉宾整场至少要问回主持人两次（避免嘉宾一路"给结论+列要点"）
  const guestAsks = segs.filter(l => l.speaker === "guest" && /[？?]$/.test(strip(l.text))).length;
  const needAsks = turns >= 12 ? 2 : 1;   // 短的一期只要 1 次
  if (turns >= 8 && guestAsks < needAsks) add(warnings, "GUEST_NEVER_ASKS", "嘉宾整场只有 " + guestAsks + " 次把问题问回主持人（建议 ≥" + needAsks + "）——一路「给结论+列要点」容易变成百科腔", "");

  // 主持人加了原文没有的判断（红线：不编造立场观点）——问句/复述嘉宾刚说的/骨架句豁免
  const hostSrc = strip(messages.filter(m => m.role === "user").map(m => m.content).join(""));
  const guestSrcAll = strip(messages.filter(m => m.role === "assistant").map(m => m.content).join(""));
  segs.forEach((ln, i) => {
    if (ln.speaker !== "host") return;
    if (i < 2 || i >= segs.length - 3) return;   // 只管对手戏中间，首尾是壳
    const text = strip(ln.text);
    if (SKELETON_RE.test(text) || text.length < 8 || /[？?]$/.test(text)) return;
    if (coverBigrams(text, hostSrc) >= 0.35) return;          // 他说过类似的话
    const prev = i > 0 ? strip(segs[i - 1].text) : "";
    if (prev && coverBigrams(text, prev) >= 0.5) return;      // 复述嘉宾刚说的
    if (coverBigrams(text, guestSrcAll) >= 0.5) return;       // 复述嘉宾整体观点
    add(errors, "HOST_ADDS_VIEW", "第 " + (i + 1) + " 段是主持人自写的判断句「" + text.slice(0, 22) + "」——原文里他没说过这个判断，改让他问、或让嘉宾说", "");
  });

  // 观点不许错位：原文里某人的观点句，稿子里必须由同一个人说
  for (const v of viewpointsOf(messages)) {
    const key = v.text.slice(0, 10);
    const hit = segs.find(l => strip(l.text).includes(key));
    if (hit && hit.speaker !== v.role) add(errors, "VIEW_MISATTRIBUTED", "原文里是" + (v.role === "host" ? "主持人" : "嘉宾") + "的观点「" + v.text.slice(0, 18) + "」，稿里却由" + (hit.speaker === "host" ? "主持人" : "嘉宾") + "说——观点不许错位", "");
  }
  const stats = { lines: segs.length, chars, turns, hostSegs: hostN, guestSegs: guestN };
  return { pass: errors.length === 0, errors, warnings, stats };
}

export function formatReport(r) {
  const L = [];
  L.push(r.pass ? "校验：PASS" : "校验：FAIL（" + r.errors.length + " 处硬伤）");
  for (const e of r.errors.slice(0, 10)) L.push("  [X] " + e.code + " · " + e.message + (e.evidence ? "  <" + e.evidence + ">" : ""));
  if (r.errors.length > 10) L.push("  [X] …另有 " + (r.errors.length - 10) + " 处");
  const byCode = new Map();
  for (const w of r.warnings) { const cur = byCode.get(w.code) || { n: 0, s: w }; cur.n++; byCode.set(w.code, cur); }
  for (const [code, v] of byCode) L.push("  [!] " + code + " ×" + v.n + " · " + v.s.message);
  if (r.stats) L.push("  统计：" + JSON.stringify(r.stats));
  return L.join("\n");
}