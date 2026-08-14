-- 0027：账号级字段迁入 user + 外键统一指向 user.id + 投稿称呼列
-- user = 账户（+role/plan/credit_balance）；profiles = 主持人档案；业务实体归属 user
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "plan" text NOT NULL DEFAULT 'free';
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "credit_balance" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- 回填：profiles 既有值搬入 user（id 1:1）
UPDATE "user" u SET "role" = p.role, "plan" = p.plan, "credit_balance" = p.credit_balance FROM "profiles" p WHERE p.id = u.id;
--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "role";
--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "plan";
--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "credit_balance";
--> statement-breakpoint
-- 外键重建：voice_samples / submissions / episodes(user_id, host_id) → "user"(id)
-- 约束名不确定（0003 显式命名 / 0026 内联默认 *_fkey）——动态查名删除后统一重建
DO $$
DECLARE cn text;
BEGIN
  SELECT conname INTO cn FROM pg_constraint
    WHERE conrelid = 'voice_samples'::regclass AND contype = 'f' AND conname LIKE 'voice_samples_user_id%' LIMIT 1;
  IF cn IS NOT NULL THEN EXECUTE format('ALTER TABLE "voice_samples" DROP CONSTRAINT %I', cn); END IF;
  SELECT conname INTO cn FROM pg_constraint
    WHERE conrelid = 'submissions'::regclass AND contype = 'f' AND conname LIKE 'submissions_user_id%' LIMIT 1;
  IF cn IS NOT NULL THEN EXECUTE format('ALTER TABLE "submissions" DROP CONSTRAINT %I', cn); END IF;
  SELECT conname INTO cn FROM pg_constraint
    WHERE conrelid = 'episodes'::regclass AND contype = 'f' AND conname LIKE 'episodes_user_id%' LIMIT 1;
  IF cn IS NOT NULL THEN EXECUTE format('ALTER TABLE "episodes" DROP CONSTRAINT %I', cn); END IF;
  SELECT conname INTO cn FROM pg_constraint
    WHERE conrelid = 'episodes'::regclass AND contype = 'f' AND conname LIKE 'episodes_host_id%' LIMIT 1;
  IF cn IS NOT NULL THEN EXECUTE format('ALTER TABLE "episodes" DROP CONSTRAINT %I', cn); END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "voice_samples" ADD CONSTRAINT "voice_samples_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON UPDATE no action;
--> statement-breakpoint
-- 投稿称呼（本次节目主持人自称；脚本生成时按脚本语言改写）
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "call_name" text;
