// 编辑反馈日志（自进化素材库）：确认门（SC-GATE-2 听感/结构反馈等）收到编辑修改意见时落盘，
// 供「蒸馏」（pnpm editor evolve，见 docs/FB.md）聚类去重后沉淀为提示词规则——提示词本身保持简单灵活，
// 进化素材在日志层累积。
// 用法（纯本地命令，不依赖 API/环境；多环境时仍按惯例带 --env，环境名不影响本命令）：
//   pnpm editor feedback                         列出全部反馈（日期倒序，最新在前）
//   pnpm editor feedback --new                  只看未蒸馏（status=new）
//   pnpm editor feedback --general              只看通用反馈（scope=general，标注「以后都要」的）
//   pnpm editor feedback --stage selection|script  只看某环节（选题|脚本）
//   pnpm editor feedback <submissionId>         按投稿过滤（前 8 位即可）
//   pnpm editor feedback add --submission <id> --stage selection|script --category <类>
//                            --issue "<现象>" --reason "<原因>" --change "<修改>" [--general] [--source <门>]
//     落盘一条反馈：默认 scope=one-off（本次修正）、status=new、date=今天；--general 标注「以后都要」。
//   pnpm editor feedback confirm <id> [<id>...]  状态 new→confirmed（已沉淀进规则）
//   pnpm editor feedback archive <id> [<id>...]  状态 new→archived（不采用/被推翻）
//     字段语义（蒸馏的关键）：
//       issue  现象——哪里不好（可复现的客观描述）
//       reason 原因——为什么不好（可泛化的根因，蒸馏只认带原因的反馈）
//       change 修改——怎么改（本次/以后怎么改）
//     提示词红线保留：编辑反馈是**意见素材**，不会自动进提示词；须经 evolve 蒸馏 + 编辑审批。
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import type { EditorConfig } from "./lib.js";
import { feedbackDir, feedbackFile } from "./lib.js";

/** 一条反馈记录（JSONL 一行） */
export interface FeedbackEntry {
  /** 反馈 id：fb-YYYYMMDD-<seq> */
  id: string;
  /** 日期 YYYY-MM-DD（本地时区） */
  date: string;
  /** 关联投稿 id（无则空串） */
  submissionId: string;
  /** 环节：selection=选题（审美进化→selection.md）；script=脚本（创作能力进化→draft.md） */
  stage: "selection" | "script";
  /** 类别：选题→门槛|价值|角度|维度|标题|其他；脚本→听感|结构|内容|情绪|停顿|穿插|收尾|其他 */
  category: string;
  /** 现象——哪里不好 */
  issue: string;
  /** 原因——为什么不好（可泛化根因） */
  reason: string;
  /** 修改——怎么改 */
  change: string;
  /** 通用性：one-off=本次修正；general=以后都要（进蒸馏候选） */
  scope: "one-off" | "general";
  /** 状态：new=待蒸馏；confirmed=已沉淀进规则；archived=已归档/被推翻 */
  status: "new" | "confirmed" | "archived";
  /** 来源确认门：SC-GATE-2 / TTS-GATE-1 / PUB-GATE-1 / 手动 */
  source: string;
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 读全部反馈（按 id 倒序 = 日期倒序） */
export function readAllEntries(): FeedbackEntry[] {
  if (!existsSync(feedbackFile)) return [];
  const out: FeedbackEntry[] = [];
  for (const line of readFileSync(feedbackFile, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as FeedbackEntry;
      if (e && typeof e.id === "string") out.push(e);
    } catch {
      // 坏行跳过（人工编辑损坏时保留其余）
    }
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : -1));
}

