-- Custom SQL migration file, put your code below! --
-- 0042：修复 dev 库迁移失配（2026-08-26 详情页 500 根因）
--   0040 的 episodes.category 列被 drizzle meta 记录但从未真正生效（meta 与表结构失配），
--   0041 的 grok 嘉宾行也未应用。本迁移幂等补上，任何环境部署时自动自愈。
ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "category" text;
INSERT INTO guests (id, platform, name, intro, url) VALUES
  ('grok', 'grok', 'Grok', 'xAI 的 AI 对话助手（X 平台内置）', 'https://x.com/i/grok')
ON CONFLICT (platform) DO NOTHING;
