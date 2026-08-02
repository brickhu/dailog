import type { JobHandler } from "./queue";
import { synthesizeEpisode, type SynthesizeResult } from "./tts";
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
}

/** 生成管线执行器：queued → tts → merge → upload → done/failed（阶段实现在 Task 7-9） */
export function createPipelineRunner(deps: RunnerDeps): JobHandler {
  return async (job, update) => {
    // 阶段 1/3：tts。merge（Task 8）/upload（Task 9）保持 throw，队列重试语义依赖异常
    const progress = async (status: string, p: number) => {
      await deps.repo.markJobProgress(job.id, status, p);
      await update(p);
    };

    // 1. 加载 episode：语言 + 归属用户 + 最新脚本
    await progress("queued", 10);
    const userId = await deps.repo.getEpisodeUserId(job.episodeId);
    if (!userId) throw new Error("episode not found");
    const language = await deps.repo.getEpisodeLanguage(job.episodeId);
    const script = await deps.repo.getLatestScript(job.episodeId);
    if (!script || script.segments.length === 0) throw new Error("script not found");

    // 2. 加载音色：主持人模型 id / 嘉宾固定 id / 零样本录音（storage 键 → 字节）
    await progress("tts", 20);
    const hostModelId = await deps.repo.getHostModelId(userId);
    const guestModelId = await deps.repo.getGuestModelId();
    const sampleKey = await deps.repo.getVoiceSampleKey(userId);
    const hostReferenceAudio = sampleKey ? await deps.storage.get(sampleKey) : null;

    // 3. 合成（多说话人一次调用，或零样本逐段 fallback），结果留内存供 merge（Task 8）使用
    await progress("tts", 30);
    const ttsResult: SynthesizeResult = await synthesizeEpisode({
      segments: script.segments,
      deps: { tts: deps.tts, hostModelId, guestModelId, hostReferenceAudio },
    });
    void language; // Task 8 merge 阶段可能使用（如语速/停顿配置），此处仅加载

    await progress("tts", 40);
    void ttsResult; // Task 8：ffmpeg 拼接 single 或 segments 产物
    throw new Error("merge not implemented (Task 8)");
  };
}
