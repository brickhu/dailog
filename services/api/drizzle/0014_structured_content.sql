-- ① guests 新表（AI 平台嘉宾库）
CREATE TABLE IF NOT EXISTS "guests" (
  "id" text PRIMARY KEY NOT NULL,
  "platform" text NOT NULL,
  "name" text NOT NULL,
  "avatar" text,
  "intro" text,
  "url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "guests_platform_unique" UNIQUE("platform")
);
--> statement-breakpoint
-- ② voice_samples：加 language + (user_id, language) 唯一（一人多语种）
ALTER TABLE "voice_samples" ADD COLUMN "language" text DEFAULT 'zh' NOT NULL;
--> statement-breakpoint
ALTER TABLE "voice_samples" ADD CONSTRAINT "voice_samples_user_language_unique" UNIQUE("user_id","language");
--> statement-breakpoint
-- ③ polishes：删 host_name（称呼迁到 transcripts）
ALTER TABLE "polishes" DROP COLUMN IF EXISTS "host_name";
--> statement-breakpoint
-- ④ transcripts：扩展结构化字段
ALTER TABLE "transcripts" ADD COLUMN "updated_segments" jsonb;
--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "title" text;
--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "creation_note" text;
--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "host_name" text;
--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "guest_id" text REFERENCES "guests"("id");
--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "guest_name" text;
--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "status" text DEFAULT 'unused' NOT NULL;
--> statement-breakpoint
-- ⑤ episodes：audio_url → tracks（数据迁移），加内容字段
ALTER TABLE "episodes" ADD COLUMN "snapshot_id" uuid REFERENCES "snapshots"("id");
--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "subtitle" text;
--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "tags" text[];
--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "topic" text;
--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "host_id" text REFERENCES "profiles"("id");
--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "guest_id" text REFERENCES "guests"("id");
--> statement-breakpoint
-- 现有 audio_url 数据迁入 tracks（主语言 track，语言从 transcript 取，缺省 zh）
INSERT INTO tracks (episode_id, language, audio_url, duration_seconds)
  SELECT e.id, COALESCE(t.language, 'zh'), e.audio_url, e.duration_seconds
  FROM episodes e
  LEFT JOIN transcripts t ON t.id = e.transcript_id
  WHERE e.audio_url IS NOT NULL
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "episodes" DROP COLUMN IF EXISTS "audio_url";
--> statement-breakpoint
-- ⑥ guests 种子数据
INSERT INTO guests (id, platform, name, intro, url) VALUES
  ('claude', 'claude', 'Claude', 'Anthropic 的 AI 助手', 'https://claude.ai'),
  ('chatgpt', 'chatgpt', 'ChatGPT', 'OpenAI 的 AI 助手', 'https://chatgpt.com'),
  ('deepseek', 'deepseek', 'DeepSeek', '深度求索的 AI 助手', 'https://deepseek.com'),
  ('gemini', 'gemini', 'Gemini', 'Google 的 AI 助手', 'https://gemini.google.com'),
  ('kimi', 'kimi', 'Kimi', '月之暗面的 AI 助手', 'https://kimi.moonshot.cn'),
  ('doubao', 'doubao', '豆包', '字节跳动的 AI 助手', 'https://www.doubao.com'),
  ('tongyi', 'tongyi', '通义', '阿里的 AI 助手', 'https://tongyi.aliyun.com'),
  ('perplexity', 'perplexity', 'Perplexity', 'Perplexity 的 AI 搜索引擎', 'https://www.perplexity.ai')
ON CONFLICT (platform) DO NOTHING;
