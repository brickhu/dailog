-- Admin 审核流程（2026-08-12）：记录拒审来源（llm 自动拒 / editor 人工拒）
ALTER TABLE polishes ADD COLUMN reviewed_by text;
