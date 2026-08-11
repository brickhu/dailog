// 统一登录/注册端点（邮箱 + 密码 + 新用户验证码）：
//  POST /api/auth/login-or-otp { email, password, name? }
//    老用户 → 密码登录（直接返回会话）
//    新用户 → 生成 6 位验证码 → 存 verification 表 → 发邮件 → { needOtp: true }
//  POST /api/auth/otp-complete { email, otp, password, name? }
//    校验验证码（10 分钟有效，一次性）→ 创建用户（带密码）→ 自动登录
// OTP 完全自定义（不依赖 better-auth emailOTP 插件的存储行为）——
// 验证码存数据库 verification 表，重启/多实例不丢失。

import { Hono } from "hono";
import { eq, and, gt } from "drizzle-orm";
import { randomInt } from "node:crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import { sendEmail } from "../email/resend";
import type { Env } from "../config/env";

export interface AuthExtDeps {
  env: Env;
  db: PostgresJsDatabase<typeof schema>;
  auth: {
    api: {
      signInEmail(args: { body: { email: string; password: string }; asResponse?: true }): Promise<Response>;
      signUpEmail(args: { body: { email: string; password: string; name: string }; asResponse?: true }): Promise<Response>;
    };
  };
}

const OTP_TTL_MS = 10 * 60 * 1000; // 10 分钟

// 认证接口 IP 限流（内存，单实例够用——防注册接口刷邮件通道）。
// better-auth 的 rateLimit 只作用于其自身端点，auth-ext 是自定义路由需自己限。
// 参数可配置：AUTH_RATE_MAX / AUTH_RATE_WINDOW_MS（本地开发放宽——容器内所有请求共享
// "local" 桶（无 x-forwarded-for），默认 5 次/分钟会被浏览器重试+探测误伤）
const rateMap = new Map<string, number[]>(); // ip → 最近请求时间戳
const RATE_WINDOW_MS = Number(process.env.AUTH_RATE_WINDOW_MS ?? 60_000);
const RATE_MAX = Number(process.env.AUTH_RATE_MAX ?? 5);

function checkRate(ip: string): boolean {
  const now = Date.now();
  const list = (rateMap.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) return false;
  list.push(now);
  rateMap.set(ip, list);
  return true;
}

