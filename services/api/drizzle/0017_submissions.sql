-- 投稿制改造（2026-08-11）：
--  ① profiles.role：角色体系（user 投稿人 / editor 编辑 / admin 管理员）——studio 管理员工作台仅 admin/editor
--  ② polishes.status 为 text 列（无 DB 枚举约束），submitted/accepted/rejected 由应用层写入，无需 DDL
-- 注：meta 快照 0010–0016 缺失为仓库既有状态，drizzle-kit generate 交互式不可用，迁移手写维护
ALTER TABLE "profiles" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;
