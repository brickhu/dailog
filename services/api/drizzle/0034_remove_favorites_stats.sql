-- 0034：移除收藏与播放统计（简化接口与数据库）
-- ① 收藏概念彻底退出：0033 并入的默认列表（is_default）及其条目删除、列删除
--   （收藏功能移除后个人中心入口改为播放列表，无独立收藏入口）
-- ② 播放统计移除：episode_stats 表删除（播放/完播上报与展示下线）
--> statement-breakpoint
DELETE FROM "playlist_episodes" pe
USING "playlists" pl
WHERE pe.playlist_id = pl.id AND pl.is_default = true;
--> statement-breakpoint
DELETE FROM "playlists" WHERE is_default = true;
--> statement-breakpoint
ALTER TABLE "playlists" DROP COLUMN IF EXISTS "is_default";
--> statement-breakpoint
DROP TABLE IF EXISTS "episode_stats";
