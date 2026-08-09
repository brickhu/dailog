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
  /** polish 归属校验 + 快照对话（经 snapshot.parsedDialogue） */
  getDialogueForPolish(polishId: string, userId: string): Promise<{ role: string; content: string }[] | null>;
  /** 润色计数（transcripts 数量） */
  getTranscriptCount(polishId: string): Promise<number>;
  /** 润色上限：null = 不限（pro）；free = 5 条 */
  getPolishLimit(userId: string): Promise<number | null>;
  createTranscript(polishId: string, segments: ScriptSegment[], language: string | null): Promise<{ id: string }>;
  /** 编辑保存（归属校验） */
  getOwnedTranscript(id: string, userId: string): Promise<{ id: string } | null>;
  updateTranscriptSegments(id: string, segments: ScriptSegment[]): Promise<void>;
  llm: LlmClient;
}

export function transcriptsRoutes(deps: TranscriptsDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();

  app.post("/api/transcripts/new", async (c) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as { polishId?: unknown; instruction?: unknown } | null;
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

    const messages = await deps.getDialogueForPolish(body.polishId, userId).catch(() => null);
    if (!messages || messages.length === 0) return c.json({ error: "no_dialogue" }, 404);

    // 语言由 LLM 随润色识别（跟随原对话语言）；解析失败兜底默认 zh
    return streamSSE(c, async (stream) => {
      let full = "";
      try {
        const result = await deps.llm.stream(polishPrompt(messages, instruction), (delta: string) => {
          full += delta;
          void stream.writeSSE({ event: "segment", data: delta });
        });
        full = result || full;
        // 新结构 { language, segments }；兼容旧版数组输出（缺 language → 默认 zh）
        const parsed = parseJsonLoose(full) as { language?: unknown; segments?: unknown } | ScriptSegment[];
        let segments: ScriptSegment[];
        let language: string | null = "zh";
        if (Array.isArray(parsed)) {
          segments = parsed;
        } else if (Array.isArray(parsed?.segments)) {
          segments = parsed.segments;
          if (typeof parsed.language === "string" && /^[a-zA-Z]{2,3}$/.test(parsed.language)) {
            language = parsed.language.toLowerCase();
          }
        } else {
          throw new Error("polish_output_invalid");
        }
        const saved = await deps.createTranscript(body.polishId as string, segments, language);
        await stream.writeSSE({ event: "done", data: JSON.stringify({ transcriptId: saved.id }) });
      } catch (e) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: String(e instanceof Error ? e.message : e) }) });
      }
    });
  });

  /** 编辑保存 transcript 脚本 */
  app.put("/api/transcripts/:id", async (c) => {
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
