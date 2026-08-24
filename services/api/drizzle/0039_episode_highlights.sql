-- 0039：节目金句（Step B 配套产物 highlights；详情页「本期金句」——纯文本展示，不依赖时间戳）
--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "highlights" jsonb DEFAULT '[]' NOT NULL;
