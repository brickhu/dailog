import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { createAuth } from "./auth/better-auth";
import { createDb } from "./db/client";
import { createRepo } from "./repo";
import { createLlmClient } from "./llm/client";
import { safetyMetaPrompt, parseJsonLoose } from "./llm/prompts";
import { createJobQueue } from "./pipeline/queue";
import { createPipelineRunner } from "./pipeline/runner";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { createTtsClient } from "./tts/client";
import { createStorage } from "./storage";
import { createProxyFetch } from "./net/proxy";
import { recoverQueuedJobs } from "./pipeline/bootstrap";
import type { JobDeps } from "./routes/job";
import type { ImportDeps } from "./routes/import";
import type { PolishesDeps } from "./routes/polishes";
import type { TranscriptsDeps } from "./routes/transcripts";
import type { EpisodesDeps } from "./routes/episodes";
import type { VoiceDeps } from "./routes/voice";
import { createActivateChannel } from "./routes/channel";
import { createFavoritesRepo } from "./routes/favorites";
import { createAdminDeps } from "./routes/admin";

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

const storage = createStorage({
  driver: env.STORAGE_DRIVER,
  dir: env.STORAGE_DIR,
  // R2 driver 配置（fs 时忽略）；缺任一字段时 S3Client 构造失败会在启动即报错
  r2: {
    accountId: env.R2_ACCOUNT_ID ?? "",
    accessKey: env.R2_ACCESS_KEY ?? "",
    secretKey: env.R2_SECRET_KEY ?? "",
    bucket: env.R2_BUCKET ?? "",
  },
});

// 进程内串行生成队列（MVP 单实例，ARC §3.1）：重试 + 指数退避
const queue = createJobQueue(createPipelineRunner({
  repo: {
    getEpisodeUserId: repo.episodes.getEpisodeUserId,
    getEpisodeLanguage: repo.episodes.getEpisodeLanguage,
    getEpisodeScript: repo.episodes.getEpisodeScript,
    getEpisodeGuest: repo.episodes.getEpisodeGuest,
    getGuestVoiceSample: (guestId, language) => repo.guests.voiceSampleByLanguage(guestId, language),
    getGuestVoiceSampleAny: (guestId) => repo.guests.voiceSampleAny(guestId),
    getVoiceSample: repo.episodes.getVoiceSample,
    // 按语种取采样（生成管线用：同语种优先，缺失 → getVoiceSample 兜底）
    getVoiceSampleByLanguage: repo.episodes.getVoiceSampleByLanguage,
    // 嘉宾固定音色 id（逐段降级路径用；2D 主路径用 guest-voice.mp3 资产）
    getGuestModelId: async () => env.FISH_GUEST_REFERENCE_ID ?? null,
    markJobProgress: repo.jobs.markJobProgress,
    markJobDone: repo.jobs.markJobDone,
    insertTrack: repo.episodes.insertTrack,
  },
  tts: tts ?? createTtsClient({ apiKey: "", fetchImpl: createProxyFetch(env.FISH_PROXY_URL) }),
  storage,
  // merge 阶段：intro/outro 资产（缺失 → 降级）+ 真实 ffmpeg 二进制
  // 资产统一存 storage（R2：assets/ 前缀；换音色/加语言热更新，无需重新部署）。
  // createLocalAssetStore 已弃用——资产不再随服务端文件系统分发
  assets: { get: (key) => storage.get(key).catch(() => null) },
  ffmpegPath: ffmpegInstaller.path,
}), { concurrency: 1, maxAttempts: 2, backoffMs: 1000 });

// 启动恢复：把上次未完成（queued/tts/merge/upload）的 job 重新入队（不阻塞 serve）
void recoverQueuedJobs(repo.jobs, (job) => queue.enqueue(job, () => {}).then(() => {})).then((n) => {
  console.log(`[queue] boot recovery: re-enqueued ${n} uncompleted job(s)`);
});

const importDeps: ImportDeps = {
  getSnapshotByUrl: (url) => repo.snapshots.getByUrl(url),
  createSnapshot: (row: any) => (repo.snapshots.create as any)(row) as Promise<{ id: string }>,
  updateSnapshotContent: (id: string, row: any) => (repo.snapshots.updateContent as any)(id, row),
  markSnapshotUnreachable: (id, error) => repo.snapshots.markUnreachable(id, error),
  markSnapshotParseFailed: (id, error) => repo.snapshots.markParseFailed(id, error),
  findPolishByUserSnapshot: (userId, snapshotId) => repo.polishes.findByUserSnapshot(userId, snapshotId),
};

const polishesDeps: PolishesDeps = {
  getChannelActivatedAt: (userId) => repo.episodes.getChannelActivatedAt(userId),
  findPolishByUserSnapshot: (userId, snapshotId) => repo.polishes.findByUserSnapshot(userId, snapshotId),
  createPolish: (row) => repo.polishes.create(row),
  getPolishDetail: (id, userId) => repo.polishes.getPolishDetail(id, userId),
  listByUser: (userId) => repo.polishes.listByUser(userId),
};

