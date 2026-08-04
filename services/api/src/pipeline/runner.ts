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
    getGuestModelId(): Promise<string | null>;
    /** 读最新录音样本整行（audioUrl + transcript）；无记录返回 null */
    getVoiceSample(userId: string): Promise<{ audioUrl: string; transcript: string | null } | null>;
    markJobProgress(jobId: string, status: string, progress: number): Promise<void>;
    markJobDone(jobId: string): Promise<void>;
    updateEpisodeAudio(episodeId: string, audioKey: string, durationSeconds: number): Promise<void>;
  };
  tts: TtsClient;
  storage: AudioStorage;
  assets: MergeDeps["assets"];
  ffmpegPath: string;
}

/** 生成管线执行器：queued → tts → merge → upload → done/failed */
export function createPipelineRunner(deps: RunnerDeps): JobHandler {
  return async (job, update) => {
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

    // 2. 加载音色：主持人录音样本（整行：audioUrl + 转录文本）+ 嘉宾参考音频（资产，references 2D 主路径用）
    await progress("tts", 20);
    const guestModelId = await deps.repo.getGuestModelId();
    const sample = await deps.repo.getVoiceSample(userId);
    const hostReferenceAudio = sample ? await deps.storage.get(sample.audioUrl) : null;
    const hostTranscript = sample?.transcript ?? null;
    const guestReferenceAudio = await deps.assets.get("assets/guest-voice-zh.mp3");

    // 3. 合成（主路径：references 2D 一次调用，转录文本精确；失败/缺样本 → 逐段降级），结果留内存供 merge 使用
    await progress("tts", 30);
    const ttsResult: SynthesizeResult = await synthesizeEpisode({
      segments: script.segments,
      deps: { tts: deps.tts, guestModelId, hostReferenceAudio, hostTranscript, guestReferenceAudio, language },
    });

    // 4. ffmpeg 拼接 + 时长探测：intro + 主对话 + outro（资产缺失自动降级），产物留内存供 upload
    await progress("tts", 40);
    const { audio, durationSeconds } = await mergeEpisodeAudio({
      language,
      result: ttsResult,
      deps: { ffmpegPath: deps.ffmpegPath, assets: deps.assets },
    });

    // 5. upload：产物写入存储（audio/episodes/{userId}/{episodeId}.mp3）+ 落库完成。
    //    先 updateEpisodeAudio 再 markJobDone：job 标记 done 时音频必已可读（轮询方无竞态窗口）
    await progress("merge", 70);
    // R2 目录规划：episodes/{userId}/{episodeId}.mp3
    const audioKey = `episodes/${userId}/${job.episodeId}.mp3`;
    await deps.storage.put(audioKey, audio);
    await progress("upload", 90);
    await deps.repo.updateEpisodeAudio(job.episodeId, audioKey, durationSeconds);
    await deps.repo.markJobDone(job.id);
    return { status: "done" };
  };
}
