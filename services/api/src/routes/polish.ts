import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { LlmClient } from "../llm/client";
import { polishPrompt, parseJsonLoose, type QualityResult } from "../llm/prompts";

export interface ScriptSegment { speaker: "host" | "guest"; text: string; }

export interface PolishDeps {
  /** 来源：imports.parsed_dialogue（通过 episodes.import_id 关联），userId 强制归属过滤（防 IDOR）；null/空 → 404 */
  getDialogueMessages(episodeId: string, userId: string): Promise<{ role: string; content: string }[] | null>;
  qualityCheck(messages: { role: string; content: string }[]): Promise<QualityResult>;
  savePolished(episodeId: string, language: string, segments: ScriptSegment[]): Promise<{ version: number; segments: ScriptSegment[] }>;
  llm: LlmClient;
  /** 对话级润色计数（仅计 LLM 润色保存） */
  getPolishCount(episodeId: string): Promise<number>;
  /** 对话级润色上限：null = 不限（pro）；free = 5 版（配置化） */
  getPolishLimit(userId: string): Promise<number | null>;
}

export function polishRoutes(deps: PolishDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();
  // 注意：路径自带 /api 前缀（与 polish.test.ts 直接对裸 app 请求 /api/... 一致），
  // 挂载时用 app.route("/", polishRoutes(...))，避免前缀重复
  app.post("/api/episodes/:id/polish", async (c) => {
    const episodeId = c.req.param("id");
    const userId = c.get("userId") as string;
    // 润色方向指示（可选，≤100 字）：重新润色时用户可附一句调整方向，拼入 prompt
    const body = await c.req.json().catch(() => null);
    const instruction =
      typeof body?.instruction === "string" && body.instruction.trim().length > 0
        ? body.instruction.trim().slice(0, 100)
        : null;
    // 对话级润色上限（防滥用，在质量门/LLM 调用前拦截，省成本）
    const limit = await deps.getPolishLimit(userId);
    if (limit !== null) {
      const count = await deps.getPolishCount(episodeId);
      if (count >= limit) {
        return c.json(
          { error: "polish_limit_reached", detail: `每个对话最多生成 ${limit} 个脚本版本` },
          429,
        );
      }
    }
    const messages = await deps.getDialogueMessages(episodeId, userId).catch(() => null);
    if (!messages || messages.length === 0) return c.json({ error: "no_dialogue" }, 404);
    const quality = await deps.qualityCheck(messages);
    if (!quality.pass) return c.json({ error: "quality_rejected", reason: quality.reason }, 422);
    const language = quality.language ?? "zh";
    return streamSSE(c, async (stream) => {
      let full = "";
      try {
        const result = await deps.llm.stream(polishPrompt(messages, language, instruction), (delta) => {
          full += delta;
          void stream.writeSSE({ event: "segment", data: delta });
        });
        full = result || full;
        const parsed = parseJsonLoose(full) as ScriptSegment[];
        if (!Array.isArray(parsed)) throw new Error("polish_output_invalid");
        const saved = await deps.savePolished(episodeId, language, parsed);
        await stream.writeSSE({ event: "done", data: JSON.stringify({ version: saved.version }) });
      } catch (e) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: String(e instanceof Error ? e.message : e) }) });
      }
    });
  });
  return app;
}
