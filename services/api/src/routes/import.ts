// 分享链接导入：POST /api/import {url}
//  ① snapshots 查 URL（分享内容固定 → 快照全局唯一）——未命中调 importer
//     （成功/失败都写快照；platform_unreachable 标注 10 分钟可重试）
//  ② polishes 查 user × snapshot——已存在返回 existing（前端跳编辑页）
//  ③ 质量分析（LLM，结果写快照）→ 返回 { dialogue, quality }
// 预览确认后由 POST /api/polishes/new 创建容器。

import { Hono } from "hono";
import type { LlmClient } from "../llm/client";
import { qualityCheckPrompt, parseJsonLoose } from "../llm/prompts";
import type { QualityResult } from "../db/schema";

export interface ImportDeps {
  getSnapshotByUrl(url: string): Promise<{
    id: string;
    platform: string;
    sourceTitle: string | null;
    sourceConversationId: string | null;
    parsedDialogue: unknown;
    quality: QualityResult | null;
    status: "ok" | "unreachable" | "parse_failed";
    retryAfter: Date | null;
    lastError: string | null;
  } | null>;
  createSnapshot(row: { url: string; platform: string; sourceTitle: string | null; sourceConversationId: string | null; parsedDialogue: unknown }): Promise<{ id: string }>;
  updateSnapshotContent(id: string, row: { platform: string; sourceTitle: string | null; sourceConversationId: string | null; parsedDialogue: unknown }): Promise<void>;
  updateSnapshotQuality(id: string, quality: QualityResult): Promise<void>;
  markSnapshotUnreachable(id: string, error: string): Promise<void>;
  markSnapshotParseFailed(id: string, error: string): Promise<void>;
  findPolishByUserSnapshot(userId: string, snapshotId: string): Promise<{ id: string; title: string | null } | null>;
  qualityCheck(messages: { role: string; content: string }[]): Promise<QualityResult>;
  llm: LlmClient;
}

interface Dialogue {
  platform: string;
  conversationId: string;
  title: string;
  url: string;
  messages: { role: string; content: string }[];
}

export function importRoutes(deps: ImportDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();

  /** 调 importer 采集（带 token）→ dialogue 或 { error } */
  const callImporter = async (url: string): Promise<{ ok: true; dialogue: Dialogue } | { ok: false; error: string; detail?: unknown }> => {
    const base = process.env.IMPORTER_URL;
    if (!base) return { ok: false, error: "share_collect_not_configured" };
    const token = process.env.IMPORTER_TOKEN;
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/collect`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(90000),
      });
      const data = (await res.json().catch(() => null)) as Dialogue & { error?: string; detail?: unknown };
      if (!res.ok || !data?.messages?.length) return { ok: false, error: data?.error ?? `采集失败（HTTP ${res.status}）`, detail: data?.detail };
      return { ok: true, dialogue: data };
    } catch {
      return { ok: false, error: "share_collect_unreachable" };
    }
  };

  app.post("/api/import", async (c) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
    if (!body || typeof body.url !== "string" || !body.url.startsWith("http")) {
      return c.json({ error: "invalid_url" }, 400);
    }
    const url = body.url;

    // ① 快照缓存
    let snapshot = await deps.getSnapshotByUrl(url);
    if (snapshot) {
      // 触达失败缓存：10 分钟内不重试 importer
      if (snapshot.status === "unreachable" && snapshot.retryAfter && snapshot.retryAfter.getTime() > Date.now()) {
        return c.json({ error: "platform_unreachable", detail: { message: snapshot.lastError ?? "采集服务暂时不可达，10 分钟后再试" } }, 502);
      }
      if (snapshot.status === "parse_failed" && !snapshot.parsedDialogue) {
        return c.json({ error: "parse_failed", detail: { message: snapshot.lastError ?? "该分享页解析失败" } }, 422);
      }
    } else {
      const result = await callImporter(url);
      if (!result.ok) {
        // 失败也写快照（避免反复调 importer；unreachable 10 分钟可重试）
        const created = await deps.createSnapshot({ url, platform: "plain", sourceTitle: null, sourceConversationId: null, parsedDialogue: null });
        if (result.error === "platform_unreachable") {
          await deps.markSnapshotUnreachable(created.id, String((result.detail as { message?: string } | undefined)?.message ?? result.error));
        } else {
          await deps.markSnapshotParseFailed(created.id, result.error);
        }
        const status = result.error === "platform_unreachable" || result.error === "share_collect_unreachable" ? 502 : 422;
        return c.json({ error: result.error }, status);
      }
      const created = await deps.createSnapshot({
        url,
        platform: result.dialogue.platform,
        sourceTitle: result.dialogue.title || null,
        sourceConversationId: result.dialogue.conversationId || null,
        parsedDialogue: result.dialogue.messages,
      });
      snapshot = await deps.getSnapshotByUrl(url);
      if (!snapshot) return c.json({ error: "parse_failed" }, 422);
    }

    // ② polish 检查：用户已创建过该快照的容器 → 跳转编辑页
    const existing = await deps.findPolishByUserSnapshot(userId, snapshot.id);
    if (existing) {
      return c.json({ existing: true, polishId: existing.id, title: existing.title ?? snapshot.sourceTitle });
    }

    // ③ 质量分析（LLM，结果写快照——内容固定只分析一次）
    let quality = snapshot.quality;
    if (!quality && snapshot.parsedDialogue) {
      const messages = (snapshot.parsedDialogue as { role: string; content: string }[]).map((m) => ({ role: m.role, content: m.content }));
      try {
        quality = await deps.qualityCheck(messages);
        await deps.updateSnapshotQuality(snapshot.id, quality);
      } catch {
        quality = null; // 质量分析失败不阻塞导入
      }
    }

    return c.json({
      dialogue: {
        platform: snapshot.platform,
        conversationId: snapshot.sourceConversationId ?? url,
        title: snapshot.sourceTitle ?? "分享对话",
        url,
        messages: snapshot.parsedDialogue ?? [],
      },
      quality,
      snapshotId: snapshot.id,
    });
  });

  return app;
}

export type { QualityResult };
export { qualityCheckPrompt, parseJsonLoose };
