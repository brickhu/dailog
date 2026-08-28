// learned-rules：L2 演进层——编辑反馈蒸馏沉淀的通用规则（SC-STEP-1/2 的附加输入）
// 用法（纯本地命令，不依赖 API）：
//   pnpm editor learned-rules                       列出全部学习规则（按环节分组）
//   pnpm editor learned-rules add --stage selection|script "<规则文本>" [--from fb-xxx]
//       追加一条学习规则（evolve 提案经编辑审批后调用；每类上限 5 条，超限拒绝）
//   pnpm editor learned-rules remove <n> --stage selection|script
//       移除第 n 条（被推翻/过时，蒸馏门处理）
// 文件：.dailog-editor/learned-rules.md（gitignored，本地）；SC-STEP-1/2 子代理有则读取作为附加规则，
// 与基础提示词（selection.md / draft.md）并列生效，冲突以基础提示词为准。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EditorConfig } from "./lib.js";
import { learnedRulesFile } from "./lib.js";

const MAX_PER_STAGE = 5;

const STAGE_SECTION: Record<string, string> = {
  selection: "## 选题（selection——SC-STEP-1 输入）",
  script: "## 脚本（script——SC-STEP-2 输入）",
};

const DEFAULT_FILE = [
  "# 学习规则（learned-rules）——编辑反馈蒸馏沉淀的通用规则",
  "",
  "> 来源：feedback 日志经 evolve 蒸馏 + 编辑审批（confirmed）后由 `learned-rules add` 写入。",
  "> 效力：作为 SC-STEP-1（选题）/ SC-STEP-2（脚本）的**附加规则**与基础提示词并列生效；",
  ">       与基础提示词冲突时**以基础提示词为准**（冲突应在蒸馏时裁决，正常不应出现）。",
  "> 修剪：每类上限 5 条；超限时移除最久未被引用/最新被推翻的规则（蒸馏门处理）。",
  "",
  "## 选题（selection——SC-STEP-1 输入）",
  "",
  "## 脚本（script——SC-STEP-2 输入）",
  "",
].join("\n");

interface Parsed {
  header: string[];
  rules: Record<string, string[]>;
}

function parse(content: string): Parsed {
  const lines = content.split("\n");
  const header: string[] = [];
  const rules: Record<string, string[]> = { selection: [], script: [] };
  let current: string | null = null;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      current = line.includes("selection") ? "selection" : line.includes("script") ? "script" : null;
      continue;
    }
    if (current && /^\d+\. /.test(line)) {
      rules[current].push(line.replace(/^\d+\. /, ""));
    } else if (current === null) {
      header.push(line);
    }
  }
  return { header, rules };
}

function render(parsed: Parsed): string {
  const out: string[] = [...parsed.header];
  for (const stage of ["selection", "script"] as const) {
    out.push("");
    out.push(STAGE_SECTION[stage]);
    out.push("");
    const rules = parsed.rules[stage];
    if (rules.length === 0) {
      out.push("（无）");
      out.push("");
    } else {
      rules.forEach((r, i) => out.push(`${i + 1}. ${r}`));
      out.push("");
    }
  }
  return out.join("\n");
}

function load(): Parsed {
  if (!existsSync(learnedRulesFile)) {
    mkdirSync(dirname(learnedRulesFile), { recursive: true });
    writeFileSync(learnedRulesFile, DEFAULT_FILE, "utf-8");
    return parse(DEFAULT_FILE);
  }
  return parse(readFileSync(learnedRulesFile, "utf-8"));
}

function save(parsed: Parsed): void {
  writeFileSync(learnedRulesFile, render(parsed), "utf-8");
}

function flag(args: string[], name: string): string | undefined {
  const i = args.findIndex((a) => a === name);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}

function stageOf(s: string | undefined): "selection" | "script" | null {
  if (s === "selection" || s === "script") return s;
  return null;
}

export async function learnedRules(config: EditorConfig, args: string[]): Promise<void> {
  // 位置参数：跳过 --flag 及其值（--stage/--from 的值不当作子命令/规则文本）
  const VALUE_FLAGS = new Set(["--stage", "--from"]);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) {
      i++;
      continue;
    }
    positional.push(args[i]);
  }
  const sub = positional[0];

  if (sub === "add") {
    const stage = stageOf(flag(args, "--stage"));
    const rule = positional.slice(1).join(" ");
    if (!stage || !rule) {
      console.error('[learned-rules] add 需要 --stage selection|script "<规则文本>"（可选 --from fb-xxx）');
      process.exitCode = 1;
      return;
    }
    const from = flag(args, "--from");
    const parsed = load();
    if (parsed.rules[stage].length >= MAX_PER_STAGE) {
      console.error(`[learned-rules] ${stage} 环节已满 ${MAX_PER_STAGE} 条上限——需蒸馏门修剪（移除被推翻/过时规则）后才能新增`);
      process.exitCode = 1;
      return;
    }
    const text = from ? `${rule}〔来源 ${from}〕` : rule;
    parsed.rules[stage].push(text);
    save(parsed);
    console.log(`✅ 学习规则已写入（${stage === "selection" ? "选题" : "脚本"} 第 ${parsed.rules[stage].length} 条）：${rule}`);
    console.log(`   文件：${learnedRulesFile}`);
    return;
  }

  if (sub === "remove") {
    const stage = stageOf(flag(args, "--stage"));
    const n = positional[1];
    if (!stage || !n || !/^\d+$/.test(n)) {
      console.error("[learned-rules] remove 需要 <n> --stage selection|script");
      process.exitCode = 1;
      return;
    }
    const idx = parseInt(n, 10);
    const parsed = load();
    const rules = parsed.rules[stage];
    if (idx < 1 || idx > rules.length) {
      console.error(`[learned-rules] ${stage} 环节共 ${rules.length} 条，无第 ${idx} 条`);
      process.exitCode = 1;
      return;
    }
    const removed = rules.splice(idx - 1, 1)[0];
    save(parsed);
    console.log(`🗑️ 已移除（${stage === "selection" ? "选题" : "脚本"} 第 ${idx} 条）：${removed}`);
    return;
  }

  // 列表
  const parsed = load();
  console.log(`**学习规则**（${learnedRulesFile}）——SC-STEP-1/2 的附加输入，冲突以基础提示词为准`);
  for (const stage of ["selection", "script"] as const) {
    const rules = parsed.rules[stage];
    console.log(`${stage === "selection" ? "【选题】" : "【脚本】"} ${rules.length}/${MAX_PER_STAGE} 条`);
    if (rules.length === 0) console.log("  （无）");
    rules.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
  }
}
