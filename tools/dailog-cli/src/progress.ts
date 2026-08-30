// 进度查看（会话中断恢复）：显示当前投稿的制作进度 + 草稿产物清单
//   pnpm editor progress <submissionId>
//   → 读 drafts/{id}/progress.json + 列出草稿目录已有产物 → 判断断点
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { draftDir, readProgress } from "./lib.js";

/** 步骤说明（断点恢复指引） */
const STEP_HINTS: Record<string, string> = {
  fetched: "已采集解码（dialogue.json 就绪）——下一步：生成脚本 → tts",
  pasted: "已粘贴入库（dialogue.json 就绪）——下一步：生成脚本 → tts",
  tts: "语音已合成（seg-NN.mp3 就绪）——下一步：merge",
  merged: "已合成 final.m4a——下一步：试听 → cover（可选）→ publish",
  covered: "封面已就绪——下一步：publish",
  published: "✅ 已发布——无需继续",
  rejected: "✅ 已拒审——无需继续",
  republished: "✅ 已重新生成（republish）——无需继续",
};

export async function progress(config: EditorConfig, args: string[]): Promise<void> {
  const submissionId = args[0];
  if (!submissionId) {
    console.error("用法：pnpm editor progress <submissionId>");
    process.exit(1);
  }
  const dir = draftDir(submissionId);
  const p = readProgress(submissionId);
  console.log(`[progress] 投稿 ${submissionId}`);
  if (p) {
    console.log(`  进度：${p.step}（${new Date(p.updatedAt).toLocaleString("zh-CN")}）`);
    console.log(`  下一步：${STEP_HINTS[p.step] ?? "查看草稿产物判断断点"}`);
  } else {
    console.log("  进度：未开始制作（或草稿已清空）");
    console.log("  下一步：detail 查投稿状态 → fetch 采集解码 → 生成脚本 → tts → merge → publish");
  }
  // 草稿产物清单
  if (existsSync(dir)) {
    const files = readdirSync(dir).filter((f) => !f.startsWith("_"));
    if (files.length > 0) {
      console.log(`  草稿产物（${files.length}）：${files.join(", ")}`);
    } else {
      console.log("  草稿目录为空");
    }
  } else {
    console.log("  草稿目录不存在");
  }
}
