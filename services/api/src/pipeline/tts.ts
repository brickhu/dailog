import type { TtsClient } from "../tts/client";

export interface ScriptSeg { speaker: "host" | "guest"; text: string; }

export interface TtsDeps {
  tts: TtsClient;
  /** 嘉宾固定音色 reference_id（逐段降级路径） */
  guestModelId: string | null;
  /** 主持人零样本参考音频（用户录音样本） */
  hostReferenceAudio?: Uint8Array | null;
  /** 主持人参考音频转录文本（用户朗读的固定文案） */
  hostTranscript?: string | null;
  /** 嘉宾固定参考音频（资产 guest-voice.mp3；与 host 都齐备时走 references 2D 一次调用） */
  guestReferenceAudio?: Uint8Array | null;
  /** 嘉宾参考音频转录文本（采样表记录优先；无则用代码兜底 GUEST_TRANSCRIPTS） */
  guestTranscript?: string | null;
  /** 节目语言（zh/en…）——决定嘉宾转录文本 */
  language: string;
}

/** 嘉宾参考音频转录文本（guest-voice.mp3 的固定文案，按语言）。
 *  与 assets/audio/guest-voice-<lang>.mp3 资产配套——替换嘉宾音频时必须同步更新对应文案。 */
export const GUEST_TRANSCRIPTS: Record<string, string> = {
  zh: "大家好，我是 dailog 的 AI 嘉宾，很高兴和你一起聊今天的节目。无论科技、生活还是创作，好内容都值得被听见。让我们开始吧！",
  en: "Hi, I'm the AI guest on dailog, and I'm thrilled to chat with you today. Whether it's tech, life, or creativity, great stories deserve to be heard. Let's get started!",
};

export type SynthesizeResult =
  | { kind: "single"; mainAudio: Uint8Array }
  | { kind: "segments"; segmentAudios: Uint8Array[] };

/**
 * 样本直传模式（不做音色训练）。
 * 主路径：host/guest 参考音频齐备 → references 2D 多说话人一次调用（已实测 200，
 *        fish-references2d.mjs；转录文本精确：host=用户朗读文案，guest=固定文案）——失败自动降级逐段。
 * 降级：逐段合成——host 段 msgpack 内联样本（真实转录），guest 段固定音色 reference_id。
 */
export async function synthesizeEpisode(args: {
  segments: ScriptSeg[];
  deps: TtsDeps;
}): Promise<SynthesizeResult> {
  const { segments, deps } = args;
  const guestTranscript = deps.guestTranscript ?? GUEST_TRANSCRIPTS[deps.language] ?? null;
  if (deps.hostReferenceAudio && deps.guestReferenceAudio) {
    try {
      const mainAudio = await deps.tts.synthesizeMultiSpeaker({
        segments: segments.map((s) => ({ speaker: s.speaker === "host" ? 0 : 1, text: s.text })),
        referenceAudios: [deps.hostReferenceAudio, deps.guestReferenceAudio],
        transcripts: [deps.hostTranscript ?? null, guestTranscript],
      });
      return { kind: "single", mainAudio };
    } catch {
      // 2D 失败自动降级逐段（已验证路径），不中断生成
    }
  }
  const segmentAudios: Uint8Array[] = [];
  for (const seg of segments) {
    const audio = seg.speaker === "host"
      ? await deps.tts.synthesizeSingle({
          text: seg.text,
          referenceAudio: deps.hostReferenceAudio ?? undefined,
          referenceAudioTranscript: deps.hostTranscript ?? undefined,
        })
      : await deps.tts.synthesizeSingle({ text: seg.text, referenceId: deps.guestModelId ?? undefined });
    segmentAudios.push(audio);
  }
  return { kind: "segments", segmentAudios };
}
