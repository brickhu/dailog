import { describe, expect, it, vi } from "vitest";
import { synthesizeEpisode, type TtsDeps } from "../src/pipeline/tts";

const segments: { speaker: "host" | "guest"; text: string }[] = [
  { speaker: "host", text: "你好" },
  { speaker: "guest", text: "你好！" },
  { speaker: "host", text: "再见" },
];

describe("synthesizeEpisode", () => {
  it("uses multi-speaker single call when host model id exists", async () => {
    const multi = vi.fn(async () => new Uint8Array([1]));
    const deps: TtsDeps = {
      tts: { synthesizeMultiSpeaker: multi, synthesizeSingle: vi.fn(), createVoiceModel: vi.fn() } as never,
      hostModelId: "host-model",
      guestModelId: "guest-model",
    };
    const out = await synthesizeEpisode({ segments, deps });
    expect(out).toEqual({ kind: "single", mainAudio: new Uint8Array([1]) });
    expect(multi).toHaveBeenCalledWith({
      segments: [
        { speaker: 0, text: "你好" },
        { speaker: 1, text: "你好！" },
        { speaker: 0, text: "再见" },
      ],
      referenceIds: ["host-model", "guest-model"],
    });
  });

  it("falls back to per-segment calls without host model id", async () => {
    const single = vi.fn(async () => new Uint8Array([2]));
    const deps: TtsDeps = {
      tts: { synthesizeSingle: single, synthesizeMultiSpeaker: vi.fn(), createVoiceModel: vi.fn() } as never,
      hostModelId: null,
      guestModelId: "guest-model",
      hostReferenceAudio: new Uint8Array([9]),
    };
    const out = await synthesizeEpisode({ segments, deps });
    expect(single).toHaveBeenCalledTimes(3);
    expect(single).toHaveBeenNthCalledWith(1, { text: "你好", referenceAudio: new Uint8Array([9]) });
    expect(single).toHaveBeenNthCalledWith(2, { text: "你好！", referenceId: "guest-model" });
    expect(out.kind).toBe("segments");
    expect((out as { kind: "segments"; segmentAudios: Uint8Array[] }).segmentAudios).toHaveLength(3);
  });
});
