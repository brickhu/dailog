import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { createTokenVerifier } from "./auth/verify";
import { createDb } from "./db/client";
import { createRepo } from "./repo";
import { createLlmClient } from "./llm/client";
import { qualityCheckPrompt, safetyCheckPrompt, parseJsonLoose, type QualityResult } from "./llm/prompts";
import { createJobQueue } from "./pipeline/queue";
import { createPipelineRunner } from "./pipeline/runner";
import { createLocalAssetStore } from "./pipeline/assets";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { createTtsClient } from "./tts/client";
import { createStorage } from "./storage";
import { recoverQueuedJobs } from "./pipeline/bootstrap";
import type { PolishDeps } from "./routes/polish";
import type { GenerateDeps } from "./routes/generate";
import type { JobDeps } from "./routes/job";

const env = loadEnv();

// DB 接入：drizzle repo（imports + episodes）
const { db } = createDb(env);
const repo = createRepo(db);

const llm = createLlmClient({
  apiKey: env.DEEPSEEK_API_KEY,
  baseUrl: env.DEEPSEEK_BASE_URL,
  model: env.DEEPSEEK_MODEL,
});

// 进程内串行生成队列（MVP 单实例，ARC §3.1）：重试 + 指数退避
const queue = createJobQueue(createPipelineRunner({
  repo: {
    getEpisodeUserId: repo.episodes.getEpisodeUserId,
    getEpisodeLanguage: repo.episodes.getEpisodeLanguage,
    getLatestScript: repo.episodes.getLatestScript,
    getHostModelId: repo.episodes.getHostModelId,
    getVoiceSampleKey: repo.episodes.getVoiceSampleKey,
    // 嘉宾固定音色 id 尚未提供（Task 10 音色体系），暂为 null → 走零样本 fallback
    getGuestModelId: async () => null,
    markJobProgress: repo.jobs.markJobProgress,
    markJobDone: repo.jobs.markJobDone,
    updateEpisodeAudio: repo.jobs.updateEpisodeAudio,
  },
  tts: createTtsClient({ apiKey: env.FISH_API_KEY }),
  storage: createStorage({ driver: env.STORAGE_DRIVER, dir: env.STORAGE_DIR }),
  // merge 阶段：intro/outro 资产（缺失 → 降级）+ 真实 ffmpeg 二进制
  assets: createLocalAssetStore(env.ASSETS_DIR),
  ffmpegPath: ffmpegInstaller.path,
}), { concurrency: 1, maxAttempts: 2, backoffMs: 1000 });

// 启动恢复：把上次未完成（queued/tts/merge/upload）的 job 重新入队（不阻塞 serve）
void recoverQueuedJobs(repo.jobs, (job) => queue.enqueue(job, () => {}).then(() => {})).then((n) => {
  console.log(`[queue] boot recovery: re-enqueued ${n} uncompleted job(s)`);
});

const polish: PolishDeps = {
  // 质量门 + 语言检测：一次非流式补全，输出 JSON { pass, reason?, language }
  getDialogueMessages: (episodeId, userId) => repo.episodes.getImportedDialogue(episodeId, userId),
  qualityCheck: async (messages) => parseJsonLoose(await llm.complete(qualityCheckPrompt(messages))) as QualityResult,
  savePolished: async (episodeId, _language, segments) => {
    const latest = await repo.episodes.getLatestScript(episodeId);
    return repo.episodes.saveScript(episodeId, (latest?.version ?? 0) + 1, segments);
  },
  llm,
};

const generate: GenerateDeps = {
  getOwnedEpisode: (episodeId, userId) => repo.episodes.getEpisode(episodeId, userId),
  getLatestScript: (episodeId) => repo.episodes.getLatestScript(episodeId),
  // 安全门（PRD §4.4）：编辑后脚本一次非流式补全，输出 JSON { pass, reason? }
  safetyCheck: async (segments) => parseJsonLoose(await llm.complete(safetyCheckPrompt(segments))) as { pass: boolean; reason?: string },
  getQuota: (userId) => repo.jobs.getQuotaInfo(userId),
  consumeQuota: (userId, credit) => repo.jobs.consumeQuota(userId, credit),
  createJob: (episodeId) => repo.jobs.createJob(episodeId),
  // 进程内队列：异步消费（runner 骨架在 Task 7-9 填充分阶段实现）
  enqueueJob: async (job) => {
    await queue.enqueue({ id: job.id, episodeId: job.episodeId }, (p) => {
      console.log(`[queue] job ${job.id} progress ${p}%`);
    });
  },
};

const job: JobDeps = {
  getLatestJob: (episodeId) => repo.jobs.getLatestJob(episodeId),
};

const app = createApp({
  env,
  verifyToken: createTokenVerifier(env.SUPABASE_JWKS_URL, `${env.SUPABASE_URL}/auth/v1`),
  repo,
  polish,
  generate,
  job,
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api listening on :${info.port}`);
});
