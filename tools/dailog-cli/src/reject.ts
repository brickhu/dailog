// 拒审（reason 必填）：投稿状态 → rejected + 投稿人收到通知与邮件
import type { EditorConfig } from "./lib.js";
import { api, writeProgress, draftsDir } from "./lib.js";
import { deleteR2Object, dialogueR2Key } from "./r2.js";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
  // 清理 R2 对话（URL 哈希 key；无其它投稿共享该 URL 才删）
  await removeDialogueR2(config, submissionId);
}

/** 拒审后清理 R2 对话对象：同 URL 还有其它投稿引用则保留（共享资源） */
async function removeDialogueR2(config: EditorConfig, submissionId: string): Promise<void> {
  try {
    // 取本投稿 URL（本地 dialogue.json 优先，无则 detail 接口）
    let url: string | null = null;
    const localDlg = join(draftsDir, submissionId, "dialogue.json");
    if (existsSync(localDlg)) {
      const d = JSON.parse(readFileSync(localDlg, "utf-8"));
      url = d?.sourceUrl || null;
    }
    if (!url) {
      const detail = await api(config, `/v1/editor/submissions/${submissionId}`);
      url = (detail as { url?: string })?.url || null;
    }
    if (!url) return;
    // 检查本地其它投稿是否共享该 URL
    let shared = false;
    for (const id of readdirSync(draftsDir)) {
      if (id === submissionId) continue;
      const p = join(draftsDir, id, "dialogue.json");
      if (!existsSync(p)) continue;
      try {
        const d = JSON.parse(readFileSync(p, "utf-8"));
        if (d?.sourceUrl === url) { shared = true; break; }
      } catch { /* 跳过 */ }
    }
    if (shared) {
      console.log(`[reject] R2 对话保留：URL 被其它投稿共享（${url.slice(0, 60)}…）`);
      return;
    }
    await deleteR2Object(config, dialogueR2Key(url));
    console.log(`[reject] R2 对话已删除（${dialogueR2Key(url)}）`);
  } catch (e) {
    console.warn(`[reject] R2 对话清理失败（${(e as Error).message?.slice(0, 120)}）——不影响拒审`);
  }
}
