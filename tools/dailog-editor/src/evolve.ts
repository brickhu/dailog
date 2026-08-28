// evolve：编辑反馈蒸馏——「准备 + 追踪」工具（AI 提议、编辑审批仍在会话中完成）
// 两条进化轨道：**选题 = 审美进化**（编辑拒/改选题 → selection.md）；
//               **脚本 = 创作能力进化**（编辑改脚本 → draft.md）。
//   pnpm editor evolve                   读全部 new 反馈 → 按环节/类别聚类 → 写 evolve-proposal.md + 摘要
//   pnpm editor evolve --min-repeats 3   重复阈值（默认 2——≥2 次独立反馈才算通用原则候选）
//   pnpm editor evolve --stage selection 只看某环节（selection|script）
// 职责边界：本命令只做聚类与提案准备，**不自动改提示词**——规则 diff 由主会话起草、
// 编辑审批后应用；应用后主会话用 feedback confirm/archive 更新条目状态（见 docs/FB.md FB-STEP-3）。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { feedbackDir } from "./lib.js";
import { readAllEntries, type FeedbackEntry } from "./feedback.js";

/** 类别 → 提示词位置（两条轨道的起草指引） */
const HINT: Record<string, string> = {
  // 选题（审美进化）→ selection.md
  门槛: "selection.md 铁律 1 强度门槛（打分器 <60 / 定性一票否决）",
  价值: "selection.md 价值锚点 · 产出要点·听众价值",
  角度: "selection.md 输入·节目建议 · 产出要点·创作建议",
  维度: "selection.md 价值锚点（维度定义表）",
  标题: "selection.md 产出要点·标题草稿",
  // 脚本（创作能力进化）→ draft.md
  听感: "draft.md 3.2 听感与语域（落地细则见 #5 情绪 / #6 停顿 / #7 穿插）",
  内容: "draft.md 3.1 核心思想",
  结构: "draft.md #4 写作结构",
  情绪: "draft.md #5 情绪设计",
  停顿: "draft.md #6 停顿设计",
  穿插: "draft.md #7 穿插设计",
  收尾: "draft.md 4.3 落点与收束",
  其他: "无固定位置，蒸馏时判断",
};

const STAGE_TITLE: Record<string, string> = {
  selection: "选题（审美进化）——目标 selection.md",
  script: "脚本（创作能力进化）——目标 draft.md",
};

const STAGE_SUMMARY: Record<string, string> = {
  selection: "选题·审美进化",
  script: "脚本·创作能力进化",
};

