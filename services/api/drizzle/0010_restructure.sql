-- 清空重建：五层模型（snapshots → polishes → transcripts → episodes → tracks）
-- 废弃 imports/scripts；episodes 重构（去 draft/quality 字段，加 transcript_id/polish_id）
--> statement-breakpoint
DROP TABLE IF EXISTS "generation_jobs";
--> statement-breakpoint
DROP TABLE IF EXISTS "likes";
--> statement-breakpoint
DROP TABLE IF EXISTS "favorites";
--> statement-breakpoint
DROP TABLE IF EXISTS "scripts";
--> statement-breakpoint
DROP TABLE IF EXISTS "episodes";
--> statement-breakpoint
DROP TABLE IF EXISTS "imports";
--> statement-breakpoint
DROP TABLE IF EXISTS "transcripts";
--> statement-breakpoint
DROP TABLE IF EXISTS "polishes";
--> statement-breakpoint
DROP TABLE IF EXISTS "snapshots";
--> statement-breakpoint
CREATE TABLE "snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "url" text NOT NULL,
  "platform" text NOT NULL,
  "source_title" text,
  "source_conversation_id" text,
  "parsed_dialogue" jsonb,
  "quality" jsonb,
  "status" text DEFAULT 'ok' NOT NULL,
  "last_error" text,
  "retry_after" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "snapshots_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "polishes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "snapshot_id" uuid NOT NULL,
  "title" text,
  "status" text DEFAULT 'editing' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "polish_id" uuid NOT NULL,
  "segments" jsonb NOT NULL,
  "language" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "transcript_id" uuid NOT NULL,
  "polish_id" uuid NOT NULL,
  "slug" text NOT NULL,
  "title" text,
  "description" text,
  "cover_url" text,
  "audio_url" text,
  "duration_seconds" integer,
  "status" text DEFAULT 'generating' NOT NULL,
  "is_public" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone,
  CONSTRAINT "episodes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tracks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "episode_id" uuid NOT NULL,
  "language" text NOT NULL,
  "audio_url" text,
  "duration_seconds" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "episode_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "likes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "episode_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "episode_id" uuid NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "progress" integer DEFAULT 0 NOT NULL,
  "error" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "polishes" ADD CONSTRAINT "polishes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "polishes" ADD CONSTRAINT "polishes_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id");
--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_polish_id_polishes_id_fk" FOREIGN KEY ("polish_id") REFERENCES "polishes"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_transcript_id_transcripts_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "transcripts"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_polish_id_polishes_id_fk" FOREIGN KEY ("polish_id") REFERENCES "polishes"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "polishes_user_snapshot_unique" ON "polishes" ("user_id","snapshot_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_user_episode_unique" ON "favorites" ("user_id","episode_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "likes_user_episode_unique" ON "likes" ("user_id","episode_id");
