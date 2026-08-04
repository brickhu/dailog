import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  /** better-auth 会话签名密钥（M5；本地 dev 任意 32+ 字符，生产 Railway 各环境独立设置） */
  BETTER_AUTH_SECRET: z.string().default("dev-secret-change-me-0123456789abcdef"),
  /** better-auth 公开基址（回调/重定向用；本地 dev 默认，生产按环境设置 https://api.*） */
  BETTER_AUTH_URL: z.string().default("http://localhost:8787"),
  /** SSO 跨子域 cookie 域（生产 .dailogues.com；本地留空 = host-only cookie，localhost 跨端口天然共享） */
  BETTER_AUTH_COOKIE_DOMAIN: z.string().optional(),
  PORT: z.coerce.number().default(8787),
  // 注意：default("") 会被 zod 内层校验再次校验，故不能用 .min(1)（空串会抛错），
  // 与计划「默认空串使无 key 本地环境可启动、key 为空在调用时再报错」的意图一致
  DEEPSEEK_API_KEY: z.string().default(""),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com/v1"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  FISH_API_KEY: z.string().default(""),
  FISH_PROXY_URL: z.string().optional(),
  FISH_GUEST_REFERENCE_ID: z.string().optional(),
  STORAGE_DRIVER: z.enum(["fs", "r2"]).default("fs"),
  STORAGE_DIR: z.string().default("./data"),
  // 工作台 SPA 跨域白名单（逗号分隔的完整 Origin）；空 = 不放开任何浏览器 Origin
  APP_ORIGINS: z.string().default(""),
  // 对话级润色上限（PRD §4.7）：每个对话最多 N 个脚本版本（=N 次润色调用）；pro 用户不限
  POLISH_MAX_VERSIONS: z.coerce.number().default(5),
  // 片头/片尾音频资产目录（Task 11 生成；缺失时 merge 降级为只拼主对话）
  ASSETS_DIR: z.string().default("assets/audio"),
  /** Resend 事务邮件（注册邮箱验证/密码重置）：免费 3000 封/月，超出按量计费 */
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default("dailogues <no-reply@dailogues.com>"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY: z.string().optional(),
  R2_SECRET_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return schema.parse(source);
}
