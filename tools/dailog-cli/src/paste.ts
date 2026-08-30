// 粘贴入库（浏览器控制台兜底闭环）：用户把控制台脚本输出的 JSON 粘贴回终端
//   pnpm editor paste <submissionId>
//   ① 提示粘贴（多行 JSON，粘贴后 Ctrl+D 结束）
//   ② 校验结构：消息数组、role 仅 user/assistant、双全
//   ③ 写草稿 drafts/{id}/dialogue.json → 摘要输出 → 继续管线（生成脚本）
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { draftDir, writeProgress } from "./lib.js";

/** 读取 stdin 全部内容（用户粘贴后 Ctrl+D / Ctrl+Z 结束） */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
  });
}

function normalizeText(s: string): string {
  return s.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

export async function paste(config: EditorConfig, args: string[]): Promise<void> {
  const submissionId = args[0];
  if (!submissionId) {
    console.error("用法：pnpm editor paste <submissionId>");
    process.exit(1);
  }
  console.log("[paste] 粘贴浏览器控制台输出的 JSON（消息数组），粘贴后按 Ctrl+D 结束：");

  const raw = (await readStdin()).trim();
  if (!raw) {
    console.error("[paste] 未收到输入");
    process.exit(1);
  }
  let data: { messages?: unknown } | unknown[];
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("[paste] JSON 解析失败——请粘贴完整的控制台输出（含大括号）");
    process.exit(1);
  }
  const messages = (Array.isArray(data) ? data : (data as { messages?: unknown }).messages) as Array<{ role?: unknown; content?: unknown }> | undefined;
  if (!Array.isArray(messages) || messages.length === 0) {
    console.error("[paste] 不是消息数组（需要 [{role, content}, …] 或 {messages: […]})");
    process.exit(1);
  }
  // 校验：role 仅 user/assistant，content 非空；消息双全
  const cleaned: { role: string; content: string }[] = [];
  for (const m of messages) {
    const role = typeof m?.role === "string" ? m.role.toLowerCase() : "";
    if (role !== "user" && role !== "assistant") {
      console.error(`[paste] 非法 role：${String(m?.role)}（仅 user/assistant）`);
      process.exit(1);
    }
    const content = normalizeText(typeof m?.content === "string" ? m.content : "");
    if (content) cleaned.push({ role, content });
  }
  const users = cleaned.filter((m) => m.role === "user").length;
  if (cleaned.length === 0 || users === 0 || users === cleaned.length) {
    console.error(`[paste] 消息不全（user ${users} / assistant ${cleaned.length - users}）——需要双全，请重新提取（滚动到底部后重跑控制台脚本）`);
    process.exit(1);
  }

  // 写草稿 + 摘要
  const dir = draftDir(submissionId);
  writeFileSync(join(dir, "dialogue.json"), JSON.stringify({ sourceUrl: null, source: "browser-console", messages: cleaned }, null, 2));
  const words = cleaned.reduce((n, m) => n + m.content.length, 0);
  console.log(`[paste] ✅ 已入库：drafts/${submissionId}/dialogue.json`);
  writeProgress(submissionId, "pasted");
  console.log(`[paste]   ${cleaned.length} 条消息（user ${users} / assistant ${cleaned.length - users}），共 ${words} 字`);
  console.log("[paste] 下一步：基于 dialogue.json 生成脚本（脚本生成规范见 skill ④）");
}
