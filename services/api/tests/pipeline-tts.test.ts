import { describe, expect, it, vi } from "vitest";
import { synthesizeEpisode, type TtsDeps } from "../src/pipeline/tts";

const segments: { speaker: "host" | "guest"; text: string }[] = [
  { speaker: "host", text: "你好" },
  { speaker: "guest", text: "你好！" },
  { speaker: "host", text: "再见" },
];

describe("synthesizeEpisode（样本直传：无音色训练，恒逐段合成）", () => {
  it("host 段内联参考音频（零样本），guest 段用固定音色", async () => {
    const single = vi.fn(async () => new Uint8Array([2]));
    const deps: TtsDeps = {
      tts: { synthesizeSingle: single } as never,
      guestModelId: "guest-model",
      hostReferenceAudio: new Uint8Array([9]),
      language: "zh",
    };
    const out = await synthesizeEpisode({ segments, deps });
    expect(single).toHaveBeenCalledTimes(3);
    expect(single).toHaveBeenNthCalledWith(1, { text: "你好", referenceAudio: new Uint8Array([9]) });
    expect(single).toHaveBeenNthCalledWith(2, { text: "你好！", referenceId: "guest-model" });
    expect(single).toHaveBeenNthCalledWith(3, { text: "再见", referenceAudio: new Uint8Array([9]) });
    expect(out.kind).toBe("segments");
    expect((out as { kind: "segments"; segmentAudios: Uint8Array[] }).segmentAudios).toHaveLength(3);
  });

  it("无录音样本时 host 段不带 referenceAudio（弱化降级），guest 段固定音色不受影响", async () => {
    const single = vi.fn(async () => new Uint8Array([2]));
    const deps: TtsDeps = {
      tts: { synthesizeSingle: single } as never,
      guestModelId: "guest-model",
      hostReferenceAudio: null,
      language: "zh",
    };
    await synthesizeEpisode({ segments, deps });
    expect(single).toHaveBeenNthCalledWith(1, { text: "你好", referenceAudio: undefined });
  });

  it("host/guest 参考音频齐备 → references 2D 一次调用（多说话人）", async () => {
    const multi = vi.fn(async () => new Uint8Array([1]));
    const deps: TtsDeps = {
      tts: { synthesizeMultiSpeaker: multi, synthesizeSingle: vi.fn() } as never,
      guestModelId: "guest-model",
      hostReferenceAudio: new Uint8Array([9]),
      guestReferenceAudio: new Uint8Array([8]),
      language: "zh",
    };
    const out = await synthesizeEpisode({ segments, deps });
    expect(out).toEqual({ kind: "single", mainAudio: new Uint8Array([1]) });
    expect(multi).toHaveBeenCalledWith({
      segments: [
        { speaker: 0, text: "你好" },
        { speaker: 1, text: "你好！" },
        { speaker: 0, text: "再见" },
      ],
      referenceAudios: [new Uint8Array([9]), new Uint8Array([8])],
      transcripts: [null, "大家好，我是 dailog 的 AI 嘉宾，很高兴和你一起聊今天的节目。无论科技、生活还是创作，好内容都值得被听见。让我们开始吧！"],
    });
    expect(deps.tts.synthesizeSingle).not.toHaveBeenCalled();
  });

  it("2D 失败自动降级逐段（不中断生成）", async () => {
    const multi = vi.fn(async () => {
      throw new Error("tts http_400: data did not match");
    });
    const single = vi.fn(async () => new Uint8Array([2]));
    const deps: TtsDeps = {
      tts: { synthesizeMultiSpeaker: multi, synthesizeSingle: single } as never,
      guestModelId: "guest-model",
      hostReferenceAudio: new Uint8Array([9]),
      guestReferenceAudio: new Uint8Array([8]),
      language: "zh",
    };
    const out = await synthesizeEpisode({ segments, deps });
    expect(out.kind).toBe("segments");
    expect(single).toHaveBeenCalledTimes(3);
    expect(single).toHaveBeenNthCalledWith(1, { text: "你好", referenceAudio: new Uint8Array([9]) });
  });

  it("仅 host 有样本（无嘉宾音频）→ 逐段降级", async () => {
    const multi = vi.fn();
    const single = vi.fn(async () => new Uint8Array([2]));
    const deps: TtsDeps = {
      tts: { synthesizeMultiSpeaker: multi, synthesizeSingle: single } as never,
      guestModelId: "guest-model",
      hostReferenceAudio: new Uint8Array([9]),
      guestReferenceAudio: null,
      language: "zh",
    };
    const out = await synthesizeEpisode({ segments, deps });
    expect(out.kind).toBe("segments");
    expect(multi).not.toHaveBeenCalled();
    expect(single).toHaveBeenNthCalledWith(2, { text: "你好！", referenceId: "guest-model" });
  });
});
