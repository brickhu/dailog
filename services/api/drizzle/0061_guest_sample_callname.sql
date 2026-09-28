-- 嘉宾声线的称呼回填（0061）
-- 0058 把 guest_voice_samples 并入 voice_samples 时没带 call_name（当时该列刚加），
-- 导致存量嘉宾声线的 call_name 为空；这里按嘉宾身份名补齐（只补空值，幂等）。
UPDATE "voice_samples" vs SET "call_name" = p."name"
FROM "guests" g
JOIN "profiles" p ON p."id" = g."profile_id"
WHERE vs."profile_id" = g."profile_id" AND vs."call_name" IS NULL;
