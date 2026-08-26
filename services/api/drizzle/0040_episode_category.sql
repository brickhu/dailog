-- Custom SQL migration file, put your code below! --
-- dailog episode category（Step A 选题维度 → token：insight / experience / advice / inspiration）
ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "category" text;
