import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { createTokenVerifier } from "./auth/verify";
import { createDb } from "./db/client";
import { createRepo } from "./repo";

const env = loadEnv();

// DB 接入：drizzle repo（imports + episodes）
const { db } = createDb(env);
const repo = createRepo(db);

const app = createApp({
  env,
  verifyToken: createTokenVerifier(env.SUPABASE_JWKS_URL, `${env.SUPABASE_URL}/auth/v1`),
  repo,
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api listening on :${info.port}`);
});
