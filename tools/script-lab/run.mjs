#!/usr/bin/env node
// script-lab：通用提示词测试工具（bash 驱动，无构建，提示词随改随跑）
// 用法：node tools/script-lab/run.mjs <提示词名称> [<投稿ID>] --input <文件> [--input <文件>...] [选项]
//   <提示词名称>：prompts/ 下的 .md 文件名（selection / draft / meta / 自定义），或 .md 文件路径
//   <投稿ID>（可选位置参数）：自动注入 .dailog-editor/drafts/<id>/ 的 dialogue.json + info.json
//     ——根命令 pnpm selection <id> / pnpm draft <id> 即此形式（见 README）
//   --input：输入文件（可多个）——JSON 美化、文本原样，按顺序拼进用户消息
// 详见 tools/script-lab/README.md

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { toolDir, resolveLlmConfig, describeSettings, flagValue, hasFlag } from "./lib/config.mjs";
import { complete } from "./lib/llm.mjs";
import { loadInputFile, resolvePrompt, buildUserMessage } from "./lib/inputs.mjs";
import { summarize, writeRaw, writeJson } from "./lib/output.mjs";

/** 找仓库根（含 .dailog-editor 的目录）：从 cwd 向上最多 8 级 */
function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, ".dailog-editor"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 投稿 ID 位置参数：run.mjs <提示词> <submissionId>
 *  自动注入该投稿的 dialogue.json（自动识别形态：裸数组 / {messages} 包装 / 其他对象）+
 *  info.json（存在则顶层合并）。返回输入数组；无位置参数 → null。 */
function collectSubmissionInputs(args) {
  const id = args[1] && !args[1].startsWith("--") ? args[1] : null;
  if (!id) return null;
  const root = findRepoRoot(process.cwd());
  if (!root) {
    console.error("[script-lab] 未找到 .dailog-editor 目录（投稿注入需要仓库根）——请从仓库根运行");
    process.exit(1);
  }
  const dir = join(root, ".dailog-editor", "drafts", id);
  const dialoguePath = join(dir, "dialogue.json");
  if (!existsSync(dialoguePath)) {
    console.error("[script-lab] 投稿草稿不存在或未采集：" + dir);
    console.error("[script-lab] 处理：pnpm editor fetch " + id + " 先采集，或改用 --input 显式传文件");
    process.exit(1);
  }
  const out = [];
  try {
    const d = JSON.parse(readFileSync(dialoguePath, "utf-8"));
    if (Array.isArray(d)) {
      out.push({ path: dialoguePath, label: "dialogue", extract: null });
    } else if (d && typeof d === "object" && Array.isArray(d.messages)) {
      out.push({ path: dialoguePath, label: "dialogue", extract: "messages" });
    } else {
      out.push({ path: dialoguePath, label: "dialogue", extract: null });
    }
  } catch {
    out.push({ path: dialoguePath, label: "dialogue", extract: null });
  }
  const infoPath = join(dir, "info.json");
  if (existsSync(infoPath)) out.push({ path: infoPath, label: null, extract: null });
  console.log("[script-lab] 投稿 " + id + "：自动注入 dialogue.json" + (existsSync(infoPath) ? " + info.json" : ""));
  return out;
}

