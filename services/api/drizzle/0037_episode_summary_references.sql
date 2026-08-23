-- 2026-08-23：Step B 配套产物落库——summary（列表/分享短简介）与 references（对话名词术语条目）
ALTER TABLE "episodes" ADD COLUMN "summary" text;
ALTER TABLE "episodes" ADD COLUMN "references" jsonb DEFAULT '[]'::jsonb NOT NULL;
