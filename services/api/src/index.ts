import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { createAuth } from "./auth/better-auth";
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
import { createProxyFetch } from "./net/proxy";
import { recoverQueuedJobs } from "./pipeline/bootstrap";
import type { PolishDeps } from "./routes/polish";
import type { GenerateDeps } from "./routes/generate";
import type { JobDeps } from "./routes/job";
import type { VoiceDeps } from "./routes/voice";
import { createActivateChannel } from "./routes/channel";
import { createFavoritesRepo } from "./routes/favorites";

const env = loadEnv();

// DB 接入：drizzle repo（imports + episodes）
const { db } = createDb(env);
const repo = createRepo(db);

const llm = createLlmClient({
  apiKey: env.DEEPSEEK_API_KEY,
  baseUrl: env.DEEPSEEK_BASE_URL,
  model: env.DEEPSEEK_MODEL,
});

// TTS：Fish Audio 直连；配置 FISH_PROXY_URL（本地 socks5 代理）时经代理出网。
// 无 key 时 voice 路由 503（deps.voice.tts = null）；生成管线保持原行为（空 key client 调用时失败）
if (!env.FISH_API_KEY) console.warn("[tts] FISH_API_KEY 未配置：generate 管线 tts 阶段将失败，voice-sample 路由返回 503，E2E 前请配置");
const tts = env.FISH_API_KEY
  ? createTtsClient({ apiKey: env.FISH_API_KEY, fetchImpl: createProxyFetch(env.FISH_PROXY_URL) })
  : null;

const storage = createStorage({ driver: env.STORAGE_DRIVER, dir: env.STORAGE_DIR });

// 进程内串行生成队列（MVP 单实例，ARC §3.1）：重试 + 指数退避
const queue = createJobQueue(createPipelineRunner({
  repo: {
    getEpisodeUserId: repo.episodes.getEpisodeUserId,
    getEpisodeLanguage: repo.episodes.getEpisodeLanguage,
    getLatestScript: repo.episodes.getLatestScript,
    getHostModelId: repo.episodes.getHostModelId,
    getVoiceSampleKey: repo.episodes.getVoiceSampleKey,
    // 嘉宾固定音色 id 尚未提供（Task 10 音色体系），暂为 null → 走零样本 fallback
    getGuestModelId: async () => env.FISH_GUEST_REFERENCE_ID ?? null,
    markJobProgress: repo.jobs.markJobProgress,
    markJobDone: repo.jobs.markJobDone,
    updateEpisodeAudio: repo.jobs.updateEpisodeAudio,
  },
  tts: tts ?? createTtsClient({ apiKey: "", fetchImpl: createProxyFetch(env.FISH_PROXY_URL) }),
  storage,
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
  savePolished: async (episodeId, language, segments) => {
    const latest = await repo.episodes.getLatestScript(episodeId);
    await repo.episodes.setEpisodeLanguage(episodeId, language);
    // 对话级润色计数（仅计 LLM 润色保存；PUT script 手动保存不走此路径）
    await repo.episodes.incrementPolishCount(episodeId);
    return repo.episodes.saveScript(episodeId, (latest?.version ?? 0) + 1, segments);
  },
  // 对话级润色上限（PRD §4.7）：free = POLISH_MAX_VERSIONS（默认 5 版），pro 不限
  getPolishCount: (episodeId) => repo.episodes.getPolishCount(episodeId),
  getPolishLimit: async (userId) => {
    const quota = await repo.jobs.getQuotaInfo(userId);
    return quota.plan === "pro" ? null : env.POLISH_MAX_VERSIONS;
  },
  llm,
};

const generate: GenerateDeps = {
  getOwnedEpisode: (episodeId, userId) => repo.jobs.getOwnedEpisode(episodeId, userId),
  getLatestScript: (episodeId) => repo.episodes.getLatestScript(episodeId),
  getChannelActive: async (userId) => (await repo.episodes.getChannelActivatedAt(userId)) !== null,
  // 安全门（PRD §4.4）：编辑后脚本一次非流式补全，输出 JSON { pass, reason? }
  safetyCheck: async (segments) => parseJsonLoose(await llm.complete(safetyCheckPrompt(segments))) as { pass: boolean; reason?: string },
  getQuota: (userId) => repo.jobs.getQuotaInfo(userId),
  consumeQuota: (userId, credit) => repo.jobs.consumeQuota(userId, credit),
  createJob: (episodeId) => repo.jobs.createJob(episodeId),
  // 进程内队列：异步消费（runner 全链：tts → merge → upload）
  enqueueJob: async (job) => {
    // fire-and-forget：202 立即返回，状态由 GET /job 轮询（队列 promise 在任务完成时才 resolve）
    void queue.enqueue({ id: job.id, episodeId: job.episodeId }, (p) => {
      console.log(`[queue] job ${job.id} progress ${p}%`);
    }).then((result) => {
      if (result.status === "failed") {
        // 重试耗尽：失败状态落库，防止重启恢复时重跑（此前一直停在 queued）
        void repo.jobs.markJobFailed(job.id, result.error ?? "unknown").catch((e) =>
          console.error(`[queue] markJobFailed ${job.id} failed`, e));
      }
    }).catch((e) => console.error(`[queue] job ${job.id} failed`, e));
  },
};

const job: JobDeps = {
  getOwnedEpisode: (episodeId, userId) => repo.jobs.getOwnedEpisode(episodeId, userId),
  getLatestJob: (episodeId) => repo.jobs.getLatestJob(episodeId),
};

const voice: VoiceDeps = {
  saveVoiceSample: (row) => repo.episodes.saveVoiceSample(row),
  getVoiceSample: (userId) => repo.episodes.getVoiceSample(userId),
  tts, // FISH_API_KEY 未配置时为 null → 路由返回 503
  storage,
};

const app = createApp({
  env,
  auth: createAuth({
    db,
    env,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: env.APP_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    cookieDomain: env.BETTER_AUTH_COOKIE_DOMAIN,
  }),
  repo,
  polish,
  generate,
  job,
  voice,
  channel: { activateChannel: createActivateChannel(db) },
  favorites: createFavoritesRepo(db),
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api listening on :${info.port}`);
});
