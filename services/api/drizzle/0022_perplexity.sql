-- Perplexity 平台支持（2026-08-12）：
-- guests 平台嘉宾（perplexity 分享 /search/<slug>-<id>；id=platform 惯例）
INSERT INTO guests (id, platform, name, intro, url) VALUES
  ('perplexity', 'perplexity', 'Perplexity', 'Perplexity 的 AI 搜索引擎', 'https://www.perplexity.ai')
ON CONFLICT (platform) DO NOTHING;
