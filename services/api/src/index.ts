import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { createTokenVerifier } from "./auth/verify";

const env = loadEnv();
const app = createApp({
  env,
  verifyToken: createTokenVerifier(env.SUPABASE_JWKS_URL, `${env.SUPABASE_URL}/auth/v1`),
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api listening on :${info.port}`);
});
