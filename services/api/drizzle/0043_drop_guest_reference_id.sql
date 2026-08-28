-- guest_voice_samples 去掉 reference_id：产品 TTS 只走 2D references 内联路径（音频 + transcript），
-- 逐段降级用固定音色 id（reference_id）已废弃；上传端点从不写该列，直接删列。
ALTER TABLE "guest_voice_samples" DROP COLUMN IF EXISTS "reference_id";
