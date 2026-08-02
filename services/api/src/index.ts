import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { createTokenVerifier } from "./auth/verify";
import { createDb } from "./db/client";
import { createRepo } from "./repo";
import { createLlmClient } from "./llm/client";
import { qualityCheckPrompt, safetyCheckPrompt, parseJsonLoose, type QualityResult } from "./llm/prompts";
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
  getLatestScript: (episodeId) => repo.episodes.getLatestScript(episodeId),
  // 安全门（PRD §4.4）：编辑后脚本一次非流式补全，输出 JSON { pass, reason? }
  safetyCheck: async (segments) => parseJsonLoose(await llm.complete(safetyCheckPrompt(segments))) as { pass: boolean; reason?: string },
  getQuota: (userId) => repo.jobs.getQuotaInfo(userId),
  consumeQuota: (userId, credit) => repo.jobs.consumeQuota(userId, credit),
  createJob: (episodeId) => repo.jobs.createJob(episodeId),
  // Task 6 接入进程内队列：目前仅记录，不消费 job
  enqueueJob: async (jobId) => {
    console.log(`[queue] job ${jobId} enqueued (Task 6 接入进程内队列)`);
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
