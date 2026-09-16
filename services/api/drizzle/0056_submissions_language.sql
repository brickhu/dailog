-- 投稿区（目标语言）：同一对话可分别投递到不同语言区（一投稿 = 一语言 = 一期节目）。
-- 存量数据全部落 'zh'；旧索引 url 全局唯一 → (url,'zh') 天然唯一，无需回填。
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "language" text NOT NULL DEFAULT 'zh';
DROP INDEX IF EXISTS "submissions_url";
CREATE UNIQUE INDEX IF NOT EXISTS "submissions_url_language" ON "submissions" ("url", "language");
