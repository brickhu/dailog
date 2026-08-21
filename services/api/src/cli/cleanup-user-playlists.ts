import postgres from "postgres";

// 一次性存量清理（方案2：直接删除非默认 kind=user 播放列表，playlist_episodes 级联清理）
// 用法：node --env-file-if-exists=.env.local node_modules/tsx/dist/cli.mjs src/cli/cleanup-user-playlists.ts
// 安全：--dry 只统计不删除
const dry = process.argv.includes("--dry");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");
const client = postgres(url, { max: 1 });
try {
  const [count] = await client`
    SELECT count(*)::int AS n FROM playlists WHERE kind = 'user' AND is_default = false
  `;
  console.log(`非默认 kind=user 播放列表: ${count?.n ?? 0}`);
  const [epRows] = await client`
    SELECT count(*)::int AS n FROM playlist_episodes pe
    JOIN playlists pl ON pl.id = pe.playlist_id
    WHERE pl.kind = 'user' AND pl.is_default = false
  `;
  console.log(`其中条目数（将级联删除）: ${epRows?.n ?? 0}`);
  const [defs] = await client`
    SELECT count(*)::int AS n FROM playlists WHERE kind = 'user' AND is_default = true
  `;
  console.log(`默认收藏列表（不受影响）: ${defs?.n ?? 0}`);
  if (!dry && (count?.n ?? 0) > 0) {
    const del = await client`
      DELETE FROM playlists WHERE kind = 'user' AND is_default = false
    `;
    console.log(`已删除 ${del.count} 条播放列表（级联清理条目）`);
    const [after] = await client`
      SELECT count(*)::int AS n FROM playlists WHERE kind = 'user' AND is_default = false
    `;
    console.log(`删除后剩余非默认用户列表: ${after?.n ?? 0}`);
  }
} finally {
  await client.end();
}
