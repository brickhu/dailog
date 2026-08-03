import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_JWKS_URL: z.string().url(),
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
  // 片头/片尾音频资产目录（Task 11 生成；缺失时 merge 降级为只拼主对话）
  ASSETS_DIR: z.string().default("assets/audio"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY: z.string().optional(),
  R2_SECRET_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return schema.parse(source);
}
