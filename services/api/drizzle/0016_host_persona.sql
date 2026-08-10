-- profiles.persona：主持人默认人设（JSONB；生成脚本前展示可改，仅本次生效注入提示词）
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "persona" jsonb;
