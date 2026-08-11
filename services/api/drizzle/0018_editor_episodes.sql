-- 管理端（P2，2026-08-11）：
--  ① episodes.is_picked：精选标记（首页播放器 / discover/picked）
--  ② episodes.number：数字期号（发布确认时分配 max+1，唯一；未发布无编号）
--  ③ episodes.status 增加 ready：生成完成待编辑确认 → 编辑确认发布（text 列，应用层控制，无需 ALTER）
--  ④ polishes.rejected_reason / reviewed_at：拒绝原因（投稿人可见）+ 编辑处理时间
--  ⑤ transcripts 无需变更（脚本候选 1–N 版按话题切分，现有 topic 字段承载）
ALTER TABLE "episodes" ADD COLUMN "is_picked" boolean DEFAULT false NOT NULL;
ALTER TABLE "episodes" ADD COLUMN "number" integer;
ALTER TABLE "polishes" ADD COLUMN "rejected_reason" text;
ALTER TABLE "polishes" ADD COLUMN "reviewed_at" timestamp with time zone;
