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
const AUDIO_KEY = "episodes/user-1/ep-1.mp3";

function makeDeps(overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  const repo = {
    getEpisodeUserId: vi.fn(async () => "user-1"),
    getEpisodeLanguage: vi.fn(async () => "zh"),
    getEpisodeScript: vi.fn(async () => ({ version: 1, segments: SEGMENTS })),
    getEpisodeGuest: vi.fn(async () => ({ guestId: null })),
    getGuestVoiceSample: vi.fn(async () => null),
    getGuestVoiceSampleAny: vi.fn(async () => null),
    getGuestModelId: vi.fn(async () => null),
    getVoiceSampleByLanguage: vi.fn(async () => null),
    getVoiceSample: vi.fn(async () => null),
    markJobProgress: vi.fn(async (_jobId: string, _status: string, _progress: number) => {}),
    markJobDone: vi.fn(async (_jobId: string) => {}),
    insertTrack: vi.fn(async (_episodeId: string, _language: string, _audioKey: string, _durationSeconds: number) => {}),
  };
  return {
    repo,
    tts: {
      // merge 阶段跑真实 ffmpeg，mock 必须返回合法音频字节
      synthesizeSingle: vi.fn(async () => makeSilenceWav()),
      synthesizeMultiSpeaker: vi.fn(async () => makeSilenceWav()),
    } as unknown as RunnerDeps["tts"],
    storage: {
      put: vi.fn(async (_key: string, _data: Uint8Array) => {}),
      get: vi.fn(async () => new Uint8Array([9])),
      delete: vi.fn(async () => {}),
    },
    assets: {
      get: vi.fn(async () => null), // 资产由 Task 11 生成，现在缺失 → merge 降级
    },
    ffmpegPath: getFfmpegPath(),
    ...overrides,
  };
}

