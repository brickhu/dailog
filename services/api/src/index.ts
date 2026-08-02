import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { createTokenVerifier } from "./auth/verify";
import type { ImportsRepo } from "./routes/imports";

const env = loadEnv();

// 占位 repo：DB 接入为后续任务
const importsRepo: ImportsRepo = {
  findImportBySource: async () => null,
  insertImport: async () => { throw new Error("imports repo not implemented"); },
  insertEpisode: async () => { throw new Error("imports repo not implemented"); },
};

const app = createApp({
  env,
  verifyToken: createTokenVerifier(env.SUPABASE_JWKS_URL, `${env.SUPABASE_URL}/auth/v1`),
  importsRepo,
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api listening on :${info.port}`);
});
