// checks：脚本机器校验注册表（GATE 校验化）——把可机械查证的编辑反馈固化为断言，
// SC-GATE-2 跑 check-script 执行。分工：提示词管创作（劝告），校验管把关（程序 100% 检查）。
// 新增校验项：在 CHECKS 数组追加 {id, name, level, run}。
// 来源映射（编辑反馈蒸馏→断言）：句尾标签/收尾三步/笑声数/AI 长段/恶补提问 = FB 高频硬原则。
import type { ScriptSegment } from "./lib.js";

export interface CheckContext {
  raw: Record<string, unknown>;
  segments: ScriptSegment[];
  dialogue: { role: string; content: string }[];
}

export interface CheckResult {
  id: string;
  name: string;
  level: "fail" | "warn";
  ok: boolean;
  detail: string;
}

interface CheckDef {
  id: string;
  name: string;
  level: "fail" | "warn";
  run: (ctx: CheckContext) => { ok: boolean; detail: string };
}

const BREAK_AT_END = /\[(break|long-break)\]\s*$/;
const TAGS_AT_END = /\[\w[\w \-]*\]\s*$/;
const LAUGH_RE = /\[(laughing|chuckling|audience laughing|background laughter|crowd laughing)\]/gi;
const BREAK_RE = /\[(break|long-break)\]/g;

function norm(s: string): string {
  return (s ?? "").toLowerCase().replace(/\[[\w \-]+\]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
}

/** 切句：先剥掉 [标签]（不算句子），保留句末标点（问句检测依赖 ？ 结尾） */
function sentences(text: string): string[] {
  const clean = (text ?? "").replace(/\[[\w \-]+\]/g, "");
  const out: string[] = [];
  const re = /[^。！？!?；;]+[。！？!?；;]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const s = m[0].trim();
    if (s) out.push(s);
  }
  return out;
}