describe("createPipelineRunner (full chain: tts → merge → upload → done)", () => {
  it("样本直传主路径: 逐段合成（host 内联样本）+ storage.put(音频键) + upload@90 + markJobDone", async () => {
    const deps = makeDeps();
    vi.mocked(deps.repo.getGuestModelId).mockResolvedValue("guest-model");
    vi.mocked(deps.repo.getVoiceSample).mockResolvedValue({ audioUrl: "voice/user-1.wav", transcript: "大家好，这是测试文案。" });
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
    // 样本直传：host 段内联录音样本，guest 段固定音色（无训练、无多说话人一次调用）
    expect(deps.storage.get).toHaveBeenCalledWith("voice/user-1.wav");
    expect(deps.tts.synthesizeSingle).toHaveBeenCalledTimes(2);
    expect(deps.tts.synthesizeSingle).toHaveBeenNthCalledWith(1, { text: "你好", referenceAudio: new Uint8Array([9]), referenceAudioTranscript: "大家好，这是测试文案。" });
    expect(deps.tts.synthesizeSingle).toHaveBeenNthCalledWith(2, { text: "你好！", referenceId: "guest-model" });
    expect(vi.mocked(deps.storage.put).mock.calls[0][0]).toBe(AUDIO_KEY);
    expect(deps.repo.markJobDone).toHaveBeenCalledWith("job-1");
  });


  it("嘉宾表采样: 平台 × 语种命中 → 2D references 主路径（host/guest 参考音频齐备）", async () => {
    const deps = makeDeps();
    // host 采样（zh）+ 嘉宾表采样（claude × zh）
    vi.mocked(deps.repo.getVoiceSampleByLanguage).mockResolvedValue({ audioUrl: "voice/user-1.wav", transcript: "大家好，这是测试文案。" });
    vi.mocked(deps.repo.getEpisodeGuest).mockResolvedValue({ guestId: "claude" });
    vi.mocked(deps.repo.getGuestVoiceSample).mockResolvedValue({
      audioKey: "guest-voices/claude/zh.mp3",
      referenceId: null,
      transcript: "我是 dailog 的 AI 嘉宾，很高兴和你一起聊今天的节目。",
    });
    deps.storage.get = vi.fn(async (key: string) =>
      key === "voice/user-1.wav" ? new Uint8Array([1]) : key === "guest-voices/claude/zh.mp3" ? new Uint8Array([2]) : new Uint8Array([9]),
    ) as never;
    const update = vi.fn(async (_p: number) => {});

    const result = await createPipelineRunner(deps)(JOB, update);

    expect(result).toEqual({ status: "done" });
    // 2D 一次调用：host 样本 + 嘉宾表采样（transcript 随采样记录，非代码兜底文案）
    expect(deps.tts.synthesizeMultiSpeaker).toHaveBeenCalledTimes(1);
    const call = vi.mocked(deps.tts.synthesizeMultiSpeaker).mock.calls[0][0];
    expect(call.referenceAudios).toEqual([new Uint8Array([1]), new Uint8Array([2])]);
    expect(call.transcripts).toEqual(["大家好，这是测试文案。", "我是 dailog 的 AI 嘉宾，很高兴和你一起聊今天的节目。"]);
    // 表采样优先：不再请求旧 guest-voice 资产兜底（merge 阶段 intro/outro 资产照常）
    const assetKeys = vi.mocked(deps.assets.get).mock.calls.map((c) => c[0]);
    expect(assetKeys.some((k) => k.startsWith("assets/guest-voice"))).toBe(false);
  });

  it("采样音频缺失（文件不存在）→ 采样视为无效，走资产兜底（不用失效 referenceId）", async () => {
    const deps = makeDeps();
    vi.mocked(deps.repo.getVoiceSampleByLanguage).mockResolvedValue({ audioUrl: "voice/user-1.wav", transcript: "大家好，这是测试文案。" });
    vi.mocked(deps.repo.getEpisodeGuest).mockResolvedValue({ guestId: "deepseek" });
    // 采样记录存在但音频文件读不到（storage.get 抛错）→ 整条采样弃用
    vi.mocked(deps.repo.getGuestVoiceSampleAny).mockResolvedValue({
      audioKey: "guest-voices/deepseek/zh.mp3",
      referenceId: "ref-dead", // 失效音色 id——绝不能被使用
      transcript: "我是嘉宾",
    });
    deps.storage.get = vi.fn(async (key: string) =>
      key === "voice/user-1.wav" ? new Uint8Array([1]) : (() => { throw new Error("missing"); })() as never,
    ) as never;
    const update = vi.fn(async (_p: number) => {});

    const result = await createPipelineRunner(deps)(JOB, update);

    expect(result).toEqual({ status: "done" });
    // 降级到逐段：guest 段不得带失效 referenceId（assets 兜底也缺失 → undefined）
    expect(deps.tts.synthesizeMultiSpeaker).not.toHaveBeenCalled();
    expect(deps.tts.synthesizeSingle).toHaveBeenNthCalledWith(2, { text: "你好！", referenceId: undefined });
  });

  it("嘉宾缺该语种采样 → 任意语种兜底（voiceSampleAny）", async () => {
    const deps = makeDeps();
    vi.mocked(deps.repo.getVoiceSampleByLanguage).mockResolvedValue({ audioUrl: "voice/user-1.wav", transcript: "大家好，这是测试文案。" });
    vi.mocked(deps.repo.getEpisodeGuest).mockResolvedValue({ guestId: "deepseek" });
    // 目标语种 zh 无采样 → any 兜底返回 en 采样
    vi.mocked(deps.repo.getGuestVoiceSample).mockResolvedValue(null);
    vi.mocked(deps.repo.getGuestVoiceSampleAny).mockResolvedValue({
      audioKey: "guest-voices/deepseek/en.mp3",
      referenceId: "ref-deepseek",
      transcript: "Hi, I am the AI guest.",
    });
    deps.storage.get = vi.fn(async (key: string) =>
      key === "voice/user-1.wav" ? new Uint8Array([1]) : new Uint8Array([3]),
    ) as never;
    const update = vi.fn(async (_p: number) => {});

    const result = await createPipelineRunner(deps)(JOB, update);

    expect(result).toEqual({ status: "done" });
    expect(deps.repo.getGuestVoiceSample).toHaveBeenCalledWith("deepseek", "zh");
    expect(deps.repo.getGuestVoiceSampleAny).toHaveBeenCalledWith("deepseek");
    expect(deps.tts.synthesizeMultiSpeaker).toHaveBeenCalledTimes(1);
    const call = vi.mocked(deps.tts.synthesizeMultiSpeaker).mock.calls[0][0];
    expect(call.referenceAudios).toEqual([new Uint8Array([1]), new Uint8Array([3])]);
    // 逐段降级路径的音色 id 也随采样（referenceId）；未请求 guest-voice 资产兜底
    const assetKeys = vi.mocked(deps.assets.get).mock.calls.map((c) => c[0]);
    expect(assetKeys.some((k) => k.startsWith("assets/guest-voice"))).toBe(false);
  });

  it("无样本降级: host 段不带参考音频，仍逐段合成完成", async () => {
    const deps = makeDeps();
    const update = vi.fn(async (_p: number) => {});
    const result = await createPipelineRunner(deps)(JOB, update);

    expect(result).toEqual({ status: "done" });
    // 无样本（getVoiceSampleKey=null）：storage.get 不会被调用，host 段不带参考音频（弱化降级）
    expect(deps.storage.get).not.toHaveBeenCalled();
    expect(deps.tts.synthesizeSingle).toHaveBeenCalledTimes(2);
    expect(deps.tts.synthesizeSingle).toHaveBeenNthCalledWith(1, { text: "你好", referenceAudio: undefined, referenceAudioTranscript: undefined });
    expect(deps.tts.synthesizeSingle).toHaveBeenNthCalledWith(2, { text: "你好！", referenceId: undefined });
    expect(vi.mocked(deps.repo.markJobProgress).mock.calls.at(-1)).toEqual(["job-1", "upload", 90]);
    expect(deps.repo.markJobDone).toHaveBeenCalledWith("job-1");
  });

  it("fails early with clear errors when episode or script is missing", async () => {
    const noEpisode = makeDeps();
    vi.mocked(noEpisode.repo.getEpisodeUserId).mockResolvedValue(null);
    await expect(createPipelineRunner(noEpisode)(JOB, vi.fn(async () => {}))).rejects.toThrow("episode not found");

    const noScript = makeDeps();
    vi.mocked(noScript.repo.getEpisodeScript).mockResolvedValue(null);
    await expect(createPipelineRunner(noScript)(JOB, vi.fn(async () => {}))).rejects.toThrow("script not found");
  });
});
