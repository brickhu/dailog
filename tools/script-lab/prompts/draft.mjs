// dailog 脚本生成提示词（SC-STEP-2——脚本内容 + 听感打磨）
// 提示词正文在 draft.md（同目录）——改 .md 即生效，无需构建；
// 本文件只是 JS 包装：默认导出 = .md 全文；另有 sections（按 # 标题拆分）与可选 config（本环节 LLM 配置）。
//   本环节配置示例（优先级：命令行 flag > 本文件 config > 环境变量/.env > 默认）：
//   export const config = { temperature: 0.2, seed: 42, maxTokens: 4000 };
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
export const prompt = readFileSync(join(dir, "draft.md"), "utf-8");
export default prompt;

/** 按一级标题（# ）拆分的段落对象，便于拼接/重组 */
export const sections = (() => {
  const out = {};
  const parts = prompt.split(/^# /m);
  const head = (parts.shift() || "").trim();
  for (const p of parts) {
    const nl = p.indexOf("\n");
    const title = nl >= 0 ? p.slice(0, nl).trim() : p.trim();
    out[title] = ("# " + p).trimEnd();
  }
  return out;
})();