function norm(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function chars(s: string): Set<string> {
  return new Set(norm(s).split(""));
}

/** 单字集合 Jaccard 相似度（中文短句近似重复检测；同环节同类别内阈值 0.3） */
function similarity(a: string, b: string): number {
  const A = chars(a);
  const B = chars(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

interface Cluster {
  rep: FeedbackEntry;
  entries: FeedbackEntry[];
}

/** 贪心聚类：按（环节×类别）分组后，组内与代表条目相似度 ≥ threshold 归入同一簇 */
function cluster(entries: FeedbackEntry[], threshold = 0.3): Cluster[] {
  const byGroup = new Map<string, FeedbackEntry[]>();
  for (const e of entries) {
    const key = e.stage + "|" + e.category;
    const list = byGroup.get(key) ?? [];
    list.push(e);
    byGroup.set(key, list);
  }
  const clusters: Cluster[] = [];
  for (const list of byGroup.values()) {
    for (const e of list) {
      const key = norm(e.issue + " " + e.change);
      let hit: Cluster | undefined;
      for (const c of clusters) {
        if (
          c.rep.stage === e.stage &&
          c.rep.category === e.category &&
          similarity(key, norm(c.rep.issue + " " + c.rep.change)) >= threshold
        ) {
          hit = c;
          break;
        }
      }
      if (hit) hit.entries.push(e);
      else clusters.push({ rep: e, entries: [e] });
    }
  }
  return clusters;
}

function fmtEntry(e: FeedbackEntry): string {
  const stageLabel = e.stage === "selection" ? "选题" : "脚本";
  const scopeLabel = e.scope === "general" ? "general" : "one-off";
  const lines = [`- ${e.id} (${e.date}, ${stageLabel}/${e.category}, ${scopeLabel})`];
  if (e.issue) lines.push(`  现象：${e.issue}`);
  if (e.reason) lines.push(`  原因：${e.reason}`);
  if (e.change) lines.push(`  修改：${e.change}`);
  return lines.join("\n");
}

interface StageResult {
  clusters: Cluster[];
  candidates: Cluster[];
  oneOffs: Cluster[];
}

export async function evolve(config: EditorConfig, args: string[]): Promise<void> {
  const minRepeats = (() => {
    const i = args.findIndex((a) => a === "--min-repeats");
    if (i >= 0 && args[i + 1]) {
      const n = parseInt(args[i + 1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 2;
  })();
  const stageOnly = (() => {
    const i = args.findIndex((a) => a === "--stage");
    if (i >= 0 && args[i + 1] === "selection") return "selection" as const;
    if (i >= 0 && args[i + 1] === "script") return "script" as const;
    return null;
  })();

  let fresh = readAllEntries().filter((e) => e.status === "new");
  if (stageOnly) fresh = fresh.filter((e) => e.stage === stageOnly);
  if (fresh.length === 0) {
    console.log("**evolve**：没有待蒸馏的 new 反馈（feedback add 落盘后重跑；查看：pnpm editor feedback --new）");
    return;
  }

  const withReason = fresh.filter((e) => e.reason.trim().length > 0);
  const noReason = fresh.filter((e) => e.reason.trim().length === 0);
  const stages = ["selection", "script"] as const;
  const perStage: Record<string, StageResult> = {};
  for (const s of stages) {
    const se = withReason.filter((e) => e.stage === s);
    const cl = cluster(se);
    perStage[s] = {
      clusters: cl,
      candidates: cl.filter((c) => c.entries.length >= minRepeats),
      oneOffs: cl.filter((c) => c.entries.length < minRepeats),
    };
  }
  const totalCandidates = perStage.selection.candidates.length + perStage.script.candidates.length;

  // 提案文件
  const proposalPath = join(feedbackDir, "evolve-proposal.md");
  mkdirSync(feedbackDir, { recursive: true });
  const md: string[] = [];
  md.push(`# evolve 提案（${new Date().toISOString().slice(0, 10)} 生成，基于 ${fresh.length} 条 new 反馈）`);
  md.push("");
  md.push("> 两条进化轨道：**选题 = 审美进化**（编辑拒/改选题 → selection.md）；**脚本 = 创作能力进化**（编辑改脚本 → draft.md）。");
  md.push("> 工作文件：主会话据此起草规则 diff（新增/软化/删除），**编辑审批后**应用；");
  md.push("> 应用后主会话执行 \`pnpm editor feedback confirm <ids>\`（已沉淀）/ \`archive <ids>\`（不采用）。");
  md.push(`> 硬规则：重复 ≥${minRepeats} 次的模式才够格成为通用原则；one-off 只进本期修订；缺 reason 的反馈不参与蒸馏。`);
  md.push("");
  for (const s of stages) {
    const r = perStage[s];
    md.push(`## ${STAGE_TITLE[s]}`);
    md.push("");
    md.push(`### 候选原则（重复 ≥${minRepeats} 次）`);
    if (r.candidates.length === 0) {
      md.push("（无——重复不足，暂不升级为通用原则）");
    } else {
      for (const [i, c] of r.candidates.entries()) {
        const general = c.entries.filter((e) => e.scope === "general").length;
        md.push(`#### 簇 ${i + 1} · ${c.rep.category} · ×${c.entries.length}（general ${general} / one-off ${c.entries.length - general}）`);
        md.push(`> 起草位置参考：${HINT[c.rep.category] ?? HINT["其他"]}`);
        md.push("");
        for (const e of c.entries) md.push(fmtEntry(e));
        md.push("");
      }
    }
    md.push("### 个案（重复 1 次——通常只进本期修订，不升级为通用原则）");
    if (r.oneOffs.length === 0) {
      md.push("（无）");
    } else {
      for (const c of r.oneOffs) {
        md.push(`#### ${c.rep.category} · ×1`);
        for (const e of c.entries) md.push(fmtEntry(e));
        md.push("");
      }
    }
    md.push("");
  }
  md.push("## 缺原因（不参与蒸馏，可补 reason 后重跑）");
  if (noReason.length === 0) {
    md.push("（无）");
  } else {
    for (const e of noReason) {
      const stageLabel = e.stage === "selection" ? "选题" : "脚本";
      md.push(`- ${e.id} (${e.date}, ${stageLabel}/${e.category}) 现象：${e.issue} —— **无 reason**`);
    }
  }
  writeFileSync(proposalPath, md.join("\n") + "\n", "utf-8");

  // 摘要
  const selCount = fresh.filter((e) => e.stage === "selection").length;
  console.log(`**evolve 提案已生成**：${fresh.length} 条 new 反馈（选题 ${selCount} / 脚本 ${fresh.length - selCount}）→ 候选原则 ${totalCandidates} 个`);
  console.log(`📍 提案文件：${proposalPath}`);
  console.log("");
  for (const s of stages) {
    const r = perStage[s];
    if (r.candidates.length > 0) {
      console.log(`【${STAGE_SUMMARY[s]}】候选原则：`);
      for (const c of r.candidates) {
        const general = c.entries.filter((e) => e.scope === "general").length;
        const snippet = c.rep.issue.length > 24 ? c.rep.issue.slice(0, 24) + "…" : c.rep.issue;
        console.log(`  [${c.rep.category} ×${c.entries.length}] ${snippet}（general ${general}/one-off ${c.entries.length - general}）`);
      }
      console.log("");
    } else if (r.clusters.length > 0) {
      const oneOffCount = r.oneOffs.reduce((n, c) => n + c.entries.length, 0);
      console.log(`【${STAGE_SUMMARY[s]}】无候选原则（重复不足）——个案 ${oneOffCount} 条只进本期修订`);
    }
  }
  if (noReason.length > 0) {
    console.log(`⚠️ 缺 reason（不参与蒸馏）：${noReason.length} 条——补原因后重跑`);
  }
  console.log("下一步（会话中完成）：读提案 → 起草规则 diff → 编辑审批 → 应用 + feedback confirm/archive");
}
