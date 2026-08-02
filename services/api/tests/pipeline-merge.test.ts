import { describe, expect, it } from "vitest";
import { mergeEpisodeAudio, type MergeDeps } from "../src/pipeline/merge";
import { getFfmpegPath, makeSilenceWav } from "./helpers/silence-wav";

describe("mergeEpisodeAudio", () => {
  it("concats main with intro/outro when assets exist", async () => {
    const deps: MergeDeps = {
      ffmpegPath: getFfmpegPath(),
      assets: {
        get: async (key) =>
          key.includes("intro") || key.includes("outro") ? makeSilenceWav() : null,
      },
    };
    const out = await mergeEpisodeAudio({
      language: "zh",
      mainAudio: makeSilenceWav(),
      deps,
    });
    expect(out.length).toBeGreaterThan(makeSilenceWav().length); // 拼接后更大
  });

  it("degrades to main-only when assets missing", async () => {
    const deps: MergeDeps = {
      ffmpegPath: getFfmpegPath(),
      assets: { get: async () => null },
    };
    const out = await mergeEpisodeAudio({ language: "zh", mainAudio: makeSilenceWav(), deps });
    expect(out.length).toBeGreaterThan(0);
  });

  it("concats segment audios in order (fallback path)", async () => {
    const deps: MergeDeps = {
      ffmpegPath: getFfmpegPath(),
      assets: { get: async () => null },
    };
    const a = makeSilenceWav();
    const single = await mergeEpisodeAudio({ language: "zh", mainAudio: a, deps });
    const out = await mergeEpisodeAudio({ language: "zh", segmentAudios: [a, a, a], deps });
    expect(out.length).toBeGreaterThan(single.length); // 3 段拼接时长/体积都大于单段
  });
});
