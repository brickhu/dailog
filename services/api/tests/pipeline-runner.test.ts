import { describe, expect, it, vi } from "vitest";
import { createPipelineRunner, type RunnerDeps } from "../src/pipeline/runner";
import type { QueueJob } from "../src/pipeline/queue";
import { getFfmpegPath, makeSilenceWav } from "./helpers/silence-wav";

const JOB: QueueJob = { id: "job-1", episodeId: "ep-1" };

const SEGMENTS: { speaker: "host" | "guest"; text: string }[] = [
  { speaker: "host", text: "你好" },
  { speaker: "guest", text: "你好！" },
];

function makeDeps(overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  const repo = {
    getEpisodeUserId: vi.fn(async () => "user-1"),
    getEpisodeLanguage: vi.fn(async () => "zh"),
    getLatestScript: vi.fn(async () => ({ version: 1, segments: SEGMENTS })),
    getHostModelId: vi.fn(async () => null),
    getGuestModelId: vi.fn(async () => null),
    getVoiceSampleKey: vi.fn(async () => null),
    markJobProgress: vi.fn(async () => {}),
    markJobDone: vi.fn(async () => {}),
    updateEpisodeAudio: vi.fn(async () => {}),
  };
  return {
    repo,
    tts: {
      // merge 阶段跑真实 ffmpeg，mock 必须返回合法音频字节
      synthesizeMultiSpeaker: vi.fn(async () => makeSilenceWav()),
      synthesizeSingle: vi.fn(async () => makeSilenceWav()),
      createVoiceModel: vi.fn(),
    } as unknown as RunnerDeps["tts"],
    storage: {
      put: vi.fn(async () => {}),
      get: vi.fn(async () => new Uint8Array([9])),
    },
    assets: {
      get: vi.fn(async () => null), // 资产由 Task 11 生成，现在缺失 → merge 降级
    },
    ffmpegPath: getFfmpegPath(),
    ...overrides,
  };
}

describe("createPipelineRunner (tts + merge stages)", () => {
  it("multi-speaker path: host+guest model ids → single call, merge@70, then upload not implemented", async () => {
    const deps = makeDeps();
    vi.mocked(deps.repo.getHostModelId).mockResolvedValue("host-model");
    vi.mocked(deps.repo.getGuestModelId).mockResolvedValue("guest-model");
    const update = vi.fn(async () => {});
    const handler = createPipelineRunner(deps);

    await expect(handler(JOB, update)).rejects.toThrow("upload not implemented (Task 9)");

    // 阶段边界：tts 推进到 40，merge 推进到 70（DB 持久化 + 事件回调）
    expect(deps.repo.markJobProgress).toHaveBeenNthCalledWith(4, "job-1", "tts", 40);
    expect(deps.repo.markJobProgress).toHaveBeenNthCalledWith(5, "job-1", "merge", 70);
    expect(update).toHaveBeenNthCalledWith(4, 40);
    expect(update).toHaveBeenNthCalledWith(5, 70);
    // 主持人模型存在 → 多说话人一次调用，不再逐段合成
    expect(deps.tts.synthesizeMultiSpeaker).toHaveBeenCalledWith({
      segments: [
        { speaker: 0, text: "你好" },
        { speaker: 1, text: "你好！" },
      ],
      referenceIds: ["host-model", "guest-model"],
    });
    expect(deps.tts.synthesizeSingle).not.toHaveBeenCalled();
    // 有录音样本键时 storage 读字节；本路径未用到
    expect(deps.storage.get).not.toHaveBeenCalled();
    // merge 阶段按语言读取 intro/outro 资产（缺失 → 降级只拼主对话）
    expect(deps.assets.get).toHaveBeenCalledWith("assets/intro.zh.mp3");
    expect(deps.assets.get).toHaveBeenCalledWith("assets/outro.zh.mp3");
  });

  it("fallback path: no host model → storage bytes + per-segment synthesize, merge@70", async () => {
    const deps = makeDeps();
    vi.mocked(deps.repo.getHostModelId).mockResolvedValue(null);
    vi.mocked(deps.repo.getGuestModelId).mockResolvedValue(null);
    vi.mocked(deps.repo.getVoiceSampleKey).mockResolvedValue("voice/user-1.wav");
    const update = vi.fn(async () => {});
    const handler = createPipelineRunner(deps);

    await expect(handler(JOB, update)).rejects.toThrow("upload not implemented (Task 9)");

    expect(deps.storage.get).toHaveBeenCalledWith("voice/user-1.wav");
    expect(deps.tts.synthesizeMultiSpeaker).not.toHaveBeenCalled();
    expect(deps.tts.synthesizeSingle).toHaveBeenCalledTimes(2);
    expect(deps.tts.synthesizeSingle).toHaveBeenNthCalledWith(1, { text: "你好", referenceAudio: new Uint8Array([9]) });
    expect(deps.tts.synthesizeSingle).toHaveBeenNthCalledWith(2, { text: "你好！", referenceId: undefined });
    expect(deps.repo.markJobProgress).toHaveBeenLastCalledWith("job-1", "merge", 70);
  });

  it("fails early with clear errors when episode or script is missing", async () => {
    const noEpisode = makeDeps();
    vi.mocked(noEpisode.repo.getEpisodeUserId).mockResolvedValue(null);
    await expect(createPipelineRunner(noEpisode)(JOB, vi.fn(async () => {}))).rejects.toThrow("episode not found");

    const noScript = makeDeps();
    vi.mocked(noScript.repo.getLatestScript).mockResolvedValue(null);
    await expect(createPipelineRunner(noScript)(JOB, vi.fn(async () => {}))).rejects.toThrow("script not found");
  });
});
