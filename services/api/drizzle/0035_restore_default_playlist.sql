-- 0035：恢复每个用户的默认「我的收藏」列表（0034 误删 is_default，回补）
-- 独立收藏按钮/接口与播放统计仍保持移除（0034）；默认列表保留为 Spotify「Liked Songs」式
-- 系统列表：每个用户自动拥有一个 is_default 列表（强制私有、不可编辑/删除/重排），
-- 节目通过「加入播放列表」加入；「加入播放列表」弹窗与 /me/playlists 置顶展示。
--> statement-breakpoint
ALTER TABLE "playlists" ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- 为所有尚无默认列表的用户建默认列表（slug 确定性 'favorites-' + user_id）
INSERT INTO "playlists" ("slug", "kind", "owner_id", "title", "description", "language", "is_public", "is_picked", "is_default", "created_at", "updated_at")
SELECT 'favorites-' || u.id, 'user', u.id, '我的收藏', NULL, 'zh', false, false, true, now(), now()
FROM "user" u
WHERE NOT EXISTS (
  SELECT 1 FROM "playlists" p WHERE p.owner_id = u.id AND p.is_default = true
)
ON CONFLICT ("slug") DO NOTHING;
