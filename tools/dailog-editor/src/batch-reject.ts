// 批量拒审（管理员处置 ⚠️/❌ 组）：一次确认，逐条下发通知 + 修改投稿状态（rejected）
//   pnpm editor batch-reject --ids <id1,id2,...> --reason "拒审原因"
//   → 每条 POST /v1/editor/submissions/:id/reject（站内通知 + 邮件 + 状态流转）
//   → 汇总结果
import type { EditorConfig } from "./lib.js";
import { api } from "./lib.js";

export async function batchReject(config: EditorConfig, args: string[]): Promise<void> {
  const idsIdx = args.indexOf("--ids");
  const reasonIdx = args.indexOf("--reason");
  const ids = idsIdx >= 0 && args[idsIdx + 1] ? args[idsIdx + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
  const reason = reasonIdx >= 0 && args[reasonIdx + 1] ? args[reasonIdx + 1].trim() : "";
  if (ids.length === 0 || !reason) {
    console.error('用法：pnpm editor batch-reject --ids <id1,id2,...> --reason "拒审原因（所有投稿共用）"');
    process.exit(1);
  }
  console.log(`[batch-reject] 批量拒审 ${ids.length} 条（原因：${reason}）…`);
  let ok = 0;
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await api(config, `/v1/editor/submissions/${id}/reject`, { method: "POST", body: { reason } });
      ok++;
      console.log(`  ✅ ${id.slice(0, 8)}… 已拒审（状态 rejected + 通知 + 邮件）`);
    } catch {
      failed.push(id);
    }
  }
  console.log(`\n[batch-reject] 完成：${ok} 条成功${failed.length > 0 ? `，${failed.length} 条失败（${failed.join(", ")}）` : ""}`);
  console.log("[batch-reject] 投稿人已收到站内通知 + 邮件（/me/submits 可见拒审原因）");
}
