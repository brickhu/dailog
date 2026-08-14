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
    /** 主持人档案快照（投稿时写入；脚本生成注入画像） */
    personaInfo: {
      displayName: string;
      gender: string | null;
      profession: string | null;
      age: string | null;
      bio: string | null;
      nationality: string | null;
    } | null;
    /** 投稿时配置的本次节目称呼（脚本生成时按脚本语言改写：匹配原样/英文通用/小语种转英文；无则「主持人」） */
    callName: string | null;
    /** 投稿时使用的采样（仅记录） */
    voiceSampleId: string | null;
    /** 投稿人全部 ready 采样（按语种；TTS 按 脚本语言→en→唯一 匹配，服务端自动选择） */
    voiceSamples: Array<{ audioUrl: string; transcript: string | null; language: string; status: string; duration: number | null }>;
    episodes: Array<{ id: string; title: string | null; status: string; number: number | null }>;
  };
  console.log(`投稿 ${d.id}（${d.status}）`);
  console.log(`  标题：${d.title ?? "—"}`);
  console.log(`  URL：${d.url}`);
  console.log(`  投稿人：${d.personaInfo?.displayName ?? "?"} <${d.userEmail}>`);
  console.log(`  主持人称呼：${d.callName ?? "无（脚本用「主持人」）"}`);
  const pi = d.personaInfo;
  console.log(`  画像：${[pi?.gender && `性别 ${pi.gender}`, pi?.profession && `职业 ${pi.profession}`, pi?.age && `年龄 ${pi.age}`, pi?.nationality && `国籍 ${pi.nationality}`, pi?.bio && `简介 ${pi.bio.slice(0, 40)}`].filter(Boolean).join("、") || "（无，脚本不强求）"}`);
  console.log(`  拒审原因：${d.rejectedReason ?? "—"}`);
  console.log(`  采样（${d.voiceSamples.length}）：${d.voiceSamples.length > 0 ? d.voiceSamples.map((s) => `✅ ${s.language}${s.language === d.voiceSampleId ? "" : ""}（transcript: ${(s.transcript ?? "无").slice(0, 40)}…）`).join("\n        ") : "❌ 无（无法克隆主持人音色）"}`);
  if (d.episodes.length > 0) {
    console.log(`  已上线节目：${d.episodes.map((e) => `第${e.number}期《${e.title ?? "?"}》`).join("、")}`);
  }
  console.log("\n下一步：pnpm editor fetch <id> 采集解码 → 生成脚本 → tts（host 采样服务端取用）→ merge → publish");
}
