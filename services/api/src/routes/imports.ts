import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { isCollectedDialogue, type CollectedDialogue, type Platform } from "../dialogue";
import type { AudioStorage } from "../storage";
import { writeDialogue, deleteDialogue, mergeDialogue } from "../dialogue-store";

export interface ImportRow {
  /** 路由层预生成（R2 对象 key 依赖 importId，先 put 后插库） */
  id: string;
  userId: string;
  platform: Platform;
  sourceTitle: string;
  sourceConversationId: string;
  sourceUrl: string;
}

export interface EpisodeRow {
  userId: string;
  title: string;
  status: "draft";
  language: string | null;
}

export interface ImportsRepo {
  /** 频道开通校验（未开通 → 采集引导创建频道）：profiles.channel_activated_at */
  getChannelActivatedAt(userId: string): Promise<Date | null>;
  /** 按来源查已有导入（join episodes 拿 episodeId：409 时可直接跳已有草稿编辑） */
  findImportBySource(userId: string, platform: Platform, conversationId: string): Promise<{ id: string; episodeId: string } | null>;
  /** 唯一约束冲突（并发竞态）surface 为 { duplicate: true } */
  insertImport(row: ImportRow): Promise<{ id: string } | { duplicate: true }>;
  insertEpisode(row: EpisodeRow): Promise<{ id: string }>;
  /** insertImport + insertEpisode 同事务写入，避免部分失败孤儿行 */
  createImport(importRow: ImportRow, episodeRow: EpisodeRow): Promise<{ importId: string; episodeId: string } | { duplicate: true }>;
}

export function importsRoutes(repo: ImportsRepo, storage: AudioStorage) {
  const app = new Hono<{ Variables: { userId: string } }>();
  app.post("/imports", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!isCollectedDialogue(body)) return c.json({ error: "invalid_dialogue" }, 400);
    const userId = c.get("userId") as string;
    // 频道开通校验：未开通（未创建频道）→ 403，扩展据此引导先去 onboarding 创建频道
    const activated = await repo.getChannelActivatedAt(userId);
    if (!activated) return c.json({ error: "channel_not_activated" }, 403);
    // 同一来源重复采集：内容比对合并（一致直接回已有草稿；有新消息追加到 R2 对话末尾）
    const existing = await repo.findImportBySource(userId, body.platform, body.conversationId);
    if (existing) {
      const appended = await mergeDialogue(storage, existing.id, body);
      return c.json({
        importId: existing.id,
        episodeId: existing.episodeId,
        merged: true,
        appended,
      }, 200);
    }

    // 原始对话存 R2（imports/{importId}.dialogue.json），meta 存库。
    // 顺序：先 put R2 → 再插库；DB 失败/重复时删除 R2 对象（补偿，防孤儿对象）。
    const importId = randomUUID();
    await writeDialogue(storage, importId, body);
    try {
      const result = await repo.createImport(
        {
          id: importId, userId, platform: body.platform, sourceTitle: body.title,
          sourceConversationId: body.conversationId, sourceUrl: body.url,
        },
        { userId, title: body.title, status: "draft", language: null },
      );
      if ("duplicate" in result) {
        await deleteDialogue(storage, importId);
        return c.json({ error: "already_imported" }, 409);
      }
      return c.json({ importId: result.importId, episodeId: result.episodeId }, 201);
    } catch (e) {
      await deleteDialogue(storage, importId);
      throw e;
    }
  });
  return app;
}
