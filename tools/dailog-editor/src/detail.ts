// 投稿详情：URL + 投稿人 + 采样（transcript 供 TTS 克隆）+ 已上线节目
import type { EditorConfig } from "./lib.js";
import { api } from "./lib.js";

export async function detail(config: EditorConfig, args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("用法：pnpm editor detail <submissionId>");
    process.exit(1);
  }
  const d = (await api(config, `/v1/editor/submissions/${id}`)) as {
    id: string;
    url: string;
    title: string | null;
    status: string;
    rejectedReason: string | null;
    userEmail: string;
    displayName: string;
    /** 投稿人人设 callName（节目中的主持人称呼；无则脚本用「主持人」） */
    callName: string | null;
    voiceSample: { audioUrl: string; transcript: string | null; language: string; status: string } | null;
    episodes: Array<{ id: string; title: string | null; status: string; number: number | null }>;
  };
  console.log(`投稿 ${d.id}（${d.status}）`);
  console.log(`  标题：${d.title ?? "—"}`);
  console.log(`  URL：${d.url}`);
  console.log(`  投稿人：${d.displayName} <${d.userEmail}>`);
  console.log(`  主持人称呼：${d.callName ?? "无（脚本用「主持人」）"}`);
  console.log(`  拒审原因：${d.rejectedReason ?? "—"}`);
  console.log(`  采样：${d.voiceSample ? `✅ ${d.voiceSample.language}（transcript: ${(d.voiceSample.transcript ?? "无").slice(0, 40)}…）` : "❌ 无（无法克隆主持人音色）"}`);
  if (d.episodes.length > 0) {
    console.log(`  已上线节目：${d.episodes.map((e) => `第${e.number}期《${e.title ?? "?"}》`).join("、")}`);
  }
  console.log("\n下一步：pnpm editor fetch <id> 采集解码 → 生成脚本 → tts（host 采样服务端取用）→ merge → publish");
}
