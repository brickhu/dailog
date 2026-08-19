-- 0036：恢复播放/完播统计（0034 误删，回补）
-- 详情页播放次数/完播次数展示保留（用户确认）；收藏移除与默认列表保留不变（0033-0035）。
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episode_stats" (
  "episode_id" uuid PRIMARY KEY NOT NULL REFERENCES "episodes"("id") ON DELETE cascade,
  "plays" integer NOT NULL DEFAULT 0,
  "completions" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
