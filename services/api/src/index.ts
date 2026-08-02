import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { createTokenVerifier } from "./auth/verify";
import { createDb } from "./db/client";
import { createRepo } from "./repo";
import { createLlmClient } from "./llm/client";
import { qualityCheckPrompt, parseJsonLoose, type QualityResult } from "./llm/prompts";
import type { PolishDeps } from "./routes/polish";

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

const app = createApp({
  env,
  verifyToken: createTokenVerifier(env.SUPABASE_JWKS_URL, `${env.SUPABASE_URL}/auth/v1`),
  repo,
  polish,
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api listening on :${info.port}`);
});