function jaccard(a: string, b: string): number {
  const A = new Set(norm(a).split(""));
  const B = new Set(norm(b).split(""));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

const hasParts = (ctx: CheckContext): boolean => Array.isArray((ctx.raw as { parts?: unknown }).parts);

export const CHECKS: CheckDef[] = [
  {
    id: "structure_parts",
    name: "三段结构（parts[0..2] 各含 segments）",
    level: "fail",
    run: (ctx) => {
      if (!hasParts(ctx)) return { ok: true, detail: "旧格式（segments 扁平）——跳过" };
      const parts = (ctx.raw as { parts?: { segments?: unknown[] }[] }).parts ?? [];
      if (parts.length !== 3) return { ok: false, detail: `parts 应为 3 段，实际 ${parts.length} 段` };
      const empty = parts.map((p, i) => (Array.isArray(p.segments) && p.segments.length > 0 ? null : i + 1)).filter((x) => x !== null);
      return empty.length === 0
        ? { ok: true, detail: "parts[0..2] 均非空" }
        : { ok: false, detail: `空段：part${empty.join("/part")}` };
    },
  },
  {
    id: "six_fields",
    name: "仅 6 个顶层字段（禁发布元数据）",
    level: "fail",
    run: (ctx) => {
      if (!hasParts(ctx)) return { ok: true, detail: "旧格式——跳过" };
      const ALLOWED = new Set(["category", "parts", "host", "guest", "lang", "creationNote"]);
      const extra = Object.keys(ctx.raw).filter((k) => !ALLOWED.has(k));
      return extra.length === 0
        ? { ok: true, detail: "顶层字段合法" }
        : { ok: false, detail: `混入发布元数据字段：${extra.join(", ")}——脚本阶段不产出，见 draft.md #8` };
    },
  },
  {
    id: "emotion_tag_end",
    name: "情绪/语气标签不在句尾",
    level: "fail",
    run: (ctx) => {
      const bad: string[] = [];
      ctx.segments.forEach((s, i) => {
        const text = s.text.trimEnd();
        if (TAGS_AT_END.test(text) && !BREAK_AT_END.test(text)) {
          bad.push(`part${s.part ?? "?"} 段#${i + 1} "…${text.slice(-24)}"`);
        }
      });
      return bad.length === 0
        ? { ok: true, detail: "无句尾标签（[break]/[long-break] 除外）" }
        : { ok: false, detail: bad.join("；") + "——标签禁句尾（见 draft.md #5）" };
    },
  },
  {
    id: "ending_complete",
    name: "收尾三步（落点→收束→告别）",
    level: "fail",
    run: (ctx) => {
      if (!hasParts(ctx)) return { ok: true, detail: "旧格式（非三段契约）——跳过" };
      const n = ctx.segments.length;
      if (n < 3) return { ok: false, detail: `仅 ${n} 段——收尾三步不可能齐全` };
      const [a, b, c] = ctx.segments.slice(-3).map((s) => s.speaker);
      if (a === "host" && b === "guest" && c === "host") return { ok: true, detail: "末尾 host→guest→host（落点→收束→告别）" };
      return { ok: false, detail: `末尾三段 speaker=${a}→${b}→${c}，应为 host→guest→host——落点/收束/告别缺步（见 draft.md 4.3）` };
    },
  },
  {
    id: "laughter_count",
    name: "笑声类标签 ≤1 处",
    level: "warn",
    run: (ctx) => {
      const all = ctx.segments.map((s) => s.text).join("");
      const m = all.match(LAUGH_RE) ?? [];
      return m.length <= 1
        ? { ok: true, detail: `${m.length} 处` }
        : { ok: false, detail: `${m.length} 处（${m.join(" ")}）——全场应 ≤1，绝不为分段区隔硬塞笑声（见 draft.md #5）` };
    },
  },
  {
    id: "guest_monologue",
    name: "guest 不连续长独白（≤2 句拆段）",
    level: "warn",
    run: (ctx) => {
      const bad: string[] = [];
      ctx.segments.forEach((s, i) => {
        if (s.speaker !== "guest") return;
        const count = sentences(s.text).length;
        const hasBreak = BREAK_RE.test(s.text);
        if (count > 2 && !hasBreak) bad.push(`part${s.part ?? "?"} 段#${i + 1} ${count} 句（超 2 句应拆段，段间插 host 短附和或停顿）`);
      });
      return bad.length === 0
        ? { ok: true, detail: "无超长 guest 段" }
        : { ok: false, detail: bad.join("；") };
    },
  },
  {
    id: "host_question_trace",
    name: "host 问句可追溯原文（恶补/编造风险）",
    level: "warn",
    run: (ctx) => {
      const userSentences = ctx.dialogue.filter((m) => m.role === "user").flatMap((m) => sentences(m.content ?? ""));
      if (userSentences.length === 0) return { ok: true, detail: "无对话原文可比对（dialogue.json 缺失/为空）——跳过" };
      const bad: string[] = [];
      ctx.segments.forEach((s, i) => {
        if (s.speaker !== "host") return;
        if (/听众朋友|欢迎收听|大家好|你好|welcome|hello/i.test(s.text)) return; // 开场/致意不查
        const qs = sentences(s.text).filter((sentence) => sentence.endsWith("？") || sentence.endsWith("?"));
        if (qs.length === 0) return;
        for (const q of qs) {
          if (norm(q).length < 4) continue; // 短附和/语气词不查
          const best = Math.max(...userSentences.map((u) => jaccard(q, u)));
          if (best < 0.3) bad.push(`part${s.part ?? "?"} 段#${i + 1} "${q.slice(0, 30)}"（原文未见近似问句，疑似恶补/编造）`);
        }
      });
      return bad.length === 0
        ? { ok: true, detail: `${userSentences.length} 句原文可追溯` }
        : { ok: false, detail: bad.join("；") + "——追问只来自用户原生提问（见 draft.md #7）" };
    },
  },
  {
    id: "pause_density",
    name: "停顿密度（每 2-4 句 1 处）",
    level: "warn",
    run: (ctx) => {
      const all = ctx.segments.map((s) => s.text).join("");
      const pauses = (all.match(BREAK_RE) ?? []).length;
      const totalSentences = ctx.segments.reduce((n, s) => n + sentences(s.text).length, 0);
      if (totalSentences === 0) return { ok: true, detail: "无句子" };
      const ratio = pauses / totalSentences;
      return ratio <= 0.6
        ? { ok: true, detail: `${pauses} 停 /${totalSentences} 句（${ratio.toFixed(2)}）` }
        : { ok: false, detail: `${pauses} 停 /${totalSentences} 句（${ratio.toFixed(2)}）——停顿偏密，删停测试：删掉不别扭的是多余的` };
    },
  },
];
