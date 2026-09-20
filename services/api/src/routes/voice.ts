import { createRoute, OpenAPIHono, z, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AudioStorage } from "../storage";

/** 声音采样行（voice_samples：**主持人 + 嘉宾共用一张表**，owner 二选一） */
export interface VoiceSampleRow {
  id?: string;          // 仅 GET 回读填充（前端 sampleId）
  language: string;     // 采样语种（一个身份多语种各一条）
  /** owner：主持人 = profiles.id（user.id）；嘉宾 = guests.id。恰好一个非空 */
  userId?: string | null;
  guestId?: string | null;
  /** 参考音频 storage key；draft 行（只有称呼、还没录音）为 null */
  audioUrl?: string | null;
  /** 参考音频转录文本（用户朗读的固定文案；零样本克隆用） */
  transcript?: string | null;
  duration?: number;
  /** 该语种节目中的称呼（主持人 = 自己的节目称呼；嘉宾 = 嘉宾名） */
  callName?: string | null;
  /** draft = 只有称呼还没录音 / ready = 可用 / failed = 录制失败 */
  status?: "draft" | "ready" | "failed";
  createdAt?: Date;   // 仅 GET 回读填充
}

export interface VoiceDeps {
  /** 保存采样（owner × language upsert）；返回 id（投稿时记录 voiceSampleId 用） */
  saveVoiceSample(row: VoiceSampleRow): Promise<{ id: string }>;
  /** 只更新该语种采样的「节目称呼」（无该行则建 draft 行：只有称呼还没录音） */
  setCallName?(userId: string, language: string, callName: string | null): Promise<void>;
  /** 工作台回读样本（onboarding 守卫/设置页）：language 给定时取该语种那条（投稿区采样），否则取最新一条 */
  getVoiceSample?(userId: string, language?: string | null): Promise<VoiceSampleRow | null>;
  storage: AudioStorage;
}

// 自带 /api 前缀（与 polish/generate/job 路由一致，见 app.ts 挂载说明）：测试对裸 app 请求 /api/...
// 样本直传模式：上传只保存录音文件，不训练音色模型；生成时由 TTS 管线以 referenceAudio 零样本方式使用
/** ?language=xx —— 取指定语种的采样（投稿区采样回读：中文区取 zh、English 区取 en）；非法/缺失 → 取最新一条 */
function sampleLanguage(c: Context): string | null {
  const raw = c.req.query("language");
  return typeof raw === "string" && /^[a-z]{2,3}$/i.test(raw) ? raw.toLowerCase() : null;
}

export function voiceRoutes(deps: VoiceDeps) {
  const app = new OpenAPIHono<{ Variables: { userId: string } }>();
  const Err = z.object({ error: z.string() });

  const r1 = createRoute({
    method: "get",
    path: "/v1/me/voice-sample",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/me/voice-sample" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r1, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const row = await deps.getVoiceSample?.(userId, sampleLanguage(c));
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({
      id: row.id ?? null,
      language: row.language,
      status: row.status,
      duration: row.duration,
      transcript: row.transcript,
      /** 该语种节目中的称呼（callNameInEpisode 默认值） */
      callName: row.callName ?? null,
      createdAt: row.createdAt,
    });
  }) as unknown as RouteHandler<typeof r1, { Variables: { userId: string } }>);

  /** 采样音频流（设置页播放用）：读 storage key 返回 webm */
  const r2 = createRoute({
    method: "get",
    path: "/v1/me/voice-sample/audio",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/me/voice-sample/audio" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r2, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const row = await deps.getVoiceSample?.(userId, sampleLanguage(c));
    // draft 行（只有称呼、还没录音）不算有音频
    if (!row?.audioUrl || row.status !== "ready") return c.json({ error: "not_found" }, 404);
    const { data: bytes } = await deps.storage.get(row.audioUrl);
    if (!bytes) return c.json({ error: "not_found" }, 404);
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "audio/webm",
        // 采样是「私有 + 可被覆盖」的资源（重新录制写同一个 R2 key）：
        // 允许缓存会让重新录制后仍听到旧音频——不缓存，每次取最新
        "Cache-Control": "private, no-store",
      },
    });
  }) as unknown as RouteHandler<typeof r2, { Variables: { userId: string } }>);

  const r3 = createRoute({
    method: "post",
    path: "/v1/me/voice-sample",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/me/voice-sample" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r3, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) return c.json({ error: "file_required" }, 400);
    // 转录文本（用户朗读的固定文案，前端随上传提交；零样本克隆质量依赖它）
    const transcript = typeof form?.get("transcript") === "string" ? (form.get("transcript") as string).trim() || null : null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    // 采样语种（form 字段，前端按界面语言显式传：文案语言=采样语言；缺省 zh）——一人多语种各一条
    const language = typeof form?.get("language") === "string" && /^[a-z]{2,3}$/i.test(form.get("language") as string)
      ? (form.get("language") as string).toLowerCase()
      : "zh";
    // 录音时长（前端计时秒数；仅作展示「XX秒XX语采样」，TTS 不依赖）
    const durationRaw = form?.get("duration");
    let duration = 0;
    if (typeof durationRaw === "string" && /^\d{1,4}(\.\d{1,3})?$/.test(durationRaw)) {
      const n = Number(durationRaw);
      if (Number.isFinite(n) && n >= 0 && n <= 3600) duration = Math.round(n);
    }
    // R2 目录规划：voices/{userId}/{language}.webm
    const key = `voices/${userId}/${language}.webm`;
    await deps.storage.put(key, bytes);
    // 节目称呼（设置页卡片随录音一并提交；未提交 → 保留原值不改）
    const callNameRaw = form?.get("callName");
    const callName = typeof callNameRaw === "string" ? (callNameRaw.trim().slice(0, 20) || null) : undefined;
    const saved = await deps.saveVoiceSample({
      userId, language, audioUrl: key, transcript, duration, status: "ready",
      ...(callName !== undefined ? { callName } : {}),
    });
    return c.json({ ok: true, sampleId: saved.id }); // sampleId：投稿时记录 voiceSampleId 用
  }) as unknown as RouteHandler<typeof r3, { Variables: { userId: string } }>);

  /** 节目称呼单独保存（设置页语言区卡片）：只写 call_name；无该语种采样行 → 建 draft 行 */
  const r4 = createRoute({
    method: "patch",
    path: "/v1/me/voice-sample",
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/me/voice-sample" },
      400: { content: { "application/json": { schema: Err } }, description: "参数非法" },
    },
  });
  app.openapi(r4, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as { language?: unknown; callName?: unknown } | null;
    const language = typeof body?.language === "string" && /^[a-z]{2,3}$/i.test(body.language.trim())
      ? body.language.trim().toLowerCase()
      : "";
    if (!language) return c.json({ error: "invalid_language", detail: "缺少或非法的采样语种" }, 400);
    const callName = typeof body?.callName === "string" ? (body.callName.trim().slice(0, 20) || null) : null;
    await deps.setCallName?.(userId, language, callName);
    return c.json({ ok: true, language, callName });
  }) as unknown as RouteHandler<typeof r4, { Variables: { userId: string } }>);

  return app;
}
