// 体检指标（新标准里可测的部分），供 run.mjs 每期打印
export const strip = s => String(s).replace(/\[citation:\d+\]/g, "").replace(/\*\*|__|`|^#+\s*/g, "").replace(/\s+/g, "").trim();
const SKEL = /^大家好，我是|感谢大家收听|我们就聊到这里|OK，感谢|^好，感谢|^不客气/;
function grams(s) { const t = strip(s); const m = new Map(); for (let i = 0; i + 2 <= t.length; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; }
function cover(text, source) { const A = grams(text), B = grams(source); let hit = 0, total = 0; for (const [g, c] of A) { total += c; if (B.has(g)) hit += c; } return total ? hit / total : 0; }

export function markers(messages) {
  const out = new Set();
  for (const m of messages.filter(x => x.role === "user")) {
    const c = String(m.content);
    for (const mm of c.matchAll(/[\u4e00-\u9fa5]{2,6}个屁/g)) out.add(mm[0]);
    for (const w of ["太复杂", "太难", "不行", "不好", "废话", "算了", "不想做", "没必要", "不靠谱"]) if (c.includes(w)) out.add(w);
    for (const s of c.split(/[。！？\n]/)) if (/^(难|对|嗯|不|是)$/.test(s.trim())) out.add(s.trim());
  }
  return [...out];
}
const STOP = new Set(["我们","他们","这个","那个","什么","自己","一个","这样","其实","然后","所以","因为","如果","可以","不会","没有","已经","还是","不是","这种","问题","东西","时候","现在","知道","觉得","可能","应该","就是","但是","而且","比如","这些","那些","非常","特别","主要","需要","进行","通过","对于","关于","怎么","为什么","什么样"]);
export function terms(messages, limit = 25) {
  const c = messages.map(m => strip(m.content)).join("");
  const count = new Map();
  for (let n = 3; n <= 4; n++) for (let i = 0; i + n <= c.length; i++) { const g = c.slice(i, i + n); if ([...g].every(ch => /[\u4e00-\u9fa5]/.test(ch)) && !STOP.has(g)) count.set(g, (count.get(g) || 0) + 1); }
  const sorted = [...count.entries()].filter(([g, k]) => k >= 3).sort((a, b) => b[1] - a[1]);
  const picked = [];
  for (const [g] of sorted) { if (picked.some(p => p.includes(g) || g.includes(p))) continue; picked.push(g); if (picked.length >= limit) break; }
  return picked;
}
const VIEW = /(是|不要|不能|应该|关键|核心|最好|建议|其实|就是|不在于|必须|不想|根本不|没必要)/;
export function attribution(messages, lines) {
  const views = [];
  for (const m of messages) {
    const role = m.role === "user" ? "host" : "guest";
    for (const clause of String(m.content).split(/[。！？；\n]/)) {
      const t = strip(clause);
      if (t.length < 8 || t.length > 24) continue;
      if (/[？?]|什么样|怎么|为什么|多少|吗$|呢$/.test(t)) continue;
      if (!VIEW.test(t)) continue;
      views.push({ role, text: t });
    }
  }
  const located = [], wrong = [];
  for (const v of views) {
    const hit = lines.find(l => strip(l.text).includes(v.text.slice(0, 10)));
    if (!hit) continue;
    located.push(v);
    if (hit.speaker !== v.role) wrong.push({ view: v, spokeBy: hit.speaker });
  }
  return { located: located.length, wrong };
}
export function fabrication(messages, lines) {
  const hostSrc = strip(messages.filter(m => m.role === "user").map(m => m.content).join(""));
  const guestSrc = strip(messages.filter(m => m.role === "assistant").map(m => m.content).join(""));
  const cands = []; let checked = 0;
  for (const l of lines) {
    const t = strip(l.text);
    if (SKEL.test(t) || t.length < 8 || /[？?]$/.test(t)) continue;
    checked++;
    const c = cover(t, l.speaker === "host" ? hostSrc : guestSrc);
    const c2 = cover(t, l.speaker === "host" ? guestSrc : hostSrc);
    if (c < 0.35 && c2 < 0.5) cands.push({ speaker: l.speaker, text: t });
  }
  return { checked, cands };
}

// 契约要义覆盖：拿 R1 的 who/value/endpoint/solve + 各 process 步骤当"这一期该讲到的点"
export function contractPoints(proposal) {
  if (!proposal) return [];
  const raw = [proposal.who, proposal.value, proposal.endpoint && proposal.endpoint.problem, proposal.solve].concat((proposal.process || []).map(p => p.step)).filter(Boolean).join("；");
  const parts = String(raw).split(/[；。，、,／/（）()：:]/).map(x => strip(x)).filter(x => x.length >= 4 && x.length <= 30);
  const picked = [];
  for (const p of parts) if (!picked.some(q => q.includes(p) || p.includes(q))) picked.push(p);
  return picked;
}
// 认知探索是否走完：契约里的 solve + 每个 process 步骤，在稿里能不能找到（容忍换说法，看二元组覆盖）
export function contractCoverage(proposal, lines) {
  if (!proposal) return { hit: 0, total: 0, missing: [] };
  const pts = [proposal.solve].concat((proposal.process || []).map(p => p.step)).filter(Boolean).map(x => strip(x)).filter(x => x.length >= 4);
  const text = lines.map(l => strip(l.text)).join("|");
  const scored = pts.map(p => ({ p, c: cover(p, text) }));
  const hit = scored.filter(x => x.c >= 0.4);
  return { hit: hit.length, total: pts.length, missing: scored.filter(x => x.c < 0.4).map(x => x.p + "(" + Math.round(x.c * 100) + "%)") };
}

// 收尾是不是在复盘路径（从 A 到 B 再到 C）
export function closingRecap(lines) {
  const tail = lines.slice(-3).map(l => strip(l.text)).join(' ');
  const hit = tail.match(/从[^，。；]{1,14}(退|走|聊|转|收|落|砍)到[^，。；]{1,14}/);
  return hit ? hit[0] : '';
}
// 咬合率：嘉宾说完，主持人下一句有没有捡着他刚说的词接（有答必有应）
const FUNC = new Set(['这个','那个','我们','他们','什么','自己','一个','这样','其实','然后','所以','因为','如果','可以','这样','那样','就是','不是','这些','那些','问题','东西','时候','现在','知道','觉得','可能','应该','但是','而且','比如','怎么','为什么']);
export function biteRate(lines) {
  const segs = lines.map(l => ({ s: l.speaker, t: strip(l.text) }));
  let pairs = 0, bit = 0; const miss = [];
  for (let i = 1; i < segs.length - 3; i++) {
    if (segs[i - 1].s !== 'guest' || segs[i].s !== 'host') continue;
    const a = new Set(); for (let k = 0; k + 2 <= segs[i - 1].t.length; k++) { const gr = segs[i - 1].t.slice(k, k + 2); if (!FUNC.has(gr)) a.add(gr); }
    let shared = 0; for (let k = 0; k + 2 <= segs[i].t.length; k++) { const gr = segs[i].t.slice(k, k + 2); if (a.has(gr)) shared++; }
    pairs++; if (shared > 0) bit++; else miss.push(segs[i].t.slice(0, 24));
  }
  return { pairs, bit, miss };
}
export function report(messages, lines, proposal) {
  const mk = markers(messages), kept = mk.filter(m => lines.some(l => strip(l.text).includes(m)));
  const tm = terms(messages), cov = tm.filter(t => lines.some(l => strip(l.text).includes(t)));
  const at = attribution(messages, lines);
  const fab = fabrication(messages, lines);
  const chain = contractCoverage(proposal, lines);
  const recap = closingRecap(lines);
  const bite = biteRate(lines);
  return { recap, bite, markers: kept.length + "/" + mk.length, chain: chain.hit + "/" + chain.total, chainMissing: chain.missing, terms: cov.length + "/" + tm.length + "(" + Math.round(cov.length / Math.max(1, tm.length) * 100) + "%)", attribution: at.located + " 句归属正确 " + (at.located - at.wrong.length), wrong: at.wrong, fabrication: fab.cands.length + "/" + fab.checked, cands: fab.cands };
}