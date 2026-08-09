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

/** 生成 6 位数字验证码 */
function generateOtp(): string {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

export function authExtRoutes(deps: AuthExtDeps) {
  const app = new Hono();

  /** 统一提交：老用户密码登录 / 新用户发验证码 */
  app.post("/api/auth/login-or-otp", async (c) => {
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

    // 新用户：生成验证码 → 清旧码（防累积）→ 存库 → 发邮件。
    // 用户不输入验证码 = 安全无事发生（不建用户不登录；码 10 分钟过期失效）
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
  app.post("/api/auth/otp-complete", async (c) => {
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
      const result = await deps.auth.api.signInEmail({ body: { email, password: body.password }, asResponse: true });
      return new Response(result.body, { status: result.status, headers: result.headers });
    } catch {
      return c.json({ error: "signup_failed" }, 502);
    }
  });

  return app;
}
