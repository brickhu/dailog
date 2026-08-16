-- 0030：投稿人节目建议（submissions.suggestion）
-- 投稿确认页可选填写的选题参考（主题/角度/风格倾向）；编辑生成脚本时仅供
-- 选题视角参考，无参考价值可忽略。既有投稿无该字段，按 NULL 处理（可空）。
--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "suggestion" text;
