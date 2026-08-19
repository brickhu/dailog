-- 0033：收藏并入默认播放列表（Spotify「Liked Songs」模式）——favorites 表退役
-- 每个用户自动拥有一个 is_default 播放列表（私有，不可编辑/删除）；收藏按钮 = 加/删该列表条目；
-- 收藏计数 = 该节目被多少默认列表收录（COUNT playlist_episodes JOIN playlists.is_default）。
--> statement-breakpoint
ALTER TABLE "playlists" ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- 为每个有收藏的用户建默认列表（slug 确定性 'favorites-' + user_id；私有；标题由前端 i18n 显示为「我的收藏」）
INSERT INTO "playlists" ("slug", "kind", "owner_id", "title", "description", "language", "is_public", "is_picked", "is_default", "created_at", "updated_at")
SELECT 'favorites-' || f.user_id, 'user', f.user_id, '我的收藏', NULL, 'zh', false, false, true, now(), now()
FROM "favorites" f
GROUP BY f.user_id
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
-- 迁移收藏条目：position = 收藏时间倒序索引（最近收藏在前，与旧列表展示一致）；created_at 保留原收藏时间
INSERT INTO "playlist_episodes" ("playlist_id", "episode_id", "position", "created_at")
SELECT pl.id, f.episode_id,
       row_number() OVER (PARTITION BY f.user_id ORDER BY f.created_at DESC) - 1,
       f.created_at
FROM "favorites" f
JOIN "playlists" pl ON pl.owner_id = f.user_id AND pl.is_default = true
ON CONFLICT ("playlist_id", "episode_id") DO NOTHING;
--> statement-breakpoint
DROP TABLE IF EXISTS "favorites";
