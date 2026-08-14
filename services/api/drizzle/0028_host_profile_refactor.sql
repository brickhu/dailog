-- 0028：主持人档案重构——@slug=user.name；persona 拆列；采样挂档案；投稿快照；节目台本
--> statement-breakpoint
-- 1. user.name 存量重名去重（@slug 用；注册时应用层强制唯一，DB 不加约束）
WITH dup AS (
  SELECT id, name, row_number() OVER (PARTITION BY name ORDER BY created_at) - 1 AS rn
  FROM "user"
)
UPDATE "user" u SET name = u.name || '-' || d.rn
FROM dup d WHERE d.id = u.id AND d.rn > 0;
--> statement-breakpoint
-- 2. profiles：persona jsonb 拆列（gender/profession/age 搬入；callName=display_name 已存在；traits 丢弃）
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "gender" text;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "profession" text;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "age" text;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "nationality" text;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "social_links" jsonb;
--> statement-breakpoint
UPDATE "profiles" SET
  "gender" = persona->>'gender',
  "profession" = persona->>'profession',
  "age" = persona->>'age'
WHERE persona IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "persona";
--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "username";
--> statement-breakpoint
-- 3. voice_samples 归属主持人档案（FK → profiles.id；0027 的 user_id_user_id_fk 重建）
ALTER TABLE "voice_samples" DROP CONSTRAINT IF EXISTS "voice_samples_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "voice_samples" ADD CONSTRAINT "voice_samples_user_id_profiles_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- 4. submissions：主持人档案快照 + 投稿关联采样
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "persona_info" jsonb;
--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "voice_sample_id" uuid
  REFERENCES "voice_samples"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- 5. episodes：host_id → profile_id（FK 指向 profiles）+ 台本 + 原始对话链接
ALTER TABLE "episodes" RENAME COLUMN "host_id" TO "profile_id";
--> statement-breakpoint
ALTER TABLE "episodes" DROP CONSTRAINT IF EXISTS "episodes_host_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_profile_id_profiles_id_fk"
  FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "transcript" text;
--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "raw_conversation_url" text;
