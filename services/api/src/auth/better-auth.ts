import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, emailOTP } from "better-auth/plugins";
import { github } from "better-auth/social-providers";
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
  // GitHub OAuth：注册在 socialProviders 配置项（非 plugins 数组）——better-auth 按 key
  // 用内置工厂实例化，value 为配置对象；enabled=false 时端点不生效（登录页按钮同步隐藏）
  const socialProviders = {
    github: {
      clientId: opts.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: opts.env.GITHUB_CLIENT_SECRET ?? "",
      enabled: Boolean(opts.env.GITHUB_CLIENT_ID),
    },
  };

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
        verification: schema.verifications,
      },
    }),
    secret: opts.secret,
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    // 全局限流（IP 维度）：防注册接口刷邮件通道（60 秒窗口最多 5 次认证请求）
    rateLimit: { enabled: true, window: 60, max: 5 },
    // 注册邮箱验证：OTP 验证码（6 位，10 分钟有效）——注册必须输码才能完成；
    // 登录保持邮箱+密码。OTP 由 auth-ext 自定义流程实现（生成/存储 verification 表/校验），
    // 不依赖 emailOTP 插件的存储行为（默认内存存储——重启丢失、多实例失效）。
    // 发送走 Resend；RESEND_API_KEY 未配置时静默跳过（本地 dev）
    plugins: [
      bearer(),
      // 找回密码（1.6.25 官方密码重置端点挂在 emailOTP 插件下，码式而非链接式）：
      //   POST /api/auth/forget-password/email-otp {email} → 发 6 位重置码
      //   POST /api/auth/email-otp/reset-password {email, otp, password} → 码校验后改密
      // 与注册体验一致（6 位码）；OTP 存 verification 表（storeOTP 默认 plain 可查）
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (!opts.env.RESEND_API_KEY) {
            console.log(`[email-otp] ${type} → ${email}：验证码 ${otp}`);
            return;
          }
          const subject = type === "forget-password" ? "重置你的 dailog 密码" : "你的 dailog 验证码";
          await sendEmail(opts.env, {
            to: email,
            subject,
            html: `<p>你的验证码是：</p>
                   <p style="font-size:24px;font-weight:bold;letter-spacing:4px">${otp}</p>
                   <p>10 分钟内有效。</p>`,
          });
        },
      }),
    ],
    socialProviders,
    advanced: opts.cookieDomain
      ? { crossSubDomainCookies: { enabled: true, domain: opts.cookieDomain } }
      : {},
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // GitHub 邮箱未公开时 email 为 null（user.email notNull 约束）——补占位邮箱
            // （仅唯一标识，该账号只能 GitHub 登录，不能邮箱登录/找回密码）
            if (!user.email) {
              user.email = `gh-${randomBytes(6).toString("hex")}@local.invalid`;
            }
            return { data: user };
          },
          after: async (user) => {
            // 创建业务档案（quota/voice 等业务数据挂 profiles）
            const email = user.email ?? "";
            await opts.db.insert(schema.profiles).values({
              id: user.id,
              // 默认频道 slug：纯随机 hex（8 位；用户可在设置页改成自己的频道地址）
              username: randomBytes(4).toString("hex"),
              // GitHub 用户优先用 GitHub 昵称；邮箱用户取邮箱前缀
              displayName: user.name || email.split("@")[0] || "用户",
            });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
