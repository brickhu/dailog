-- 节目出演名单物化（0060）：episodes.cast = [{name, role, slug, avatar_url, profile_id}]（发布时定格）
-- 键名按数据契约（snake_case）；host 一条 + 有嘉宾时再一条 guest。
ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "cast" jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 存量回填：按当前实际显示规则定格一次（host: 该期称呼 → 身份名 → 用户名）
UPDATE "episodes" e SET "cast" = sub."cast"
FROM (
  SELECT e2.id,
         jsonb_build_array(
           jsonb_build_object(
             'role', 'host',
             'name', COALESCE(s."host"->>'callName', p."name", u."name"),
             'slug', u."name",
             'avatar_url', p."avatar",
             'profile_id', e2."user_id"
           )
         )
         || CASE WHEN e2."guest_id" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(
              jsonb_build_object(
                'role', 'guest',
                'name', gp."name",
                'slug', e2."guest_id",
                'avatar_url', gp."avatar",
                'profile_id', g."profile_id"
              )
            ) END AS "cast"
  FROM "episodes" e2
  JOIN "submissions" s ON s."id" = e2."submission_id"
  JOIN "user" u ON u."id" = e2."user_id"
  LEFT JOIN "profiles" p ON p."id" = e2."user_id"
  LEFT JOIN "guests" g ON g."id" = e2."guest_id"
  LEFT JOIN "profiles" gp ON gp."id" = g."profile_id"
) sub
WHERE e."id" = sub."id" AND (e."cast" IS NULL OR e."cast" = '[]'::jsonb);
-- 注：cast 是 SQL 保留字，别名一律加双引号