const transcriptsDeps: TranscriptsDeps = {
  // polish → snapshot.parsedDialogue（对话内容在 DB，快照 JSONB）
  getDialogueForPolish: async (polishId, userId) => {
    const polish = await repo.polishes.getOwned(polishId, userId);
    if (!polish) return null;
    const snapshot = await repo.snapshots.getById(polish.snapshotId);
    if (!snapshot?.parsedDialogue) return null;
    return {
      messages: (snapshot.parsedDialogue as { role: string; content: string }[]).map((m) => ({ role: m.role, content: m.content })),
      platform: snapshot.platform,
    };
  },
  getTranscriptCount: async (polishId) => (await repo.transcripts.listByPolish(polishId)).length,
  getPolishLimit: async (userId) => {
    const quota = await repo.jobs.getQuotaInfo(userId);
    return quota.plan === "pro" ? null : env.POLISH_MAX_VERSIONS;
  },
  createTranscript: (polishId, segments, language, opts) => repo.transcripts.create(polishId, segments, language, opts),
  guestsByPlatform: Object.fromEntries((await repo.guests.list()).map((g) => [g.platform, { id: g.id, name: g.name }])),
  getOwnedTranscript: (id, userId) => repo.transcripts.getOwned(id, userId),
  updateTranscriptSegments: (id, segments) => repo.transcripts.updateSegments(id, segments),
  llm,
};

const job: JobDeps = {
  getOwnedEpisode: (episodeId, userId) => repo.jobs.getOwnedEpisode(episodeId, userId),
  getLatestJob: (episodeId) => repo.jobs.getLatestJob(episodeId),
};

const voice: VoiceDeps = {
  saveVoiceSample: (row) => repo.episodes.saveVoiceSample(row),
  getVoiceSample: (userId) => repo.episodes.getVoiceSample(userId),
  storage,
};

const episodesDeps: EpisodesDeps = {
  listByUser: (userId) => repo.episodes.listByUser(userId),
  getOwned: (id, userId) => repo.episodes.getOwned(id, userId),
  getEpisodeAudio: (id, userId) => repo.episodes.getEpisodeAudio(id, userId),
  getOwnedTranscript: (id, userId) => repo.transcripts.getOwned(id, userId),
  getEpisodeByTranscript: (transcriptId) => repo.episodes.getByTranscript(transcriptId),
  createEpisode: (row) => repo.episodes.create(row),
  markUsed: (transcriptId) => repo.transcripts.markUsed(transcriptId),
  safetyCheck: async (segments) => parseJsonLoose(await llm.complete(safetyMetaPrompt(segments))) as { pass: boolean; reason?: string; title?: string; description?: string; tags?: string[]; topic?: string },
  getChannelActive: async (userId) => (await repo.episodes.getChannelActivatedAt(userId)) !== null,
  getQuota: (userId) => repo.jobs.getQuotaInfo(userId),
  consumeQuota: (userId, credit) => repo.jobs.consumeQuota(userId, credit),
  createJob: (episodeId) => repo.jobs.createJob(episodeId),
  getLatestJob: (episodeId) => repo.jobs.getLatestJob(episodeId),
  enqueueJob: async (job) => {
    void queue.enqueue({ id: job.id, episodeId: job.episodeId }, (p) => {
      console.log(`[queue] job ${job.id} progress ${p}%`);
    }).then((result) => {
      if (result.status === "failed") {
        void repo.jobs.markJobFailed(job.id, result.error ?? "unknown").catch((e) =>
          console.error(`[queue] markJobFailed ${job.id} failed`, e));
      }
    }).catch((e) => console.error(`[queue] job ${job.id} failed`, e));
  },
  setPublished: (id) => repo.episodes.setPublished(id),
  getChannelActivatedAt: (userId) => repo.episodes.getChannelActivatedAt(userId),
  getHostModelId: (userId) => repo.episodes.getHostModelId(userId),
  getVoiceSampleKey: (userId) => repo.episodes.getVoiceSampleKey(userId),
  getVoiceSample: (userId) => repo.episodes.getVoiceSample(userId),
  getVoiceSampleByLanguage: (userId, language) => repo.episodes.getVoiceSampleByLanguage(userId, language),
  saveVoiceSample: (row) => repo.episodes.saveVoiceSample(row),
};

const auth = createAuth({
    db,
    env,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: env.APP_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    cookieDomain: env.BETTER_AUTH_COOKIE_DOMAIN,
  });
const app = createApp({
  env,
  auth,
  authExt: { env, db, auth },
  repo,
  importDeps,
  polishesDeps,
  transcriptsDeps,
  episodesDeps,
  job,
  voice,
  channel: { activateChannel: createActivateChannel(db) },
  favorites: createFavoritesRepo(db),
  admin: {
    ...createAdminDeps(db, env.ADMIN_EMAILS),
    storage,
    upsertGuestVoiceSample: (row) => repo.guests.upsertVoiceSample(row),
    listGuestVoiceSamples: () => repo.guests.listVoiceSamples(),
    listGuests: () => repo.guests.list(),
  },
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api listening on :${info.port}`);
});
