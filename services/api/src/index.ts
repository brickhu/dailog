import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { createAuth } from "./auth/better-auth";
import { createDb } from "./db/client";
import { createRepo } from "./repo";
import { createStorage } from "./storage";
import type { VoiceDeps } from "./routes/voice";
import type { EditorDeps } from "./routes/editor";
import { createFavoritesRepo } from "./routes/favorites";
import { createTtsClient } from "./tts/client";
import { createProxyFetch } from "./net/proxy";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import type { TtsDeps } from "./routes/tts";

const env = loadEnv();

// DB 接入：drizzle repo（submissions/episodes/guests/notifications）
const { db } = createDb(env);
const repo = createRepo(db);

// 存储（R2/fs）：声音采样、成品音频、封面统一走 storage
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

// 部署自动预留管理员：ADMIN_EMAILS（逗号分隔邮箱）列出的账号启动时提升为 admin（幂等，静默）
void repo.episodes.syncAdminRoles?.(
  env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
)
  .then((n) => { if (n > 0) console.log(`[admin] 已同步 ${n} 个管理员角色（ADMIN_EMAILS）`); })
  .catch((e) => console.error("[admin] 管理员同步失败", e));

const voice: VoiceDeps = {
  saveVoiceSample: (row) => repo.episodes.saveVoiceSample(row),
  getVoiceSample: (userId) => repo.episodes.getVoiceSample(userId),
  storage,
};

const editor: EditorDeps = {
  repo,
  env,
  storage,
  siteBaseUrl: env.SITE_BASE_URL || null,
};

// 统一 TTS：Fish 客户端只在服务端（编辑本地不持 key；本地容器经 socks 代理出网）
if (!env.FISH_API_KEY) console.warn("[tts] FISH_API_KEY 未配置：/v1/editor/tts 将返回 503");
const fish = env.FISH_API_KEY
  ? createTtsClient({ apiKey: env.FISH_API_KEY, fetchImpl: createProxyFetch(env.FISH_PROXY_URL) })
  : null;
const tts: TtsDeps = {
  repo,
  storage,
  ffmpegPath: ffmpegInstaller.path,
  fish,
};

const auth = createAuth({
    db,
    env,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [
      ...env.APP_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
      // api 自身域名自动可信（授权页在 API 域内同源登录——CSRF 白名单必须包含）
      new URL(env.BETTER_AUTH_URL).origin,
    ],
    cookieDomain: env.BETTER_AUTH_COOKIE_DOMAIN,
  });
const app = createApp({
  env,
  auth,
  authExt: { env, db, auth },
  repo,
  voice,
  favorites: createFavoritesRepo(db),
  editor,
  tts,
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api listening on :${info.port}`);
});
