-- 采集状态改枚举：collected（-1=采集失败 / 0=未采集 / 1=采集成功）
--   理由：R2 key 可由 URL 哈希推导（dialogues/{sha256(url)前32}.json），无需存库；
--   拒绝投稿删除 R2 对象后，库里不残留废弃地址。
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "collected" smallint NOT NULL DEFAULT 0;

-- 回填：dialogue_r2_key 非空且非 error: 前缀 → 已采集(1)；error: 前缀 → 采集失败(-1)；空 → 未采集(0)
UPDATE "submissions" SET "collected" = CASE
  WHEN "dialogue_r2_key" LIKE 'error:%' THEN -1
  WHEN "dialogue_r2_key" IS NOT NULL THEN 1
  ELSE 0
END;

-- 删旧列（R2 key 不再存库）
ALTER TABLE "submissions" DROP COLUMN IF EXISTS "dialogue_r2_key";
