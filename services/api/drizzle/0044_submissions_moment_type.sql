-- 投稿人选定收获时刻（投稿页下拉框必填：新知/经验/建议/启发 → insight/experience/advice/inspiration）。
-- 用户呈现意图的最强信号——选题（SC-STEP-1）只在选定维度内找时刻；
-- 存量投稿为 NULL（按旧流程四维找），列允许为空。
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "moment_type" text;
