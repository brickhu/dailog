// 工作台概要（overview 触发）：环境 + 编辑 + 三类待办计数
//   pnpm editor overview
//   → 展示：
//      环境：<site_url>
//      编辑：<email>
//      1. N 条待审批；
//      2. N 条脚本待生成语音；
//      3. N 条语音待发布；
//      请问你接下来想处理什么？
//   待审批 = 服务端 submitted 队列；脚本待生成语音 = 草稿有 script.json 未合成；
//   语音待发布 = 草稿有 final.mp3 未发布（本地状态）
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { api, draftsDir, readProgress } from "./lib.js";

interface QueueRow {
  id: string;
}

export async function overview(config: EditorConfig, _args: string[]): Promise<void> {
  // 环境 + 编辑（站点地址、登录账号）
  const envDisplay = config.siteUrl ?? config.apiBase;
  let email = "（未登录）";
  try {
    const profile = (await api(config, "/v1/me/profile")) as { email?: string | null };
    if (profile?.email) email = profile.email;
  } catch {
    /* 未配对：下方计数也会失败，直接展示 */
  }

  // ① 待审批（服务端 submitted 队列）
  let pending = 0;
  try {
    const rows = (await api(config, "/v1/editor/submissions")) as QueueRow[];
    pending = rows.length;
  } catch {
    /* 未配对时计数为 0，由调用方引导登录 */
  }

  // ② 脚本待生成语音 / ③ 语音待发布（本地草稿状态）
  let scriptPending = 0;
  let voicePending = 0;
  if (existsSync(draftsDir)) {
    for (const id of readdirSync(draftsDir)) {
      const dir = join(draftsDir, id);
      if (!existsSync(join(dir, "dialogue.json"))) continue;
      const hasScript = readdirSync(dir).some((f) => /^script.*\.json$/.test(f));
      const hasFinal = existsSync(join(dir, "final.mp3"));
      const progress = readProgress(id);
      if (progress?.step === "published" || progress?.step === "rejected") continue; // 终态不计
      if (hasScript && !hasFinal) scriptPending++;
      if (hasFinal) voicePending++;
    }
  }

  console.log(`环境：${envDisplay}`);
  console.log(`编辑：${email}`);
  console.log("");
  console.log(`1. ${pending} 条待审批；`);
  console.log(`2. ${scriptPending} 条脚本待生成语音；`);
  console.log(`3. ${voicePending} 条语音待发布；`);
  console.log("");
  console.log("请问你接下来想处理什么？");
}
