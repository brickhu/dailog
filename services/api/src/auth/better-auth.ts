import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import { randomBytes } from "node:crypto";
import type { Env } from "../config/env";
import { sendEmail } from "../email/resend";

export interface CreateAuthOptions {
  db: PostgresJsDatabase<typeof schema>;
  secret: string;
  /** 运行时环境（Resend 发信、基址等）；无 key 时验证邮件静默跳过 */
  env: Env;
  /** 公开基址（回调/重定向用）；本地 dev http://localhost:8787，生产 https://api.* */
  baseURL?: string;
  /** 跨域白名单（CSRF/URL 校验用，与 CORS APP_ORIGINS 同源）：SPA 经 vite 代理/跨域访问时 Origin 需在此 */
  trustedOrigins?: string[];
  /** SSO 跨子域 cookie 域（生产 .dailog.fm；未配置 = host-only cookie） */
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
    // 邮箱验证（注册即验证）：验证链接 → 自动登录 → callbackURL 回跳。
    // 发送走 Resend（免费 3000 封/月）；RESEND_API_KEY 未配置时静默跳过（本地 dev）
    emailVerification: {
      // 注册即发送验证邮件（1.6.x 无默认值，必须显式声明，否则注册不发信）
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(opts.env, {
          to: user.email,
          subject: "验证你的 dailog 邮箱",
          html: `<p>欢迎来到 dailog！点击下方链接验证你的邮箱：</p>
                 <p><a href="${url}">${url}</a></p>
                 <p style="color:#8b95a7;font-size:12px">如果链接无法点击，请复制到浏览器地址栏打开。链接 1 小时内有效。</p>`,
        });
      },
      autoSignInAfterVerification: true,
    },
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
