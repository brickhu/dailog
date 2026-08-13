-- 架构极简改造（2026-08-13）：投稿 = URL + 采样，制作 = 编辑本地 Agent
--  ① 删除内容五层旧表：snapshots → polishes → transcripts → episodes(旧) → tracks，以及
--     generation_jobs（服务端生成队列）、payments/subscriptions（旧付费残留）
--  ② 新建 submissions：用户提交 URL + 声音采样，status=submitted 待审核；
--     rejected（拒审附原因）/ published（编辑上传成品后）
--  ③ episodes 重建：submission_id 关联投稿，audio_url/audio_size 直读（tracks 下线），
--     status 收敛 published（编辑上传即发布）
--  ④ notifications.type 收敛：accepted 并入 published（新模型无"已收录待生成"态）
--  保留：guests / guest_voice_samples（品牌声线宿主）、voice_samples、favorites、likes
--
-- 依赖顺序：先删引用方（tracks/jobs/favorites/likes 引用 episodes），再删被引用方

DROP TABLE IF EXISTS "tracks";
DROP TABLE IF EXISTS "generation_jobs";
DROP TABLE IF EXISTS "favorites";
DROP TABLE IF EXISTS "likes";
DROP TABLE IF EXISTS "episodes";
DROP TABLE IF EXISTS "transcripts";
DROP TABLE IF EXISTS "polishes";
DROP TABLE IF EXISTS "snapshots";
DROP TABLE IF EXISTS "payments";
DROP TABLE IF EXISTS "subscriptions";

-- 投稿表：唯一约束 (user_id, url) 防重复投稿
CREATE TABLE IF NOT EXISTS "submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "profiles"("id") ON DELETE cascade,
  "url" text NOT NULL,
  "title" text,
  "status" text DEFAULT 'submitted' NOT NULL,
  "rejected_reason" text,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "submissions_user_url" ON "submissions" ("user_id", "url");
CREATE INDEX IF NOT EXISTS "submissions_status_idx" ON "submissions" ("status", "created_at");

-- 成品节目：编辑一次性上传即发布
CREATE TABLE IF NOT EXISTS "episodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "submission_id" uuid NOT NULL REFERENCES "submissions"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "profiles"("id") ON DELETE cascade,
  "host_id" text REFERENCES "profiles"("id"),
  "guest_id" text REFERENCES "guests"("id"),
  "slug" text NOT NULL UNIQUE,
  "title" text,
  "description" text,
  "cover_url" text,
  "audio_url" text NOT NULL,
  "audio_size" integer,
  "duration_seconds" integer,
  "language" text DEFAULT 'zh' NOT NULL,
  "tags" text[],
  "number" integer,
  "is_picked" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'published' NOT NULL,
  "is_public" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "episodes_status_published_idx" ON "episodes" ("status", "is_public", "published_at");
CREATE INDEX IF NOT EXISTS "episodes_submission_idx" ON "episodes" ("submission_id");

-- 消费端互动（重建）
CREATE TABLE IF NOT EXISTS "favorites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "favorites_user_episode" ON "favorites" ("user_id", "episode_id");

CREATE TABLE IF NOT EXISTS "likes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "likes_user_episode" ON "likes" ("user_id", "episode_id");

-- 通知类型收敛：accepted（已收录待生成）在新模型不存在 → 并入 published
UPDATE "notifications" SET "type" = 'published' WHERE "type" = 'accepted';
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_type_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check"
  CHECK ("type" IN ('rejected', 'published'));
