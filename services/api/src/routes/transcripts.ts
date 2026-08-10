// 润色脚本：POST /api/transcripts/new { polishId, instruction? }
// SSE 流式：基于快照对话（polish → snapshot.parsedDialogue）润色生成
// transcript（一条独立记录，无版本概念；polish 可包含多个）。
// 润色上限：transcripts 数量（free 5 条 / pro 不限）。

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { LlmClient } from "../llm/client";
import { polishPrompt, parseJsonLoose } from "../llm/prompts";
import type { ScriptSegment } from "./episodes";


export interface TranscriptsDeps {
  /** polish 归属校验 + 快照对话（经 snapshot.parsedDialogue）+ 润色 meta（host 称呼/对话平台） */
  getDialogueForPolish(
    polishId: string,
    userId: string,
  ): Promise<{ messages: { role: string; content: string }[]; platform: string } | null>;
  /** 润色计数（transcripts 数量） */
  getTranscriptCount(polishId: string): Promise<number>;
  /** 润色上限：null = 不限（pro）；free = 5 条 */
  getPolishLimit(userId: string): Promise<number | null>;
  createTranscript(
    polishId: string,
    segments: ScriptSegment[],
    language: string | null,
    opts?: { topic?: string | null; title?: string | null; creationNote?: string | null; hostName?: string | null; guestId?: string | null; guestName?: string | null },
  ): Promise<{ id: string }>;
  /** 平台 → 嘉宾（guests 表）映射：id + name + intro（脚本引用 guestId；intro 注入润色提示词） */
  guestsByPlatform: Record<string, { id: string; name: string; intro: string | null }>;
  /** 编辑保存（归属校验） */
  getOwnedTranscript(id: string, userId: string): Promise<{ id: string } | null>;
  updateTranscriptSegments(id: string, segments: ScriptSegment[]): Promise<void>;
  llm: LlmClient;
}

