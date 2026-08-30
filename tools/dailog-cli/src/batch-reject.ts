// 批量拒审（管理员处置 ⚠️/❌ 组）：一次确认，逐条下发通知 + 修改投稿状态（rejected）
//   pnpm editor batch-reject --ids <id1,id2,...> [--reason "兜底拒审原因"]
//   → 每条优先取草稿 quality.json 的 reason（Step A 选题筛选的 reject.feedback，逐条原因）；
//     无 quality.json 或 reason 缺失 → 用 --reason 兜底
//   → 每条 POST /v1/editor/submissions/:id/reject（站内通知 + 邮件 + 状态流转）
//   → 汇总结果
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { api, draftDir, writeProgress } from "./lib.js";

/** 读取草稿 quality.json 的拒审原因（Step A reject.feedback 落盘）；无则 null */
function qualityReason(id: string): string | null {
  const file = join(draftDir(id), "quality.json");
  if (!existsSync(file)) return null;
  try {
    const q = JSON.parse(readFileSync(file, "utf8")) as { reason?: unknown };
    return typeof q.reason === "string" && q.reason.trim() ? q.reason.trim() : null;
  } catch {
    return null;
  }
}

export async function batchReject(config: EditorConfig, args: string[]): Promise<void> {
  const idsIdx = args.indexOf("--ids");
  const reasonIdx = args.indexOf("--reason");
  const ids = idsIdx >= 0 && args[idsIdx + 1] ? args[idsIdx + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
  const fallback = reasonIdx >= 0 && args[reasonIdx + 1] ? args[reasonIdx + 1].trim() : "";
  if (ids.length === 0) {
    console.error('用法：pnpm editor batch-reject --ids <id1,id2,...> [--reason "兜底拒审原因（无 quality.json 时用）"]');
    process.exit(1);
  }
  console.log(`[batch-reject] 批量拒审 ${ids.length} 条（原因优先取各投稿 quality.json，缺失用 --reason 兜底）…`);
  let ok = 0;
  const failed: string[] = [];
  for (const id of ids) {
    const reason = qualityReason(id) ?? fallback;
    if (!reason) {
      failed.push(id);
      console.log(`  ⚠️ ${id.slice(0, 8)}… 无拒审原因（quality.json 缺失且未提供 --reason），跳过`);
      continue;
    }
    try {
      await api(config, `/v1/editor/submissions/${id}/reject`, { method: "POST", body: { reason } });
      writeProgress(id, "rejected"); // 拒审 = 终态：不计入概览待处理（见 RES）
      ok++;
      console.log(`  ✅ ${id.slice(0, 8)}… 已拒审（原因：${reason.length > 40 ? reason.slice(0, 40) + "…" : reason}）`);
    } catch {
      failed.push(id);
    }
  }
  console.log(`\n[batch-reject] 完成：${ok} 条成功${failed.length > 0 ? `，${failed.length} 条失败（${failed.join(", ")}）` : ""}`);
  console.log("[batch-reject] 投稿人已收到站内通知 + 邮件（/me/submits 可见拒审原因）");
}
