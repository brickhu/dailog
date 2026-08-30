// 脚本批次汇总（第二级：LLM 质量检查 + 脚本生成后的分组呈现）
//   pnpm editor batch-scripts [--limit N]
//   → 遍历队列投稿草稿，按状态分组：
//     ✅ 已生成脚本（script.json：标题/段数/字数）
//     ❌ 质量不过关（quality.json：pass=false + reason——LLM 判定，Agent 生成时落盘）
//     ⏳ 待生成（有 dialogue 无 script 无 quality）
//     ⚠️ 待提取（无 dialogue）
//   → 分组呈现，询问管理员处置（拒审/保留/人工）
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { api, draftDir } from "./lib.js";

interface QueueRow {
  id: string;
  userEmail: string;
}

interface QualityRecord {
  pass: boolean;
  reason?: string;
}

export async function batchScripts(config: EditorConfig, args: string[]): Promise<void> {
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 && args[limitIdx + 1] ? Number(args[limitIdx + 1]) : 20;
  const rows = (await api(config, "/v1/editor/submissions")) as QueueRow[];
  const targets = rows.slice(0, limit);
  if (targets.length === 0) {
    console.log("[batch-scripts] 队列为空");
    return;
  }

  const generated: Array<{ id: string; email: string; title: string; segments: number; chars: number }> = [];
  const failed: Array<{ id: string; email: string; reason: string }> = [];
  const pending: Array<{ id: string; email: string }> = [];
  const noDialogue: Array<{ id: string; email: string }> = [];

  for (const row of targets) {
    const dir = draftDir(row.id);
    if (!existsSync(dir)) {
      noDialogue.push({ id: row.id, email: row.userEmail });
      continue;
    }
    const files = readdirSync(dir);
    const scriptFile = files.find((f) => /^script.*\.json$/.test(f));
    const qualityFile = existsSync(join(dir, "quality.json")) ? join(dir, "quality.json") : null;
    const quality: QualityRecord | null = qualityFile
      ? JSON.parse(readFileSync(qualityFile, "utf-8")) as QualityRecord
      : null;
    if (quality && quality.pass === false) {
      failed.push({ id: row.id, email: row.userEmail, reason: quality.reason ?? "质量判定不过关" });
      continue;
    }
    if (scriptFile) {
      const script = JSON.parse(readFileSync(join(dir, scriptFile), "utf-8")) as
        | { title?: string; segments?: Array<{ speaker: string; text: string }> }
        | Array<{ speaker: string; text: string }>;
      const segments = Array.isArray(script) ? script : script.segments ?? [];
      generated.push({
        id: row.id,
        email: row.userEmail,
        title: (!Array.isArray(script) && script.title) ? script.title : "（未命名）",
        segments: segments.length,
        chars: segments.reduce((n, s) => n + s.text.length, 0),
      });
      continue;
    }
    if (existsSync(join(dir, "dialogue.json"))) {
      pending.push({ id: row.id, email: row.userEmail });
    } else {
      noDialogue.push({ id: row.id, email: row.userEmail });
    }
  }

  console.log(`\n脚本生成状态（${targets.length} 条）：`);
  generated.forEach((g, i) => {
    console.log(`${i + 1}. ✅ ${g.id.slice(0, 8)}… - ${g.email} - 《${g.title}》 - ${g.segments} 段 / ${g.chars} 字（script.json 已生成）`);
  });
  failed.forEach((f, i) => {
    console.log(`${generated.length + i + 1}. ❌ ${f.id.slice(0, 8)}… - ${f.email} - 质量不过关：${f.reason}`);
  });
  pending.forEach((p, i) => {
    console.log(`${generated.length + failed.length + i + 1}. ⏳ ${p.id.slice(0, 8)}… - ${p.email} - 待生成脚本`);
  });
  noDialogue.forEach((n, i) => {
    console.log(`${generated.length + failed.length + pending.length + i + 1}. ⚠️ ${n.id.slice(0, 8)}… - ${n.email} - 待提取（先跑 batch）`);
  });

  console.log("\n========== 分组汇总 ==========");
  console.log(`✅ 已生成脚本（${generated.length}）→ script-preview 批量审阅后进入制作`);
  console.log(`❌ 质量不过关（${failed.length}）→ 需处置`);
  console.log(`⏳ 待生成（${pending.length}）→ 逐个生成脚本`);
  console.log(`⚠️ 待提取（${noDialogue.length}）→ 先跑 batch`);
  console.log("\n请告诉我处置意见：");
  console.log("  · ❌ 质量不过关组 → 拒审（batch-reject 下发通知+状态）/ 跳过 / 人工处理");
  console.log("  · ✅ 已生成组 → 逐个 script-preview 确认 → tts → merge → cover → publish");
}
