import { betterAuth, APIError } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import { randomBytes } from "node:crypto";

export interface CreateAuthOptions {
  db: PostgresJsDatabase<typeof schema>;
  secret: string;
}

/**
 * better-auth 实例（M5：替代 Supabase Auth）。
 * - emailAndPassword：邮箱+密码注册/登录（内置能力，无需插件导入）
 * - bearer：Bearer token 会话（SPA/扩展用 Authorization 头；扩展注入协议不变）
 * - 邀请码门禁：注册携带 inviteCode（additionalFields），databaseHooks.user.create.before
 *   校验 invite_codes 表（未用未过期）并标记 usedBy；after 创建 profiles 行
 */
export function createAuth(opts: CreateAuthOptions) {
  return betterAuth({
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
    user: {
      additionalFields: {
        inviteCode: { type: "string" },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const code = (user as { inviteCode?: string }).inviteCode?.trim();
            if (!code) throw new APIError("BAD_REQUEST", { message: "invalid_invite_code" });
            // 校验：存在、未使用、未过期（标记占用放 after hook——before 阶段 user.id 尚未生成）
            const rows = await opts.db
              .select({ id: schema.inviteCodes.id })
              .from(schema.inviteCodes)
              .where(
                and(
                  eq(schema.inviteCodes.code, code),
                  isNull(schema.inviteCodes.usedBy),
                  or(isNull(schema.inviteCodes.expiresAt), gt(schema.inviteCodes.expiresAt, new Date())),
                ),
              )
              .limit(1);
            if (rows.length === 0) {
              throw new APIError("BAD_REQUEST", { message: "invalid_invite_code" });
            }
          },
          after: async (user) => {
            // 标记邀请码已使用（user.id 已生成；失败仅影响码状态，不阻断注册）
            const code = (user as { inviteCode?: string }).inviteCode?.trim();
            if (code) {
              await opts.db
                .update(schema.inviteCodes)
                .set({ usedBy: user.id, usedAt: new Date() })
                .where(eq(schema.inviteCodes.code, code))
                .catch((e) => console.error("[auth] mark invite used failed", e));
            }
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
