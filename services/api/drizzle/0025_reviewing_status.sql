-- 审核中状态持久化（2026-08-13）：审核是异步 LLM 创作（1-3 分钟），
-- 点击[审核]立即落库 reviewing——离开页面再返回仍显示"审核中"，完成后自动流转 accepted/rejected。
-- status 列原为自由 text（无约束）；此处补 CHECK 约束与 schema 枚举声明对齐（含 reviewing）
ALTER TABLE polishes ADD CONSTRAINT polishes_status_check
  CHECK (status IN ('editing', 'generating', 'published', 'failed', 'submitted', 'reviewing', 'accepted', 'rejected'));
