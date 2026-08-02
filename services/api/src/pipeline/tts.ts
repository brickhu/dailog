import type { TtsClient } from "../tts/client";

export interface ScriptSeg { speaker: "host" | "guest"; text: string; }

export interface TtsDeps {
  tts: TtsClient;
  hostModelId: string | null;         // 主持人音色模型 id（voice_samples.reference_id）
  guestModelId: string | null;        // 嘉宾固定音色 id
  hostReferenceAudio?: Uint8Array | null; // fallback 零样本用（用户录音样本）
}

export type SynthesizeResult =
  | { kind: "single"; mainAudio: Uint8Array }
  | { kind: "segments"; segmentAudios: Uint8Array[] };

/**
 * 主路径：主持人音色存在 → 多说话人一次调用（speaker 标签 + reference_id 数组，实测见 fish-audio.md）
 * fallback：无主持人音色 → 逐段合成（host 段 msgpack 内联零样本，guest 段固定音色），由 merge 按序拼接
 */
export async function synthesizeEpisode(args: {
  segments: ScriptSeg[];
  deps: TtsDeps;
}): Promise<SynthesizeResult> {
  const { segments, deps } = args;
  if (deps.hostModelId && deps.guestModelId) {
    const mainAudio = await deps.tts.synthesizeMultiSpeaker({
      segments: segments.map((s) => ({ speaker: s.speaker === "host" ? 0 : 1, text: s.text })),
      referenceIds: [deps.hostModelId, deps.guestModelId],
    });
    return { kind: "single", mainAudio };
  }
  const segmentAudios: Uint8Array[] = [];
  for (const seg of segments) {
    const audio = seg.speaker === "host"
      ? await deps.tts.synthesizeSingle({ text: seg.text, referenceAudio: deps.hostReferenceAudio ?? undefined })
      : await deps.tts.synthesizeSingle({ text: seg.text, referenceId: deps.guestModelId ?? undefined });
    segmentAudios.push(audio);
  }
  return { kind: "segments", segmentAudios };
}
