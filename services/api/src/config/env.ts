import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  /** better-auth 会话签名密钥（M5；本地 dev 任意 32+ 字符，生产 Railway 各环境独立设置） */
  BETTER_AUTH_SECRET: z.string().default("dev-secret-change-me-0123456789abcdef"),
  /** better-auth 公开基址（回调/重定向用；本地 dev 默认，生产按环境设置 https://api.*） */
  BETTER_AUTH_URL: z.string().default("http://localhost:8787"),
  /** 消费站基址（通知邮件链接指向 /episode/{id} 等页面；本地 sslip 裸域，生产 https://dailog.fm） */
  SITE_BASE_URL: z.string().url().default("https://dailog.fm"),
  /** SSO 跨子域 cookie 域（生产 .dailog.fm；本地留空 = host-only cookie，localhost 跨端口天然共享） */
  BETTER_AUTH_COOKIE_DOMAIN: z.string().optional(),
  PORT: z.coerce.number().default(8787),
  /** Fish Audio TTS（统一 TTS 端点；未配置 → /v1/editor/tts 503） */
  FISH_API_KEY: z.string().default(""),
  /** 本地 socks5 代理（容器出网访问 Fish 用；生产直连不配） */
  FISH_PROXY_URL: z.string().optional(),
  STORAGE_DRIVER: z.enum(["fs", "r2"]).default("fs"),
  STORAGE_DIR: z.string().default("./data"),
  // 工作台 SPA 跨域白名单（逗号分隔的完整 Origin）；空 = 不放开任何浏览器 Origin
  APP_ORIGINS: z.string().default(""),
  /** Resend 事务邮件（投稿状态通知）：免费 3000 封/月，超出按量计费 */
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default("dailog <no-reply@dailog.fm>"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY: z.string().optional(),
  R2_SECRET_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  // 部署自动预留管理员（逗号分隔邮箱）：启动时提升为 admin
  ADMIN_EMAILS: z.string().default(""),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return schema.parse(source);
}
