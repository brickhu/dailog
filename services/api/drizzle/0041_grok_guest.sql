-- Custom SQL migration file, put your code below! --
-- Grok 平台支持（2026-08-26）：
-- guests 平台嘉宾（grok 分享 x.com/i/grok/share/<id>；id=platform 惯例）
INSERT INTO guests (id, platform, name, intro, url) VALUES
  ('grok', 'grok', 'Grok', 'xAI 的 AI 对话助手（X 平台内置）', 'https://x.com/i/grok')
ON CONFLICT (platform) DO NOTHING;
