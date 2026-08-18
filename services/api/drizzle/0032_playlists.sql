-- 0032：播放列表（内容类型）——playlists + playlist_episodes
-- 把不同节目打包成有序列表：kind=platform（平台策展，编辑/管理员创建，is_picked 精选）
-- / kind=user（用户自建，owner_id=用户，is_public 公开可分享）。
-- 封面 MVP 自动取首期节目封面（cover_url 预留自定义，不新增 R2 路径）。
-- 删列表/删节目均级联清理条目；唯一 (playlist_id, episode_id) 防重复收录；
-- (playlist_id, position) 索引支撑列表详情顺序读，(episode_id) 索引支撑节目页反查「收录于」。
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "playlists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "kind" text DEFAULT 'platform' NOT NULL,
  "owner_id" text REFERENCES "user"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "description" text,
  "cover_url" text,
  "language" text DEFAULT 'zh' NOT NULL,
  "is_public" boolean DEFAULT true NOT NULL,
  "is_picked" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "playlist_episodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "playlist_id" uuid NOT NULL REFERENCES "playlists"("id") ON DELETE cascade,
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id") ON DELETE cascade,
  "position" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "playlist_episodes_playlist_episode_unique" ON "playlist_episodes" ("playlist_id", "episode_id");
CREATE INDEX IF NOT EXISTS "playlist_episodes_playlist_position_idx" ON "playlist_episodes" ("playlist_id", "position");
CREATE INDEX IF NOT EXISTS "playlist_episodes_episode_idx" ON "playlist_episodes" ("episode_id");
