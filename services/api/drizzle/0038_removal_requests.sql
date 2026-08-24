-- 0038：节目下线申请（用户「申请下线」→ 编辑审批）
-- 平台保留内容策展权：用户不能自助下架，只能提交申请；编辑审批通过 → episodes.is_public=false + 通知投稿人。
-- 删节目/删账号级联删申请；(episode_id) 索引支撑详情反查，(status, created_at) 支撑编辑队列。
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episode_removal_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "reason" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "handled_at" timestamp with time zone,
  "handled_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episode_removal_requests_episode_idx" ON "episode_removal_requests" ("episode_id");
CREATE INDEX IF NOT EXISTS "episode_removal_requests_status_idx" ON "episode_removal_requests" ("status", "created_at");
