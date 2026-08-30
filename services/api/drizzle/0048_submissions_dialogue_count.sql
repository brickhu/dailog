-- 采集统计：dialogue_count（jsonb）——采集完成时记录对话规模
--   结构：{ messages, userTurns, assistantTurns, chars }（消息总数 / 用户轮数 / AI 轮数 / 总字数）
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "dialogue_count" jsonb;
