import { describe, expect, it, vi } from "vitest";
import { createPipelineRunner, type RunnerDeps } from "../src/pipeline/runner";
import type { QueueJob } from "../src/pipeline/queue";
import { getFfmpegPath, makeSilenceWav } from "./helpers/silence-wav";

const JOB: QueueJob = { id: "job-1", episodeId: "ep-1" };

const SEGMENTS: { speaker: "host" | "guest"; text: string }[] = [
  { speaker: "host", text: "你好" },
  { speaker: "guest", text: "你好！" },
];

/** upload 阶段产物键：audio/episodes/{userId}/{episodeId}.mp3 */
const AUDIO_KEY = "audio/episodes/user-1/ep-1.mp3";

function makeDeps(overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  const repo = {
    getEpisodeUserId: vi.fn(async () => "user-1"),
    getEpisodeLanguage: vi.fn(async () => "zh"),
    getLatestScript: vi.fn(async () => ({ version: 1, segments: SEGMENTS })),
    getHostModelId: vi.fn(async () => null),
    getGuestModelId: vi.fn(async () => null),
    getVoiceSampleKey: vi.fn(async () => null),
    markJobProgress: vi.fn(async (_jobId: string, _status: string, _progress: number) => {}),
    markJobDone: vi.fn(async (_jobId: string) => {}),
    updateEpisodeAudio: vi.fn(async (_episodeId: string, _audioKey: string, _durationSeconds: number) => {}),
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
      put: vi.fn(async (_key: string, _data: Uint8Array) => {}),
      get: vi.fn(async () => new Uint8Array([9])),
    },
    assets: {
      get: vi.fn(async () => null), // 资产由 Task 11 生成，现在缺失 → merge 降级
    },
    ffmpegPath: getFfmpegPath(),
    ...overrides,
  };
}

describe("createPipelineRunner (full chain: tts → merge → upload → done)", () => {
  it("multi-speaker path: storage.put(音频键) + upload@90 + markJobDone + updateEpisodeAudio(duration>0)", async () => {
    const deps = makeDeps();
    vi.mocked(deps.repo.getHostModelId).mockResolvedValue("host-model");
    vi.mocked(deps.repo.getGuestModelId).mockResolvedValue("guest-model");
    const update = vi.fn(async (_p: number) => {});
    const handler = createPipelineRunner(deps);

    const result = await handler(JOB, update);

    expect(result).toEqual({ status: "done" });
    // 全链进度顺序：queued@10 → tts@20/30/40 → merge@70 → upload@90（DB 持久化 + 事件回调）
    expect(vi.mocked(deps.repo.markJobProgress).mock.calls).toEqual([
      ["job-1", "queued", 10],
      ["job-1", "tts", 20],
      ["job-1", "tts", 30],
      ["job-1", "tts", 40],
      ["job-1", "merge", 70],
      ["job-1", "upload", 90],
    ]);
    expect(update.mock.calls.map(([p]) => p)).toEqual([10, 20, 30, 40, 70, 90]);
    // 主持人模型存在 → 多说话人一次调用，不再逐段合成
    expect(deps.tts.synthesizeMultiSpeaker).toHaveBeenCalledWith({
      segments: [
        { speaker: 0, text: "你好" },
        { speaker: 1, text: "你好！" },
      ],
      referenceIds: ["host-model", "guest-model"],
    });
    expect(deps.tts.synthesizeSingle).not.toHaveBeenCalled();
    // merge 阶段按语言读取 intro/outro 资产（缺失 → 降级只拼主对话）
    expect(deps.assets.get).toHaveBeenCalledWith("assets/intro.zh.mp3");
    expect(deps.assets.get).toHaveBeenCalledWith("assets/outro.zh.mp3");
    // upload：merge 产物字节写入 audio/episodes/{userId}/{episodeId}.mp3
    expect(deps.storage.put).toHaveBeenCalledTimes(1);
    const [putKey, putAudio] = vi.mocked(deps.storage.put).mock.calls[0];
    expect(putKey).toBe(AUDIO_KEY);
    expect(putAudio).toBeInstanceOf(Uint8Array);
    expect(putAudio.length).toBeGreaterThan(0);
    // 落库完成：markJobDone(jobId) + updateEpisodeAudio(episodeId, key, duration>0)
    expect(deps.repo.markJobDone).toHaveBeenCalledWith("job-1");
    expect(deps.repo.markJobDone).toHaveBeenCalledTimes(1);
    const [episodeId, audioKey, durationSeconds] = vi.mocked(deps.repo.updateEpisodeAudio).mock.calls[0];
    expect(episodeId).toBe("ep-1");
    expect(audioKey).toBe(AUDIO_KEY);
    expect(durationSeconds).toBeGreaterThan(0);
    // merge 阶段真实 ffmpeg 产物时长非零（Duration 正则解析）
    expect(deps.repo.updateEpisodeAudio).toHaveBeenCalledTimes(1);
  });

  it("fallback path: storage sample bytes + per-segment synthesize → full chain to done", async () => {
    const deps = makeDeps();
    vi.mocked(deps.repo.getHostModelId).mockResolvedValue(null);
    vi.mocked(deps.repo.getGuestModelId).mockResolvedValue(null);
    vi.mocked(deps.repo.getVoiceSampleKey).mockResolvedValue("voice/user-1.wav");
    const update = vi.fn(async (_p: number) => {});
    const handler = createPipelineRunner(deps);

    const result = await handler(JOB, update);

    expect(result).toEqual({ status: "done" });
    expect(deps.storage.get).toHaveBeenCalledWith("voice/user-1.wav");
    expect(deps.tts.synthesizeMultiSpeaker).not.toHaveBeenCalled();
    expect(deps.tts.synthesizeSingle).toHaveBeenCalledTimes(2);
    expect(deps.tts.synthesizeSingle).toHaveBeenNthCalledWith(1, { text: "你好", referenceAudio: new Uint8Array([9]) });
    expect(deps.tts.synthesizeSingle).toHaveBeenNthCalledWith(2, { text: "你好！", referenceId: undefined });
    expect(vi.mocked(deps.repo.markJobProgress).mock.calls.at(-1)).toEqual(["job-1", "upload", 90]);
    expect(vi.mocked(deps.storage.put).mock.calls[0][0]).toBe(AUDIO_KEY);
    expect(deps.repo.markJobDone).toHaveBeenCalledWith("job-1");
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
