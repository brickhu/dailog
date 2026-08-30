// 节目下线申请队列（用户「申请下线」→ 编辑审批）：
//   pnpm editor removal [list] [--status pending|approved|rejected]   查看申请（缺省 pending）
//   pnpm editor removal approve <requestId>   批准下线（episode 下架 + 通知投稿人）
//   pnpm editor removal reject <requestId>    拒绝下线（通知投稿人）
import type { EditorConfig } from "./lib.js";
import { api } from "./lib.js";

interface RemovalRequestRow {
  id: string;
  episodeId: string;
  slug: string;
  episodeTitle: string | null;
  episodeNumber: number | null;
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  reason: string | null;
  status: string;
}

export async function removal(config: EditorConfig, args: string[]): Promise<void> {
  const sub = args[0] ?? "list";

  if (sub === "list") {
    const statusIdx = args.indexOf("--status");
    const status = statusIdx >= 0 ? args[statusIdx + 1] : "pending";
    if (status !== "pending" && status !== "approved" && status !== "rejected") {
      console.error("用法：pnpm editor removal [list] --status pending|approved|rejected");
      process.exit(1);
    }
    const list = (await api(config, "/v1/editor/episodes/removal-requests?status=" + status)) as RemovalRequestRow[];
    if (list.length === 0) {
      console.log("[removal] 无 " + status + " 状态的下线申请");
      return;
    }
    console.log("[removal] " + status + " 下线申请 " + list.length + " 条：");
    for (const r of list) {
      const title = r.episodeTitle ? "「" + r.episodeTitle + "」" : "第 " + (r.episodeNumber ?? "?") + " 期";
      console.log("  " + r.id + "  " + title + "（" + r.slug + "）");
      console.log("      投稿人：" + (r.userDisplayName ?? r.userEmail ?? r.userId));
      if (r.reason) console.log("      理由：" + r.reason);
    }
    return;
  }

  const id = args[1];
  if ((sub === "approve" || sub === "reject") && !id) {
    console.error("用法：pnpm editor removal approve|reject <requestId>");
    process.exit(1);
  }
  if (sub === "approve") {
    await api(config, "/v1/editor/episodes/removal-requests/" + id + "/approve", { method: "POST" });
    console.log("[removal] ✅ 已批准下线：" + id);
    return;
  }
  if (sub === "reject") {
    await api(config, "/v1/editor/episodes/removal-requests/" + id + "/reject", { method: "POST" });
    console.log("[removal] ⛔ 已拒绝下线：" + id);
    return;
  }

  console.error("用法：pnpm editor removal [list|approve <id>|reject <id>] [--status pending|approved|rejected]");
  process.exit(1);
}