/** 解析 --input（可多个）+ --as <标签> / --extract <路径>（作用于最近一个 --input） */
function collectInputs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) {
      out.push({ path: args[i + 1], label: null, extract: null });
      i++;
    } else if ((args[i] === "--as" || args[i] === "--extract") && args[i + 1]) {
      if (out.length === 0) {
        console.error("[script-lab] " + args[i] + " 必须跟在 --input 之后（给上一个输入设置 key/提取路径）");
        process.exit(1);
      }
      if (args[i] === "--as") out[out.length - 1].label = args[i + 1];
      else out[out.length - 1].extract = args[i + 1];
      i++;
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    console.log(readFileSync(join(toolDir, "README.md"), "utf-8"));
    return;
  }
  if (args[0].startsWith("--")) {
    console.error("[script-lab] 用法：node tools/script-lab/run.mjs <提示词名称> --input <文件> [--as <标签>] [--input <文件>...] [--out <path>] [--raw] [--dry-run] [--save-prompt <path>] [--note <str>] [--model/--api-key/--base-url ...]");
    process.exit(1);
  }

  const promptName = args[0];
  const prompt = await resolvePrompt(promptName); // 先校验提示词（主参数）
  // 输入 = 投稿位置参数注入（dialogue + info）在前 + 显式 --input 在后（后者覆盖同名 key）
  const submissionInputs = collectSubmissionInputs(args) ?? [];
  const inputPaths = [...submissionInputs, ...collectInputs(args)];
  if (inputPaths.length === 0) {
    console.error("[script-lab] 至少需要一个输入：<投稿ID> 位置参数，或 --input <文件>（可多个）");
    process.exit(1);
  }
  for (const s of inputPaths) {
    if (!existsSync(s.path)) {
      console.error("[script-lab] 输入文件不存在：" + s.path);
      process.exit(1);
    }
  }

  const inputs = inputPaths.map((s) => loadInputFile(s.path, s.label, s.extract));
  // 重复标题警告（指针需唯一，否则模型可能混淆）
  const seen = new Map();
  for (const inp of inputs) {
    const key = (inp.label && inp.label.trim()) || basename(inp.path);
    if (seen.has(key)) {
      console.warn("[script-lab] ⚠️ 输入标题重复：" + key + "——system 指针会指向不明确，建议用 --as 区分");
    }
    seen.set(key, true);
  }
  const note = flagValue(args, "--note");
  // 通用说明：本环境无工具能力，所有输入已内联——防止模型照提示词去"读取文件"（技能提示词面向带工具的子代理）
  const TOOL_NOTE =
    "\n\n（测试环境说明：本工具不提供文件读取/工具调用能力——上方用户消息已包含本次调用的全部输入文件，" +
    "请直接依据这些内容完成输出，不要尝试读取文件或调用工具；若缺少某个输入，按提示词中的缺省值处理。）";
  const userMessage = buildUserMessage(inputs, note) + TOOL_NOTE;
  const messages = [
    { role: "system", content: prompt.content },
    { role: "user", content: userMessage },
  ];

  const savePrompt = flagValue(args, "--save-prompt");
  const dryRun = hasFlag(args, "--dry-run");
  const rawFlag = hasFlag(args, "--raw");
  const noStream = hasFlag(args, "--no-stream");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = flagValue(args, "--out") || join(toolDir, "out", promptName.replace(/[\\/]/g, "-") + "-" + ts + ".md");

  if (savePrompt) {
    writeFileSync(savePrompt, JSON.stringify(messages, null, 2));
    console.log("[script-lab] 拼装请求已保存：" + savePrompt);
  }
  console.log("[script-lab] 提示词：" + prompt.path);
  console.log("[script-lab] system=" + prompt.content.length + " 字符 · user=" + userMessage.length + " 字符（≈" + Math.round(userMessage.length / 2) + " tokens）· 输入 " + inputPaths.length + " 个文件");
  console.log("[script-lab] LLM 设置：" + describeSettings(args, prompt.moduleConfig));
  console.log("════════ LLM 输出 ════════");

  if (dryRun) {
    console.log("[script-lab] --dry-run：未调用 LLM（拼装结果如上；加 --save-prompt <path> 可落盘请求）");
    return;
  }

  const config = resolveLlmConfig(process.argv, prompt.moduleConfig);
  const raw = await complete(config, messages, {
    stream: !noStream,
    onDelta: (d) => process.stdout.write(d),
  });
  console.log("\n\n════════ 摘要 ════════");
  const rawPath = writeRaw(out, raw);
  const jsonPath = writeJson(out, raw);
  console.log("  原始输出：" + rawPath);
  if (jsonPath) console.log("  JSON 落盘：" + jsonPath);
  summarize(raw);
  if (rawFlag) {
    console.log("\n════════ 原始输出全文 ════════");
    console.log(raw);
  }
}

main().catch((e) => {
  console.error("\n❌ " + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});