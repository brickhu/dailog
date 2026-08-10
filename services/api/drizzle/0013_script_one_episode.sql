-- 一个脚本只能生成一期节目：清理重复（每 transcript 只留最新一期），加唯一约束
DELETE FROM episodes a USING episodes b
  WHERE a.transcript_id = b.transcript_id
    AND a.created_at < b.created_at;
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_transcript_id_unique" UNIQUE ("transcript_id");