function genId(date: string): string {
  const prefix = "fb-" + date.replace(/-/g, "");
  const seq = readAllEntries().filter((e) => e.id.startsWith(prefix)).length + 1;
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

/** 落盘一条反馈（SKILL 在确认门调用；返回新条目） */
export function appendFeedback(input: {
  submissionId?: string;
  category?: string;
  stage?: "selection" | "script";
  issue: string;
  reason?: string;
  change?: string;
  scope?: "one-off" | "general";
  source?: string;
}): FeedbackEntry {
  const entry: FeedbackEntry = {
    id: genId(today()),
    date: today(),
    submissionId: input.submissionId ?? "",
    stage: input.stage ?? "script",
    category: input.category ?? "其他",
    issue: input.issue,
    reason: input.reason ?? "",
    change: input.change ?? "",
    scope: input.scope ?? "one-off",
    status: "new",
    source: input.source ?? "手动",
  };
  mkdirSync(feedbackDir, { recursive: true });
  appendFileSync(feedbackFile, JSON.stringify(entry) + "\n", "utf-8");
  return entry;
}

/** 更新条目状态（new→confirmed / new→archived）；返回更新数与未找到的 id */
export function setStatus(
  ids: string[],
  status: "confirmed" | "archived",
): { updated: number; missing: string[] } {
  if (!existsSync(feedbackFile)) return { updated: 0, missing: ids };
  const wanted = new Set(ids);
  const found = new Set<string>();
  const out: string[] = [];
  let updated = 0;
  for (const line of readFileSync(feedbackFile, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as FeedbackEntry;
      if (wanted.has(e.id)) {
        found.add(e.id);
        if (e.status === "new") {
          e.status = status;
          updated++;
        }
      }
      out.push(JSON.stringify(e));
    } catch {
      out.push(line);
    }
  }
  writeFileSync(feedbackFile, out.join("\n") + "\n", "utf-8");
  const missing = ids.filter((id) => !found.has(id));
  return { updated, missing };
}

function flag(args: string[], name: string, alt?: string): string | undefined {
  const i = args.findIndex((a) => a === name || (alt && a === alt));
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}

function hasFlag(args: string[], name: string, alt?: string): boolean {
  return args.some((a) => a === name || (alt && a === alt));
}

function short(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + "…" : id;
}

/** 打印一条（换行缩进，终端可读） */
function printEntry(e: FeedbackEntry, idx: number): void {
  const scopeLabel = e.scope === "general" ? "以后都要" : "本次修正";
  const stageLabel = e.stage === "selection" ? "选题" : "脚本";
  console.log(`[${idx}] ${e.date} · 投稿 ${short(e.submissionId)} · 环节:${stageLabel} · 类别:${e.category} · 通用性:${scopeLabel} · 状态:${e.status} · 来源:${e.source}`);
  if (e.issue) console.log(`    现象: ${e.issue}`);
  if (e.reason) console.log(`    原因: ${e.reason}`);
  if (e.change) console.log(`    修改: ${e.change}`);
  console.log(`    id: ${e.id}`);
}

export async function feedback(config: EditorConfig, args: string[]): Promise<void> {
  // 位置参数（子命令/投稿过滤）：跳过 --flag 及其值，避免 --stage selection 的 selection 被误当投稿
  const VALUE_FLAGS = new Set(["--stage"]);
  const NO_VALUE_FLAGS = new Set(["--new", "-n", "--general", "-g"]);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (NO_VALUE_FLAGS.has(a)) continue;
    if (VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    positional.push(a);
  }
  const sub = positional.find((a) => !a.startsWith("-"));
  const onlyNew = hasFlag(args, "--new", "-n");
  const onlyGeneral = hasFlag(args, "--general", "-g");
  const stageFilter = flag(args, "--stage");

  // add：落盘一条反馈
  if (sub === "add") {
    const issue = flag(args, "--issue");
    if (!issue) {
      console.error('[feedback] add 需要 --issue "<现象>"' +
        "（可选 --category/--stage/--reason/--change/--submission/--general/--source）");
      process.exitCode = 1;
      return;
    }
    const entry = appendFeedback({
      submissionId: flag(args, "--submission"),
      category: flag(args, "--category"),
      stage: flag(args, "--stage") === "selection" ? "selection" : "script",
      issue,
      reason: flag(args, "--reason"),
      change: flag(args, "--change"),
      scope: hasFlag(args, "--general", "-g") ? "general" : "one-off",
      source: flag(args, "--source"),
    });
    console.log(`✅ 反馈已落盘：${entry.id}（${entry.stage === "selection" ? "选题·审美" : "脚本·创作"}｜${entry.scope === "general" ? "通用——以后都要" : "本次修正"}）`);
    console.log(`   日志：${feedbackFile}`);
    return;
  }

  // confirm / archive：更新条目状态（蒸馏应用后调用）
  if (sub === "confirm" || sub === "archive") {
    const ids = args.slice(1).filter((a) => !a.startsWith("-"));
    if (ids.length === 0) {
      console.error(`[feedback] ${sub} 需要至少一个反馈 id（如 fb-20260828-001）`);
      process.exitCode = 1;
      return;
    }
    const { updated, missing } = setStatus(ids, sub === "confirm" ? "confirmed" : "archived");
    console.log(`✅ ${sub === "confirm" ? "已沉淀（new→confirmed）" : "已归档（new→archived）"}：${updated} 条`);
    if (missing.length > 0) console.log(`   ⚠️ 未找到：${missing.join(", ")}`);
    return;
  }

  // 列表
  let all = readAllEntries();
  if (onlyNew) all = all.filter((e) => e.status === "new");
  if (onlyGeneral) all = all.filter((e) => e.scope === "general");
  if (sub) all = all.filter((e) => e.submissionId.startsWith(sub));
  if (stageFilter) all = all.filter((e) => e.stage === (stageFilter === "selection" ? "selection" : "script"));

  if (all.length === 0) {
    console.log("**反馈日志**：空（确认门收到编辑修改意见时，用 feedback add 落盘，见 docs/FB.md）");
    return;
  }
  const newCount = all.filter((e) => e.status === "new").length;
  console.log(`**反馈日志**（${all.length} 条，未蒸馏 new ${newCount} 条）`);
  all.forEach((e, i) => printEntry(e, i + 1));
}
