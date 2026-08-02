import type { JobHandler } from "./queue";
import { synthesizeEpisode, type SynthesizeResult } from "./tts";
import { mergeEpisodeAudio, type MergeDeps } from "./merge";
import type { TtsClient } from "../tts/client";
import type { AudioStorage } from "../storage";

export interface RunnerDeps {
  repo: {
    getEpisodeUserId(episodeId: string): Promise<string | null>;
    getEpisodeLanguage(episodeId: string): Promise<string | null>;
    getLatestScript(episodeId: string): Promise<{ version: number; segments: { speaker: "host" | "guest"; text: string }[] } | null>;
    getHostModelId(userId: string): Promise<string | null>;
    getGuestModelId(): Promise<string | null>;
    getVoiceSampleKey(userId: string): Promise<string | null>;
    markJobProgress(jobId: string, status: string, progress: number): Promise<void>;
    markJobDone(jobId: string): Promise<void>;
    updateEpisodeAudio(episodeId: string, audioKey: string, durationSeconds: number): Promise<void>;
  };
  tts: TtsClient;
  storage: AudioStorage;
  assets: MergeDeps["assets"];
  ffmpegPath: string;
}

/** 生成管线执行器：queued → tts → merge → upload → done/failed（upload 在 Task 9 实现） */
export function createPipelineRunner(deps: RunnerDeps): JobHandler {
  return async (job, update) => {
    // 阶段 2/3：merge。upload（Task 9）保持 throw，队列重试语义依赖异常
    const progress = async (status: string, p: number) => {
      await deps.repo.markJobProgress(job.id, status, p);
      await update(p);
    };

    // 1. 加载 episode：语言 + 归属用户 + 最新脚本
    await progress("queued", 10);
    const userId = await deps.repo.getEpisodeUserId(job.episodeId);
    if (!userId) throw new Error("episode not found");
    const language = await deps.repo.getEpisodeLanguage(job.episodeId);
    if (!language) throw new Error("episode language not found");
    const script = await deps.repo.getLatestScript(job.episodeId);
    if (!script || script.segments.length === 0) throw new Error("script not found");

    // 2. 加载音色：主持人模型 id / 嘉宾固定 id / 零样本录音（storage 键 → 字节）
    await progress("tts", 20);
    const hostModelId = await deps.repo.getHostModelId(userId);
    const guestModelId = await deps.repo.getGuestModelId();
    const sampleKey = await deps.repo.getVoiceSampleKey(userId);
    const hostReferenceAudio = sampleKey ? await deps.storage.get(sampleKey) : null;

    // 3. 合成（多说话人一次调用，或零样本逐段 fallback），结果留内存供 merge 使用
    await progress("tts", 30);
    const ttsResult: SynthesizeResult = await synthesizeEpisode({
      segments: script.segments,
      deps: { tts: deps.tts, hostModelId, guestModelId, hostReferenceAudio },
    });

    // 4. ffmpeg 拼接：intro + 主对话 + outro（资产缺失自动降级），产物留内存供 upload（Task 9）使用
    await progress("tts", 40);
    const mergedAudio = await mergeEpisodeAudio({
      language,
      result: ttsResult,
      deps: { ffmpegPath: deps.ffmpegPath, assets: deps.assets },
    });
    void mergedAudio;

    await progress("merge", 70);
    throw new Error("upload not implemented (Task 9)");
  };
}
