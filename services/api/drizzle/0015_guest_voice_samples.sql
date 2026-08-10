-- ① guest_voice_samples：嘉宾音频采样（按平台 × 语种各一条，upsert 录入）
-- audio_key = storage key（R2/fs）；reference_id = TTS 音色 id（逐段降级路径）；
-- transcript = 参考音频转录文本（2D references 主路径用，替换采样音频时一并更新）
CREATE TABLE IF NOT EXISTS "guest_voice_samples" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "guest_id" text NOT NULL REFERENCES "guests"("id") ON DELETE CASCADE,
  "language" text NOT NULL DEFAULT 'zh',
  "audio_key" text NOT NULL,
  "reference_id" text,
  "transcript" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "guest_voice_samples_guest_language_unique" UNIQUE("guest_id","language")
);