export function transcriptsRoutes(deps: TranscriptsDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();

  app.post("/v1/transcripts/new", async (c) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as {
      polishId?: unknown; instruction?: unknown; hostName?: unknown;
      persona?: { callName?: unknown; traits?: unknown } | null;
    } | null;
    if (!body || typeof body.polishId !== "string") {
      return c.json({ error: "invalid_polish" }, 400);
    }
    const instruction =
      typeof body.instruction === "string" && body.instruction.trim().length > 0
        ? body.instruction.trim().slice(0, 100)
        : null;

    // 润色上限（在 LLM 调用前拦截，省成本）
    const limit = await deps.getPolishLimit(userId);
    if (limit !== null) {
      const count = await deps.getTranscriptCount(body.polishId);
      if (count >= limit) {
        return c.json(
          { error: "polish_limit_reached", detail: `每个对话最多生成 ${limit} 条润色脚本` },
          429,
        );
      }
    }

    const dialogue = await deps.getDialogueForPolish(body.polishId, userId).catch(() => null);
    if (!dialogue || dialogue.messages.length === 0) return c.json({ error: "no_dialogue" }, 404);

    // 称呼：persona.callName 优先（前端人设卡）；旧 hostName 字段兜底。AI 从 guests 表按平台取（id 引用 + name 快照）
    const p = body.persona;
    const callName = p && typeof p.callName === "string" && p.callName.trim() ? p.callName.trim().slice(0, 20) : null;
    const hostName = callName ?? (typeof body.hostName === "string" && body.hostName.trim() ? body.hostName.trim().slice(0, 20) : null);
    // 人设拼文本注入提示词（仅本次生效）：称呼 + 性格画像（用户指定风格，生成时遵循）
    const traits = p && typeof p.traits === "string" && p.traits.trim() ? p.traits.trim().slice(0, 100) : null;
    const personaText = callName || traits
      ? [callName ? `称呼：${callName}` : null, traits ? `性格：${traits}` : null].filter(Boolean).join("；")
      : "";
    const aiGuest = deps.guestsByPlatform?.[dialogue.platform];

    // 语言由 LLM 随润色识别（跟随原对话语言）；多主题切分 → 每条脚本一个 transcript
    return streamSSE(c, async (stream) => {
      let full = "";
      try {
        const result = await deps.llm.stream(
          polishPrompt(dialogue.messages, instruction, { hostName, aiName: aiGuest?.name ?? null, aiIntro: aiGuest?.intro ?? null, hostPersona: personaText || null }),
          (delta: string) => {
            full += delta;
            void stream.writeSSE({ event: "segment", data: delta });
          },
        );
        full = result || full;
        const parsed = parseJsonLoose(full) as
          | { language?: unknown; scripts?: unknown; quality_failed?: unknown; reason?: unknown }
          | ScriptSegment[]
          | null;

        // 质量不合格：无主题可拆分 → 前端直接反馈（不落库）
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed as { quality_failed?: unknown }).quality_failed) {
          await stream.writeSSE({
            event: "quality_failed",
            data: JSON.stringify({ reason: (parsed as { reason?: unknown }).reason ?? "" }),
          });
          return;
        }

        // 新结构 { language, scripts: [{topic, segments}] }；兼容旧输出（数组 / {language, segments}）
        let language = "zh";
        const scripts: { topic: string | null; title: string | null; creationNote: string | null; segments: ScriptSegment[] }[] = [];
        if (Array.isArray(parsed)) {
          scripts.push({ topic: null, title: null, creationNote: null, segments: parsed as ScriptSegment[] });
        } else if (parsed && Array.isArray((parsed as { scripts?: unknown }).scripts)) {
          if (typeof (parsed as { language?: unknown }).language === "string" && /^[a-zA-Z]{2,3}$/.test((parsed as { language: string }).language)) {
            language = (parsed as { language: string }).language.toLowerCase();
          }
          for (const s of (parsed as { scripts: { topic?: unknown; title?: unknown; creationNote?: unknown; segments?: unknown }[] }).scripts) {
            if (Array.isArray(s.segments)) {
              scripts.push({
                topic: typeof s.topic === "string" && s.topic.trim() ? s.topic.trim().slice(0, 60) : null,
                title: typeof s.title === "string" && s.title.trim() ? s.title.trim().slice(0, 120) : null,
                creationNote: typeof s.creationNote === "string" && s.creationNote.trim() ? s.creationNote.trim().slice(0, 500) : null,
                segments: s.segments as ScriptSegment[],
              });
            }
          }
        } else if (parsed && Array.isArray((parsed as { segments?: unknown }).segments)) {
          scripts.push({ topic: null, title: null, creationNote: null, segments: (parsed as { segments: ScriptSegment[] }).segments });
        }
        if (scripts.length === 0) throw new Error("polish_output_invalid");

        // 多主题：每条脚本独立落库（各带 topic）
        const saved: { id: string }[] = [];
        for (const script of scripts) {
          saved.push(await deps.createTranscript(body.polishId as string, script.segments, language, {
            topic: script.topic,
            title: script.title,
            creationNote: script.creationNote,
            hostName,
            ...(aiGuest ? { guestId: aiGuest.id, guestName: aiGuest.name } : {}),
          }));
        }
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            transcriptIds: saved.map((s) => s.id),
            count: saved.length,
            // 每条脚本的元数据（title/creationNote/topic）——前端直接展示，无需再查详情
            transcripts: scripts.map((script, i) => ({
              id: saved[i].id,
              title: script.title,
              creationNote: script.creationNote,
              topic: script.topic,
            })),
          }),
        });
      } catch (e) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: String(e instanceof Error ? e.message : e) }) });
      }
    });
  });

  /** 编辑保存 transcript 脚本 */
  app.put("/v1/transcripts/:id", async (c) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as { segments?: unknown } | null;
    if (!Array.isArray(body?.segments) || !body.segments.every((seg: ScriptSegment) =>
      (seg.speaker === "host" || seg.speaker === "guest") && typeof seg.text === "string")) {
      return c.json({ error: "invalid_script" }, 400);
    }
    const owned = await deps.getOwnedTranscript(c.req.param("id"), userId);
    if (!owned) return c.json({ error: "not_found" }, 404);
    await deps.updateTranscriptSegments(c.req.param("id"), body.segments as ScriptSegment[]);
    return c.json({ ok: true });
  });

  return app;
}
