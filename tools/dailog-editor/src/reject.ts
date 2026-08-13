// 拒审（reason 必填）：投稿状态 → rejected + 投稿人收到通知与邮件
import type { EditorConfig } from "./lib.js";
import { api, writeProgress } from "./lib.js";

export async function reject(config: EditorConfig, args: string[]): Promise<void> {
  const submissionId = args[0];
  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : undefined;
  if (!submissionId || !reason) {
    console.error("用法：pnpm editor reject <submissionId> --reason \"拒审原因\"");
    process.exit(1);
  }
  const res = await api(config, `/v1/editor/submissions/${submissionId}/reject`, {
    method: "POST",
    body: { reason },
  });
  console.log(`[reject] ✅ 已拒审：${submissionId}（原因：${reason}）`);
  writeProgress(submissionId, "rejected");
}
