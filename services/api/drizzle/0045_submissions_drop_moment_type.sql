-- 回滚：投稿页不再让用户选择收获时刻（用户不知最优、与系统判定冲突）——
-- 选题回归系统从四维判定最优；moment_type 列为回滚产物，直接删除。
ALTER TABLE "submissions" DROP COLUMN IF EXISTS "moment_type";
