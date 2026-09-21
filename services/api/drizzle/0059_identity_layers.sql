-- 身份层重构（0059）：账号 / 身份 / 采样 三层彻底分开
--   ① 账号 user：name = 用户名（仅英文数字、唯一、主页 /@name）
--   ② 身份 profiles：display_name → name；新增 avatar（**唯一头像源**）/ url；
--      主持人与嘉宾的身份档案都在这张表，不加 type（嘉宾身份由 guests.profile_id 指向）
--   ③ 嘉宾登记 guests：只留 id(平台键)/platform/profile_id；name/avatar/intro/url 搬到 profiles
--   ④ 采样 voice_samples：user_id/guest_id → profile_id（1 profile = [zh 采样][en 采样]…）

-- ---- 1) profiles：改名 + 新列 ----
ALTER TABLE "profiles" RENAME COLUMN "display_name" TO "name";
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "avatar" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "url" text;

-- 账号头像（better-auth user.image）迁移到身份层：此后 profiles.avatar 是唯一头像源
UPDATE "profiles" p SET "avatar" = u."image"
FROM "user" u
WHERE u."id" = p."id" AND p."avatar" IS NULL AND u."image" IS NOT NULL;

-- ---- 2) 嘉宾身份档案：每个 guest 一行 profile（guest 身份与账号解耦 → 新 uuid）----
-- profiles 不再只装账号身份 → 去掉 id → user.id 的外键（嘉宾 profile 没有对应账号）。
-- 代价：删账号不再级联删身份（当前没有账号删除功能，需要时另加清理）。
ALTER TABLE "profiles" DROP CONSTRAINT IF EXISTS "profiles_id_user_id_fk";

ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "profile_id" text;
UPDATE "guests" SET "profile_id" = gen_random_uuid()::text WHERE "profile_id" IS NULL;

INSERT INTO "profiles" ("id", "name", "avatar", "bio", "url", "created_at")
SELECT g."profile_id", g."name", g."avatar", g."intro", g."url", g."created_at"
FROM "guests" g
WHERE NOT EXISTS (SELECT 1 FROM "profiles" p WHERE p."id" = g."profile_id");

ALTER TABLE "guests" ALTER COLUMN "profile_id" SET NOT NULL;
ALTER TABLE "guests" DROP CONSTRAINT IF EXISTS "guests_profile_id_fkey";
ALTER TABLE "guests" ADD CONSTRAINT "guests_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS "guests_profile_id_unique" ON "guests" ("profile_id");

ALTER TABLE "guests" DROP COLUMN IF EXISTS "name";
ALTER TABLE "guests" DROP COLUMN IF EXISTS "avatar";
ALTER TABLE "guests" DROP COLUMN IF EXISTS "intro";
ALTER TABLE "guests" DROP COLUMN IF EXISTS "url";

-- ---- 3) 采样挂 profile ----
ALTER TABLE "voice_samples" ADD COLUMN IF NOT EXISTS "profile_id" text;
UPDATE "voice_samples" SET "profile_id" = "user_id" WHERE "user_id" IS NOT NULL AND "profile_id" IS NULL;
UPDATE "voice_samples" vs SET "profile_id" = g."profile_id"
FROM "guests" g
WHERE vs."guest_id" = g."id" AND vs."profile_id" IS NULL;

DELETE FROM "voice_samples" WHERE "profile_id" IS NULL;  -- 无主行（理论上不存在）

ALTER TABLE "voice_samples" ALTER COLUMN "profile_id" SET NOT NULL;
ALTER TABLE "voice_samples" DROP CONSTRAINT IF EXISTS "voice_samples_profile_id_fkey";
ALTER TABLE "voice_samples" ADD CONSTRAINT "voice_samples_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE;

DROP INDEX IF EXISTS "voice_samples_user_language";
DROP INDEX IF EXISTS "voice_samples_guest_language";
ALTER TABLE "voice_samples" DROP CONSTRAINT IF EXISTS "voice_samples_owner_chk";
CREATE UNIQUE INDEX IF NOT EXISTS "voice_samples_profile_language" ON "voice_samples" ("profile_id", "language");

ALTER TABLE "voice_samples" DROP COLUMN IF EXISTS "user_id";
ALTER TABLE "voice_samples" DROP COLUMN IF EXISTS "guest_id";

-- ---- 4) 投稿快照：personaInfo.displayName → name ----
UPDATE "submissions"
SET "host" = jsonb_set("host", '{personaInfo}',
      ((("host"->'personaInfo') - 'displayName') || jsonb_build_object('name', "host"->'personaInfo'->'displayName')))
WHERE "host" IS NOT NULL AND ("host"->'personaInfo') ? 'displayName';

-- ---- 5) 用户名（user.name）：仅英文数字 + 唯一（大小写不敏感）----
-- 存量不合规 → 换成邮箱前缀（清洗非字母数字）；前缀为空 → user<id 前 6 位>；重名 → 加 id 摘要后缀
UPDATE "user" SET "name" = regexp_replace(split_part("email", '@', 1), '[^A-Za-z0-9]', '', 'g')
WHERE "name" !~ '^[A-Za-z0-9]+$';

UPDATE "user" SET "name" = 'user' || substr(replace("id", '-', ''), 1, 6)
WHERE "name" IS NULL OR "name" = '';

WITH dup AS (
  SELECT "id", lower("name") AS n,
         row_number() OVER (PARTITION BY lower("name") ORDER BY "created_at", "id") AS rn
  FROM "user"
)
UPDATE "user" u SET "name" = d.n || '-' || substr(md5(u."id"), 1, 4)
FROM dup d WHERE u."id" = d."id" AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "user_name_lower_unique" ON "user" (lower("name"));
