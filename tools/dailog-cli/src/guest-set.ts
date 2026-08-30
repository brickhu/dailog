// 嘉宾称呼/简介管理（服务端配置——节目中的称呼）：
//   pnpm editor guest-set <guestId> --name "Claude" [--intro "Anthropic 的 AI 助手"]
//   → PUT /v1/editor/guests/:guestId → guests 表（脚本生成时称呼服务端配置）
import type { EditorConfig } from "./lib.js";
import { api } from "./lib.js";

export async function guestSet(config: EditorConfig, args: string[]): Promise<void> {
  const guestId = args[0];
  const take = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
  };
  const name = take("--name");
  const intro = take("--intro");
  if (!guestId || (!name && intro === undefined)) {
    console.error("用法：pnpm editor guest-set <guestId> --name \"称呼\" [--intro \"简介\"]");
    process.exit(1);
  }
  const body: Record<string, string> = {};
  if (name) body.name = name;
  if (intro !== undefined) body.intro = intro;
  await api(config, `/v1/editor/guests/${guestId}`, { method: "PUT", body });
  console.log(`[guest-set] ✅ 嘉宾 ${guestId} 称呼已更新：${name ?? "（简介变更）"}${intro !== undefined ? ` / 简介：${intro.slice(0, 40)}${intro.length > 40 ? "…" : ""}` : ""}`);
}
