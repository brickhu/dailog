-- 投稿 URL 全局唯一（确定性 ID 下同 URL 同 ID；任何人重复提交同一分享链接都拒绝）
DROP INDEX IF EXISTS "submissions_user_url";
CREATE UNIQUE INDEX IF NOT EXISTS "submissions_url" ON "submissions" ("url");
