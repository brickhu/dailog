-- 采集标记：采集成功（含 R2 缓存命中）后写入 dialogue 的 R2 key（如 dialogues/<sha256(url)前32>.json）
--   有值 = 已采集（可从 R2 按 key 取回对话）；NULL = 未采集
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "dialogue_r2_key" text;
