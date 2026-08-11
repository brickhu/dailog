// 角色设置 CLI：pnpm role:set <email> <user|editor|admin>
// 用法：pnpm --filter @dailogues/api role:set you@example.com editor
// 说明：注册开放后默认 role=user；管理员/编辑由本 CLI 提升（或直接 UPDATE profiles）

import postgres from "postgres";
import { z } from "zod";

const args = process.argv.slice(2);
const schema = z.tuple([z.string().email("邮箱格式不正确"), z.enum(["user", "editor", "admin"])]);
const parsed = schema.safeParse(args);
if (!parsed.success) {
  console.error("用法：pnpm role:set <email> <user|editor|admin>\n", parsed.error.issues.map((i) => i.message).join("；"));
  process.exit(1);
}
const [email, role] = parsed.data;

const env = z.object({ DATABASE_URL: z.string().min(1) }).parse(process.env);
const sql = postgres(env.DATABASE_URL, { max: 1 });
try {
  const rows = await sql`
    UPDATE profiles SET role = ${role}
    WHERE id = (SELECT id FROM "user" WHERE email = ${email.toLowerCase()})
    RETURNING id, role
  `;
  if (rows.length === 0) {
    console.error(`未找到用户 ${email}（先注册再设置角色）`);
    process.exit(1);
  }
  console.log(`✅ ${email} → role=${rows[0].role}`);
} finally {
  await sql.end();
}
