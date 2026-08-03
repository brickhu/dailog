import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import { randomBytes } from "node:crypto";

export interface CreateAuthOptions {
  db: PostgresJsDatabase<typeof schema>;
  secret: string;
  /** 公开基址（回调/重定向用）；本地 dev http://localhost:8787，生产 https://api.* */
  baseURL?: string;
  /** 跨域白名单（CSRF/URL 校验用，与 CORS APP_ORIGINS 同源）：SPA 经 vite 代理/跨域访问时 Origin 需在此 */
  trustedOrigins?: string[];
  /** SSO 跨子域 cookie 域（生产 .dailogues.com；未配置 = host-only cookie） */
  cookieDomain?: string;
}

/**
 * better-auth 实例（M5：替代 Supabase Auth）。
 * - emailAndPassword：邮箱+密码注册/登录（内置能力，无需插件导入）——注册完全开放，
 *   频道开通（授权码）在 /api/me/channel/activate 校验（见 routes/channel.ts）
 * - bearer：Bearer token 会话（SPA/扩展用 Authorization 头；扩展注入协议不变）
 */
export function createAuth(opts: CreateAuthOptions) {
  return betterAuth({
    baseURL: opts.baseURL,
    trustedOrigins: opts.trustedOrigins,
    database: drizzleAdapter(opts.db, {
      provider: "pg",
      // 表导出名（authUsers/authSessions/authAccounts）→ better-auth model 名映射
      schema: {
        user: schema.authUsers,
        session: schema.authSessions,
        account: schema.authAccounts,
      },
    }),
    secret: opts.secret,
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    plugins: [bearer()],
    advanced: opts.cookieDomain
      ? { crossSubDomainCookies: { enabled: true, domain: opts.cookieDomain } }
      : {},
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // 创建业务档案（quota/voice 等业务数据挂 profiles）
            const email = user.email ?? "";
            await opts.db.insert(schema.profiles).values({
              id: user.id,
              username: `u_${randomBytes(4).toString("hex")}`,
              displayName: email.split("@")[0] || "用户",
            });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
