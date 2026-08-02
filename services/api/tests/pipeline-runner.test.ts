import { describe, expect, it, vi } from "vitest";
import { createPipelineRunner, type RunnerDeps } from "../src/pipeline/runner";
import type { QueueJob } from "../src/pipeline/queue";

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
      synthesizeMultiSpeaker: vi.fn(async () => new Uint8Array([1])),
      synthesizeSingle: vi.fn(async () => new Uint8Array([2])),
      createVoiceModel: vi.fn(),
    } as unknown as RunnerDeps["tts"],
    storage: {
      put: vi.fn(async () => {}),
      get: vi.fn(async () => new Uint8Array([9])),
    },
    ...overrides,
  };
}

describe("createPipelineRunner (tts stage)", () => {
  it("multi-speaker path: host+guest model ids → single call, marks tts@40, then merge not implemented", async () => {
    const deps = makeDeps();
    vi.mocked(deps.repo.getHostModelId).mockResolvedValue("host-model");
    vi.mocked(deps.repo.getGuestModelId).mockResolvedValue("guest-model");
    const update = vi.fn(async () => {});
    const handler = createPipelineRunner(deps);

    await expect(handler(JOB, update)).rejects.toThrow("merge not implemented");

    // 阶段边界：tts 阶段完整推进到 40，DB 持久化 + 事件回调
    expect(deps.repo.markJobProgress).toHaveBeenNthCalledWith(4, "job-1", "tts", 40);
    expect(update).toHaveBeenNthCalledWith(4, 40);
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
  });

  it("fallback path: no host model → storage bytes + per-segment synthesize, then merge not implemented", async () => {
    const deps = makeDeps();
    vi.mocked(deps.repo.getHostModelId).mockResolvedValue(null);
    vi.mocked(deps.repo.getGuestModelId).mockResolvedValue(null);
    vi.mocked(deps.repo.getVoiceSampleKey).mockResolvedValue("voice/user-1.wav");
    const update = vi.fn(async () => {});
    const handler = createPipelineRunner(deps);

    await expect(handler(JOB, update)).rejects.toThrow("not implemented");

    expect(deps.storage.get).toHaveBeenCalledWith("voice/user-1.wav");
    expect(deps.tts.synthesizeMultiSpeaker).not.toHaveBeenCalled();
    expect(deps.tts.synthesizeSingle).toHaveBeenCalledTimes(2);
    expect(deps.tts.synthesizeSingle).toHaveBeenNthCalledWith(1, { text: "你好", referenceAudio: new Uint8Array([9]) });
    expect(deps.tts.synthesizeSingle).toHaveBeenNthCalledWith(2, { text: "你好！", referenceId: undefined });
    expect(deps.repo.markJobProgress).toHaveBeenLastCalledWith("job-1", "tts", 40);
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
