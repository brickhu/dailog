-- Custom SQL migration file, put your code below! --
-- 0062：节目分类口径切换——从「听众拿走什么」(insight/experience/advice/inspiration)
--       切到「思考现场是什么」，即 R1 的 scene_type：decision/understanding/reflection/creation/reframing。
-- 仅改分类字段，不动任何节目内容（标题/简介/音频/台本一律不碰）。
-- 历史数据没有 reframing（转念）的来源，所以回填只会产出四类；
-- category 为 NULL 的节目（分类字段上线前发布）保持 NULL。
UPDATE "episodes" SET "category" = CASE "category"
  WHEN 'insight' THEN 'understanding'
  WHEN 'experience' THEN 'reflection'
  WHEN 'advice' THEN 'decision'
  WHEN 'inspiration' THEN 'creation'
  ELSE "category"
END
WHERE "category" IN ('insight', 'experience', 'advice', 'inspiration');
