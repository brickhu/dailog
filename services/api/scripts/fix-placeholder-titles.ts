// 一次性数据修复：把快照里的平台占位标题（如 "Shared Conversation"）替换为
// 首条用户消息摘要（与 import 路由 effectiveTitle 同逻辑）。
// 用法：node --env-file-if-exists=.env.local node_modules/tsx/dist/cli.mjs scripts/fix-placeholder-titles.ts
import { createDb } from "../src/db/client";
import type { Env } from "../src/config/env";
import { effectiveTitle } from "../src/routes/import";

async function main() {
  const dbClient = createDb({ DATABASE_URL: process.env.DATABASE_URL! } as Env);
  const rows = await dbClient.client.unsafe<{ id: string; source_title: string | null; parsed_dialogue: unknown }[]>(
    `SELECT id, source_title, parsed_dialogue FROM snapshots WHERE source_title IS NOT NULL`,
  );
  let fixed = 0;
  for (const row of rows) {
    const msgs = (Array.isArray(row.parsed_dialogue) ? row.parsed_dialogue : []) as { role: string; content: string }[];
    const next = effectiveTitle(row.source_title, msgs);
    if (next !== row.source_title) {
      await dbClient.client.unsafe("UPDATE snapshots SET source_title = $1 WHERE id = $2", [next, row.id]);
      console.log(`[fix] snapshot ${row.source_title} → ${next}`);
      fixed++;
    }
  }
  // polish.title：占位标题的容器名一并修（用户改过的名字不是占位，天然跳过）
  const polishes = await dbClient.client.unsafe<{ id: string; title: string | null; parsed_dialogue: unknown }[]>(
    `SELECT p.id, p.title, s.parsed_dialogue
     FROM polishes p JOIN snapshots s ON s.id = p.snapshot_id
     WHERE p.title IS NOT NULL`,
  );
  let fixedPolishes = 0;
  for (const p of polishes) {
    const msgs = (Array.isArray(p.parsed_dialogue) ? p.parsed_dialogue : []) as { role: string; content: string }[];
    const next = effectiveTitle(p.title, msgs);
    if (next !== p.title) {
      await dbClient.client.unsafe("UPDATE polishes SET title = $1 WHERE id = $2", [next, p.id]);
      console.log(`[fix] polish ${p.title} → ${next}`);
      fixedPolishes++;
    }
  }
  console.log(`done: ${fixed}/${rows.length} snapshots, ${fixedPolishes}/${polishes.length} polishes updated`);
  await dbClient.client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
