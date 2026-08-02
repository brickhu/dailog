import type { JobHandler } from "./queue";

export interface RunnerDeps {
  repo: {
    getOwnedEpisode(episodeId: string, userId: string): Promise<{ id: string } | null>;
    getEpisodeLanguage(episodeId: string): Promise<string | null>;
    getLatestScript(episodeId: string): Promise<{ version: number; segments: { speaker: "host" | "guest"; text: string }[] } | null>;
    getHostModelId(userId: string): Promise<string | null>;
    getGuestModelId(): Promise<string | null>;
    getVoiceSampleAudio(userId: string): Promise<Uint8Array | null>;
    markJobProgress(jobId: string, status: string, progress: number): Promise<void>;
    markJobDone(jobId: string): Promise<void>;
    updateEpisodeAudio(episodeId: string, audioKey: string, durationSeconds: number): Promise<void>;
    // Task 7/8 接线所需（tts/merge 阶段）由后续任务补充，本任务只建骨架
  };
  // Task 7-9 注入
  tts?: unknown;
  storage?: unknown;
  assets?: unknown;
}

/** 生成管线执行器：queued → tts → merge → upload → done/failed（阶段实现在 Task 7-9） */
export function createPipelineRunner(deps: RunnerDeps): JobHandler {
  return async (job, update) => {
    // 骨架：本任务先实现状态推进与错误传播，tts/merge/upload 由 Task 7-9 填充
    await update(5);
    throw new Error("pipeline stages not implemented (Task 7-9)");
  };
}
