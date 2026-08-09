// 管理员 CLI：生成邀请码（最小版；完整发放/奖励逻辑属计划 7）
// 用法：pnpm --filter @dailogues/api invites:create <code> [--expires <days>]
// 示例：pnpm --filter @dailogues/api invites:create test-code-1 --expires 30
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const args = process.argv.slice(2);
const expiresIdx = args.indexOf("--expires");
const expiresDays = expiresIdx !== -1 ? Number(args[expiresIdx + 1]) : undefined;
// code = 第一个非 -- 开头的参数，且不能是 --expires 的值（防 `--expires 30` 把 30 当 code）
const code = args.find((a, i) => !a.startsWith("--") && !(expiresIdx !== -1 && i === expiresIdx + 1));
if (!code) {
  console.error("用法: pnpm --filter @dailogues/api invites:create <code> [--expires <天数>]");
  console.error("示例: pnpm --filter @dailogues/api invites:create my-code-1 --expires 30（缺省永不过期）");
  process.exit(1);
}
if (expiresDays !== undefined && Number.isNaN(expiresDays)) {
  console.error("--expires 需要天数数字");
  process.exit(1);
}

const env = z.object({ DATABASE_URL: z.string().min(1) }).parse(process.env);
const sql = postgres(env.DATABASE_URL, { max: 1 });

// 管理员 user（invite_codes.created_by 引用 better-auth user.id；直插 user 行，不参与登录）
const admin =
  await sql`SELECT id FROM "user" WHERE email = 'admin@dailogues.local' LIMIT 1`;
const adminId =
  admin[0]?.id ??
  (
    await sql`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${randomUUID()}, 'Admin', 'admin@dailogues.local', true, now(), now())
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `
  )[0]?.id ??
  (await sql`SELECT id FROM "user" WHERE email = 'admin@dailogues.local' LIMIT 1`)[0].id;

await sql`
  INSERT INTO invite_codes (code, created_by, source, expires_at)
  VALUES (${code}, ${adminId}, 'admin', ${expiresDays !== undefined ? new Date(Date.now() + expiresDays * 86400_000) : null})
  ON CONFLICT (code) DO NOTHING
`;
await sql.end();
console.log(`✓ 邀请码 ${code} 已生成${expiresDays !== undefined ? `（${expiresDays} 天有效）` : "（永不过期）"}`);
