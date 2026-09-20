-- 声采样统一表 + profile 回归账号级（0058）
-- 变更要点：
--   1) profiles 不再区分语言：host_roles 拆回 gender/profession/age/nationality（账号级）
--   2) voice_samples 成为**主持人 + 嘉宾共用**的声采样表：owner = user_id 或 guest_id（恰好一个），
--      行上带 call_name（该语种节目中的称呼）；audio_url 可空（draft = 只配了称呼还没录音）
--   3) guest_voice_samples 并入 voice_samples 后删除

-- ---- 1) profiles：host_roles → 账号级画像列 ----
-- （0057 未跑过的库上也能安全执行：先确保 host_roles 存在——为空则下面的 COALESCE 直接取原列值）
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "host_roles" jsonb;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "gender" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "profession" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "age" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "nationality" text;

UPDATE "profiles" SET
  "gender"      = COALESCE("gender",      "host_roles"->'zh'->>'gender',      "host_roles"->'en'->>'gender'),
  "profession"  = COALESCE("profession",  "host_roles"->'zh'->>'profession',  "host_roles"->'en'->>'profession'),
  "age"         = COALESCE("age",         "host_roles"->'zh'->>'age',         "host_roles"->'en'->>'age'),
  "nationality" = COALESCE("nationality", "host_roles"->'zh'->>'nationality', "host_roles"->'en'->>'nationality')
WHERE "host_roles" IS NOT NULL;

-- ---- 2) voice_samples：统一表结构 ----
ALTER TABLE "voice_samples" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "voice_samples" ALTER COLUMN "audio_url" DROP NOT NULL;
ALTER TABLE "voice_samples" ALTER COLUMN "duration" SET DEFAULT 0;
ALTER TABLE "voice_samples" ADD COLUMN IF NOT EXISTS "guest_id" text REFERENCES "guests"("id") ON DELETE CASCADE;
ALTER TABLE "voice_samples" ADD COLUMN IF NOT EXISTS "call_name" text;

-- 主持人的称呼：host_roles[language].callName → 缺省用展示名
UPDATE "voice_samples" vs SET "call_name" = COALESCE(p."host_roles"->vs."language"->>'callName', p."display_name")
FROM "profiles" p
WHERE p."id" = vs."user_id" AND vs."call_name" IS NULL;

-- ---- 3) 嘉宾声线并入（guests/{guestId}/{language}.mp3；称呼默认取嘉宾名）----
INSERT INTO "voice_samples" ("user_id", "guest_id", "language", "audio_url", "transcript", "duration", "call_name", "status", "created_at")
SELECT NULL, gvs."guest_id", gvs."language", gvs."audio_key", gvs."transcript", 0,
       COALESCE(g."name", gvs."guest_id"), 'ready', gvs."created_at"
FROM "guest_voice_samples" gvs
LEFT JOIN "guests" g ON g."id" = gvs."guest_id"
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS "guest_voice_samples";

-- ---- 4) 约束：owner × 语种唯一（部分唯一索引）+ owner 恰好一个 ----
DROP INDEX IF EXISTS "voice_samples_user_language";
CREATE UNIQUE INDEX IF NOT EXISTS "voice_samples_user_language" ON "voice_samples" ("user_id", "language") WHERE "user_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "voice_samples_guest_language" ON "voice_samples" ("guest_id", "language") WHERE "guest_id" IS NOT NULL;

ALTER TABLE "voice_samples" DROP CONSTRAINT IF EXISTS "voice_samples_owner_chk";
ALTER TABLE "voice_samples" ADD CONSTRAINT "voice_samples_owner_chk"
  CHECK (("user_id" IS NOT NULL) <> ("guest_id" IS NOT NULL));

-- ---- 5) 角色表下线 ----
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "host_roles";
