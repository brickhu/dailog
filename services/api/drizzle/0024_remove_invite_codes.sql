-- 邀请码机制移除（2026-08-12）：频道改为自动开通，invite_codes 表与注册字段一并删除
DROP TABLE IF EXISTS invite_codes;
ALTER TABLE "user" DROP COLUMN IF EXISTS invite_code;
