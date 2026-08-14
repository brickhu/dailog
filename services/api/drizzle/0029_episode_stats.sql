-- 0029：播放/完播统计（episode_stats）
-- 每期一行计数（plays 播放次数 / completions 完播次数）；公开播放器上报（免鉴权）
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episode_stats" (
  "episode_id" uuid PRIMARY KEY NOT NULL REFERENCES "episodes"("id") ON DELETE cascade,
  "plays" integer NOT NULL DEFAULT 0,
  "completions" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
