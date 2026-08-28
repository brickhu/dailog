// 补录投稿主持人称呼（callName）：投稿缺称呼（detail 显示「主持人称呼：无」）时，编辑确认后写入并持久化
//   pnpm editor callname <submissionId> --name "飞"
//   → POST /v1/editor/submissions/:id/callname → submissions.call_name（脚本开场自我介绍用，不再回退「主持人」）
import type { EditorConfig } from "./lib.js";
import { api } from "./lib.js";

export async function callname(config: EditorConfig, args: string[]): Promise<void> {
  const id = args.find((a) => !a.startsWith("-"));
  const idx = args.indexOf("--name");
  const name = idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  if (!id || !name) {
    console.error('用法：pnpm editor callname <submissionId> --name "称呼"（如 --name 飞）');
    process.exit(1);
  }
  const res = (await api(config, `/v1/editor/submissions/${id}/callname`, { method: "POST", body: { name } })) as {
    ok?: boolean;
    callName?: string;
  };
  console.log(`[callname] ✅ 主持人称呼已持久化：${id.slice(0, 8)}… → ${res.callName ?? name}（detail 起即生效，不再回退「主持人」）`);
}
