-- 内容溯源（2026-08-12）：
--  ① snapshots.fingerprint：归一化消息序列指纹（sha256 hex）——精确重复检测入口
--  ② snapshots.prefix_source_id：自动检测的"内容前缀源"快照（B 基于 A 的对话续写再分享 → B 的消息序列以 A 为前缀 → 溯源指向 A）
ALTER TABLE "snapshots" ADD COLUMN "fingerprint" text;
ALTER TABLE "snapshots" ADD COLUMN "prefix_source_id" uuid REFERENCES "snapshots"("id");