/** 生成 6 位数字验证码 */
function generateOtp(): string {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

export function authExtRoutes(deps: AuthExtDeps) {
  const app = new Hono();

  /** 统一提交：老用户密码登录 / 新用户发验证码 */
  app.post("/v1/auth/login-or-otp", async (c) => {
    const ip = (c.req.header("x-forwarded-for") ?? "local").split(",")[0].trim();
    if (!checkRate(ip)) return c.json({ error: "rate_limited" }, 429);
    const body = (await c.req.json().catch(() => null)) as
      | { email?: unknown; password?: unknown }
      | null;
    if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
      return c.json({ error: "invalid_input" }, 400);
    }
    const email = body.email.trim().toLowerCase();
    if (!email || body.password.length < 8) return c.json({ error: "invalid_input" }, 400);

    // 老用户：密码登录
    const existing = await deps.db
      .select({ id: schema.authUsers.id })
      .from(schema.authUsers)
      .where(eq(schema.authUsers.email, email))
      .limit(1);
    if (existing.length > 0) {
      try {
        // asResponse: true——响应带 set-cookie（cookie 会话 → site/studio 跨子域 SSO）
        const result = await deps.auth.api.signInEmail({ body: { email, password: body.password }, asResponse: true });
        return new Response(result.body, { status: result.status, headers: result.headers });
      } catch {
        return c.json({ error: "invalid_credentials" }, 401);
      }
    }

    // 新用户：发验证码（防邮件通道被刷——见下）
    // ① 复用未过期码：60 秒内同一邮箱已有有效码 → 直接返回不发信（防刷邮件 + 防重复收信）
    const existingOtp = await deps.db
      .select({ id: schema.verifications.id, expiresAt: schema.verifications.expiresAt })
      .from(schema.verifications)
      .where(and(eq(schema.verifications.identifier, `otp:${email}`), gt(schema.verifications.expiresAt, new Date())))
      .limit(1);
    if (existingOtp.length > 0 && existingOtp[0].expiresAt.getTime() - Date.now() > 60_000) {
      return c.json({ needOtp: true }); // 60 秒内已发过：复用，不重发
    }
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    try {
      await deps.db.transaction(async (tx) => {
        // 同邮箱旧码（含过期的）先清——表不累积，且保证只有最新码有效
        await tx.delete(schema.verifications).where(eq(schema.verifications.identifier, `otp:${email}`));
        await tx.insert(schema.verifications)
          .values({ id: `otp-${email}-${Date.now()}`, identifier: `otp:${email}`, value: otp, expiresAt });
      });
    } catch {
      return c.json({ error: "otp_send_failed" }, 502);
    }
    // 发送邮件（RESEND_API_KEY 未配置时静默跳过——本地 dev 直接查库拿码）
    await sendEmail(deps.env, {
      to: email,
      subject: "验证你的 dailog 邮箱（注册）",
      html: `<p>你的 dailog 注册验证码是：</p>
             <p style="font-size:24px;font-weight:bold;letter-spacing:4px">${otp}</p>
             <p style="color:#8b95a7;font-size:12px">验证码 10 分钟内有效。如果不是你本人操作，请忽略此邮件。</p>`,
    }).catch(() => null);
    return c.json({ needOtp: true });
  });

  /** OTP 完成注册：校验验证码 → 创建用户（带密码）→ 自动登录 */
  app.post("/v1/auth/otp-complete", async (c) => {
    const ip = (c.req.header("x-forwarded-for") ?? "local").split(",")[0].trim();
    if (!checkRate(ip)) return c.json({ error: "rate_limited" }, 429);
    const body = (await c.req.json().catch(() => null)) as
      | { email?: unknown; otp?: unknown; password?: unknown; name?: unknown }
      | null;
    if (!body || typeof body.email !== "string" || typeof body.otp !== "string" || typeof body.password !== "string") {
      return c.json({ error: "invalid_input" }, 400);
    }
    const email = body.email.trim().toLowerCase();
    if (body.password.length < 8) return c.json({ error: "invalid_input" }, 400);

    // 校验验证码（未过期）
    const rows = await deps.db
      .select({ id: schema.verifications.id, value: schema.verifications.value })
      .from(schema.verifications)
      .where(and(eq(schema.verifications.identifier, `otp:${email}`), gt(schema.verifications.expiresAt, new Date())))
      .orderBy(schema.verifications.createdAt)
      .limit(1);
    const row = rows[0];
    if (!row || row.value !== body.otp.trim()) {
      return c.json({ error: "invalid_otp" }, 401);
    }
    // 一次性：无论后续成败删除验证码
    await deps.db.delete(schema.verifications).where(eq(schema.verifications.id, row.id)).catch(() => null);

    // 创建用户（带密码）+ 自动登录（透传 set-cookie——cookie 会话 SSO）
    try {
      await deps.auth.api.signUpEmail({
        body: {
          email,
          password: body.password,
          name: typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 50) : email.split("@")[0],
        },
        asResponse: true,
      }).catch(() => null); // 竞态：可能已存在（不阻塞登录）
      // 验证码通过 = 邮箱已验证：标记 email_verified（否则 AppLayout 一直显示
      // "邮箱尚未验证"横幅——signUpEmail 默认 emailVerified=false）
      await deps.db.update(schema.authUsers).set({ emailVerified: true }).where(eq(schema.authUsers.email, email)).catch(() => null);
      // ADMIN_EMAILS 中的邮箱注册后即时提升为 admin（部署自动预留，无需手动 role:set）
      if (deps.env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase()).includes(email)) {
        const adminUser = await deps.db
          .select({ id: schema.authUsers.id })
          .from(schema.authUsers)
          .where(eq(schema.authUsers.email, email))
          .limit(1);
        if (adminUser[0]) {
          await deps.db
            .update(schema.profiles)
            .set({ role: "admin" })
            .where(eq(schema.profiles.id, adminUser[0].id))
            .catch(() => null);
        }
      }
      const result = await deps.auth.api.signInEmail({ body: { email, password: body.password }, asResponse: true });
      return new Response(result.body, { status: result.status, headers: result.headers });
    } catch {
      return c.json({ error: "signup_failed" }, 502);
    }
  });

  return app;
}
