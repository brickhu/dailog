UPDATE "submissions" SET "host" = jsonb_set(COALESCE("host", '{}'::jsonb), '{voiceSampleId}', to_jsonb("voice_sample_id"::text)) WHERE "voice_sample_id" IS NOT NULL AND ("host"->>'voiceSampleId') IS NULL;
ALTER TABLE "submissions" DROP COLUMN IF EXISTS "call_name";
ALTER TABLE "submissions" DROP COLUMN IF EXISTS "persona_info";
ALTER TABLE "submissions" DROP COLUMN IF EXISTS "voice_sample_id";
