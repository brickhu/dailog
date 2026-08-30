// 嘉宾列表查看（管理入口）：称呼/简介 + 声线就绪状态
//   pnpm editor guests
//   → GET /v1/editor/guests（id/name/intro）+ /v1/editor/guests 声线状态（通过 listVoiceSamples 聚合）
import type { EditorConfig } from "./lib.js";
import { api } from "./lib.js";

interface GuestRow {
  id: string;
  platform: string;
  name: string;
  avatar: string | null;
  intro: string | null;
  url: string | null;
}

interface VoiceSampleRow {
  guestId: string;
  guestName: string;
  language: string;
  audioKey: string;
  transcript: string | null;
}

export async function guests(config: EditorConfig, _args: string[]): Promise<void> {
  const [list, samples] = await Promise.all([
    api(config, "/v1/editor/guests") as Promise<GuestRow[]>,
    api(config, "/v1/editor/guests/voice-samples").catch(() => []) as Promise<VoiceSampleRow[]>,
  ]);
  if (list.length === 0) {
    console.log("[guests] 无嘉宾记录");
    return;
  }
  // 声线按 guestId 聚合语言清单
  const voicesByGuest = new Map<string, string[]>();
  for (const s of samples) {
    const langs = voicesByGuest.get(s.guestId) ?? [];
    langs.push(`${s.language}${s.transcript ? "✓" : ""}`);
    voicesByGuest.set(s.guestId, langs);
  }
  console.log(`[guests] 嘉宾（${list.length}）：`);
  for (const g of list) {
    const voices = voicesByGuest.get(g.id);
    const voiceText = voices && voices.length > 0 ? voices.join(" / ") : "⚠️ 无声线（guest-voice 上传）";
    console.log(`  ${g.id.padEnd(10)} ${g.name}${g.intro ? ` — ${g.intro.slice(0, 40)}` : ""}`);
    console.log(`            声线：${voiceText}`);
  }
  console.log("\n管理：guest-set 改称呼 · guest-voice 传声线 · tts --guest <id> 使用");
}
