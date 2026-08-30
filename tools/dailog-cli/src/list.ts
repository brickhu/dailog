// 待审队列（submitted 先到先审）
import type { EditorConfig } from "./lib.js";
import { api } from "./lib.js";

interface QueueRow {
  id: string;
  url: string;
  title: string | null;
  status: string;
  createdAt: string;
  userEmail: string;
  displayName: string;
  hasVoiceSample: boolean;
}

export async function list(config: EditorConfig, args: string[]): Promise<void> {
  const status = args[0] === "rejected" || args[0] === "published" ? args[0] : "submitted";
  const rows = (await api(config, `/v1/editor/submissions${status === "submitted" ? "" : `?status=${status}`}`)) as QueueRow[];
  if (rows.length === 0) {
    console.log(`[queue] 暂无 ${status} 投稿`);
    return;
  }
  console.log(`[queue] ${status}（${rows.length}）:`);
  for (const r of rows) {
    const sample = r.hasVoiceSample ? "🎙" : "⚠️无采样";
    const title = r.title ? `《${r.title}》` : "";
    console.log(`  ${r.id}  ${r.displayName} <${r.userEmail}> ${sample} ${title}\n      ${r.url}\n      ${r.createdAt.slice(0, 10)}`);
  }
  console.log("\n提示：pnpm editor detail <submissionId> 查看详情");
}
