// 编辑端路由（本质版，2026-08-13）：/v1/editor/* —— requireRole(editor|admin) 守卫统一施加。
// 编辑工作流在本地 Agent（skill）完成：拉取待审队列 → 本地拉取网页/生成脚本/TTS/合成
// → 一次性上传成品（multipart：音频 + 封面 + 元数据）→ episode 直接 published + 通知投稿人。
// 服务端只有 4 个动作：队列 / 详情 / 拒审 / 发布；无 LLM、无生成管线。

import { createRoute, OpenAPIHono, z, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import { requireRole, type AuthEnv } from "../middleware/auth";
import type { Repos } from "../repo";
import type { AudioStorage } from "../storage";
import { sendEmail } from "../email/resend";
import type { Env } from "../config/env";

export interface EditorDeps {
  repo: Repos;
  env: Env;
  /** 成品音频与封面存储（R2/fs） */
  storage: AudioStorage;
  /** 消费站基址（节目 URL /episode/{id} 拼全链接用；未配置 → 通知里不带链接） */
  siteBaseUrl?: string | null;
}

/** 发布 multipart 元数据（meta 字段 JSON） */
interface PublishMeta {
  title?: string;
  description?: string;
  tags?: string[];
  language?: string;
  guestId?: string;
  durationSeconds?: number;
  /** 无情绪标签的完整台本（节目页展示用；可选） */
  transcript?: string;
}

// 成品音频大小上限（100MB——单期 5-10 分钟 MP3 远小于此，纯防滥用）
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

export function editorRoutes(deps: EditorDeps) {
  const app = new OpenAPIHono<AuthEnv>();
  const Err = z.object({ error: z.string() });
  app.use("/v1/editor/*", requireRole("editor"));

  // ---- 投稿队列 / 详情 ----

  /** 待审队列：?status=submitted|rejected|published（缺省 submitted，先到先审） */
  const r1 = createRoute({
    method: "get",
    path: "/v1/editor/submissions",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/editor/submissions" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r1, (async (c: Context) => {
    const raw = c.req.query("status");
    const status = raw === "rejected" || raw === "published" ? raw : "submitted";
    const list = await deps.repo.submissions.listQueue(status);
    return c.json(list);
  }) as unknown as RouteHandler<typeof r1, AuthEnv>);

  /** 投稿详情：URL + 投稿人 + 声音采样（transcript 供本地 TTS 克隆）+ 已上线节目 */
  const r2 = createRoute({
    method: "get",
    path: "/v1/editor/submissions/:id",
      responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/editor/submissions/:id" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r2, (async (c: Context) => {
    const detail = await deps.repo.submissions.getDetail(c.req.param("id")!);
    if (!detail) return c.json({ error: "not_found" }, 404);
    const episodes = await deps.repo.episodes.listBySubmission(detail.id);
    return c.json({ ...detail, episodes });
  }) as unknown as RouteHandler<typeof r2, AuthEnv>);

  // ---- 拒审 ----

  /** 人工拒审（reason 必填）→ rejected + 站内通知 + 邮件 */
  const r3 = createRoute({
    method: "post",
    path: "/v1/editor/submissions/:id/reject",
      responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/editor/submissions/:id/reject" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r3, (async (c: Context) => {
    const id = c.req.param("id")!;
    const detail = await deps.repo.submissions.getDetail(id);
    if (!detail) return c.json({ error: "not_found" }, 404);
    if (detail.status !== "submitted") {
      return c.json({ error: "invalid_state", detail: "仅待审核投稿可拒审" }, 409);
    }
    const body = (await c.req.json().catch(() => null)) as { reason?: unknown } | null;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason) return c.json({ error: "reason_required", detail: "请填写拒审原因" }, 400);
    if (reason.length > 500) return c.json({ error: "reason_too_long" }, 400);

    await deps.repo.submissions.reject(id, reason);
    const notify = await deps.repo.notifications.create({
      userId: detail.userId,
      type: "rejected",
      title: "投稿未通过",
      body: reason,
      link: "/me/submits",
    }).catch(() => {});
    if (notify === undefined) void notify; // 通知失败不阻塞拒审（静默）
    // 邮件通知（RESEND 未配置时静默跳过）
    await sendEmail(deps.env, {
      to: detail.userEmail,
      subject: "dailog：你的投稿未通过",
      html: `<p>你好 ${detail.personaInfo?.displayName ?? detail.userEmail}，</p><p>很遗憾，你的投稿未能通过编辑审核：</p><blockquote>${escapeHtml(reason)}</blockquote><p>投稿链接：<a href="${escapeHtml(detail.url)}">${escapeHtml(detail.url)}</a></p><p>你可以在 <a href="${deps.siteBaseUrl ?? ""}/me/submits">投稿状态页</a> 查看。</p>`,
    }).catch(() => {});
    return c.json({ ok: true, status: "rejected" });
  }) as unknown as RouteHandler<typeof r3, AuthEnv>);

  // ---- 发布（编辑本地制作成品后一次性上传） ----

  /** 一次性上传发布：multipart（audio 文件 + 可选 cover 文件 + meta JSON 字段）
   *  → 音频/封面存 R2 → episode 创建（published，期号 max+1）→ 投稿状态 published → 通知投稿人 */
  const r4 = createRoute({
    method: "post",
    path: "/v1/editor/submissions/:id/publish",
      responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/editor/submissions/:id/publish" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r4, (async (c: Context) => {
    const id = c.req.param("id")!;
    const detail = await deps.repo.submissions.getDetail(id);
    if (!detail) return c.json({ error: "not_found" }, 404);
    if (detail.status !== "submitted") {
      return c.json({ error: "invalid_state", detail: `该投稿当前状态为 ${detail.status}，无法发布` }, 409);
    }

    const form = await c.req.formData().catch(() => null);
    const audioFile = form?.get("audio");
    if (!(audioFile instanceof File) || audioFile.size === 0) {
      return c.json({ error: "audio_required", detail: "缺少成品音频文件（multipart 字段 audio）" }, 400);
    }
    if (audioFile.size > MAX_AUDIO_BYTES) {
      return c.json({ error: "audio_too_large", detail: "音频超过 100MB 上限" }, 400);
    }
    let meta: PublishMeta = {};
    const rawMeta = typeof form?.get("meta") === "string" ? (form.get("meta") as string) : null;
    if (rawMeta) {
      try {
        meta = JSON.parse(rawMeta) as PublishMeta;
      } catch {
        return c.json({ error: "invalid_meta", detail: "meta 字段不是合法 JSON" }, 400);
      }
    }
    const title = typeof meta.title === "string" && meta.title.trim() ? meta.title.trim().slice(0, 200) : null;
    const description = typeof meta.description === "string" && meta.description.trim() ? meta.description.trim().slice(0, 2000) : null;
    const language = typeof meta.language === "string" && /^[a-z]{2,3}$/i.test(meta.language) ? meta.language.toLowerCase() : "zh";
    const tags = Array.isArray(meta.tags)
      ? meta.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim().slice(0, 30)).slice(0, 10)
      : null;
    const guestId = typeof meta.guestId === "string" && meta.guestId ? meta.guestId : undefined;
    const durationSeconds = typeof meta.durationSeconds === "number" && Number.isFinite(meta.durationSeconds) && meta.durationSeconds > 0
      ? Math.round(meta.durationSeconds)
      : null;
    // 无情绪标签的完整台本（节目页展示用；可选）
    const transcript = typeof meta.transcript === "string" && meta.transcript.trim() ? meta.transcript.trim().slice(0, 50000) : null;

    // 音频落 R2（R2 目录规划：episodes/{userId}/{submissionId}.{ext}——ext 按上传格式 mp3/m4a，
    // 决定 Content-Type 与 RSS enclosure type）
    const ext = /\.(mp3|m4a)$/i.test(audioFile.name) ? audioFile.name.toLowerCase().split(".").pop() : "mp3";
    const audioKey = `episodes/${detail.userId}/${id}.${ext}`;
    await deps.storage.put(audioKey, new Uint8Array(await audioFile.arrayBuffer()));

    // 封面可选：cover 文件 → covers/{submissionId}.jpg（无封面 → null，播放页自适应）
    let coverUrl: string | null = null;
    const coverFile = form?.get("cover");
    if (coverFile instanceof File && coverFile.size > 0) {
      if (coverFile.size > 5 * 1024 * 1024) {
        return c.json({ error: "cover_too_large", detail: "封面超过 5MB 上限" }, 400);
      }
      coverUrl = `covers/${id}.jpg`;
      await deps.storage.put(coverUrl, new Uint8Array(await coverFile.arrayBuffer()));
    }

    // 创建节目（published + 期号）+ 投稿状态流转，同事务
    // rawConversationUrl 服务端自动填投稿链接（节目页「原始对话」跳转用）
    const created = await deps.repo.episodes.createPublished({
      submissionId: id,
      userId: detail.userId,
      profileId: detail.userId,
      guestId,
      title,
      description,
      coverUrl,
      audioUrl: audioKey,
      audioSize: audioFile.size,
      durationSeconds,
      language,
      tags,
      transcript,
      rawConversationUrl: detail.url,
    });
    await deps.repo.submissions.markPublished(id);

    // 站内通知 + 邮件（「dailog 第 N 期」）——链接用 slug（人类可读、SEO 友好）
    const episodeTitle = title ?? `dailog 第 ${created.number} 期`;
    const link = `/episode/${created.slug}`;
    await deps.repo.notifications.create({
      userId: detail.userId,
      type: "published",
      title: `dailog 第 ${created.number} 期「${episodeTitle}」已上线`,
      body: "你的对话已被制作成节目，去听听吧",
      link,
    }).catch(() => {});
    await sendEmail(deps.env, {
      to: detail.userEmail,
      subject: `dailog 第 ${created.number} 期「${episodeTitle}」已上线`,
      html: `<p>你好 ${detail.personaInfo?.displayName ?? detail.userEmail}，</p><p>你的投稿已发布为 <strong>dailog 第 ${created.number} 期「${escapeHtml(episodeTitle)}」</strong>！</p><p><a href="${deps.siteBaseUrl ?? ""}${link}">立即收听</a></p>`,
    }).catch(() => {});

    return c.json({ episodeId: created.id, slug: created.slug, number: created.number, status: "published" }, 201);
  }) as unknown as RouteHandler<typeof r4, AuthEnv>);

  // ---- 已发布节目（编辑本地查看/微调） ----

  /** 已发布节目清单（按期号倒序） */
  const r5 = createRoute({
    method: "get",
    path: "/v1/editor/episodes",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/editor/episodes" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r5, (async (c: Context) => {
    const list = await deps.repo.episodes.listPublished();
    return c.json(list);
  }) as unknown as RouteHandler<typeof r5, AuthEnv>);

  /** 已发布节目编辑：tags / 精选 / 标题 / 简介 / 封面 */
  const r6 = createRoute({
    method: "put",
    path: "/v1/editor/episodes/:id",
      responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/editor/episodes/:id" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r6, (async (c: Context) => {
    const ep = await deps.repo.episodes.getById(c.req.param("id")!);
    if (!ep) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => null)) as {
      tags?: unknown; isPicked?: unknown; title?: unknown; description?: unknown; coverUrl?: unknown;
    } | null;
    if (!body) return c.json({ error: "invalid_body" }, 400);
    const patch: { tags?: string[] | null; isPicked?: boolean; title?: string | null; description?: string | null; coverUrl?: string | null } = {};
    if (Array.isArray(body.tags)) patch.tags = body.tags.filter((t): t is string => typeof t === "string");
    if (typeof body.isPicked === "boolean") patch.isPicked = body.isPicked;
    if (typeof body.title === "string") patch.title = body.title.slice(0, 200);
    if (typeof body.description === "string") patch.description = body.description.slice(0, 2000);
    if (typeof body.coverUrl === "string") patch.coverUrl = body.coverUrl;
    await deps.repo.episodes.updatePublished(ep.id, patch);
    return c.json({ ok: true });
  }) as unknown as RouteHandler<typeof r6, AuthEnv>);

  // ---- 嘉宾库（品牌声线宿主，编辑本地 TTS 用） ----

  /** 嘉宾列表（id/name/avatar/intro/url） */
  const r7 = createRoute({
    method: "get",
    path: "/v1/editor/guests",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/editor/guests" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r7, (async (c: Context) => {
    const list = await deps.repo.guests.list();
    return c.json(list);
  }) as unknown as RouteHandler<typeof r7, AuthEnv>);

  /** 嘉宾声线清单（管理查看：guestId/language/transcript/audioKey） */
  const r8 = createRoute({
    method: "get",
    path: "/v1/editor/guests/voice-samples",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/editor/guests/voice-samples" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r8, (async (c: Context) => {
    const list = await deps.repo.guests.listVoiceSamples();
    return c.json(list);
  }) as unknown as RouteHandler<typeof r8, AuthEnv>);

  /** 更新嘉宾称呼/简介（节目中的称呼——服务端配置） */
  const r9 = createRoute({
    method: "put",
    path: "/v1/editor/guests/:id",
      responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/editor/guests/:id" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r9, (async (c: Context) => {
    const id = c.req.param("id")!;
    const body = (await c.req.json().catch(() => null)) as { name?: unknown; intro?: unknown } | null;
    if (!body) return c.json({ error: "invalid_body" }, 400);
    const patch: { name?: string; intro?: string | null } = {};
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 50);
    if (typeof body.intro === "string") patch.intro = body.intro.trim().slice(0, 300) || null;
    if (Object.keys(patch).length === 0) return c.json({ error: "nothing_to_update" }, 400);
    await deps.repo.guests.update(id, patch);
    return c.json({ ok: true });
  }) as unknown as RouteHandler<typeof r9, AuthEnv>);

  /** 上传嘉宾声线（multipart：audio 文件 + language + transcript）→ R2 + guest_voice_samples（服务端配置） */
  const r10 = createRoute({
    method: "post",
    path: "/v1/editor/guests/:id/voice-sample",
      responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/editor/guests/:id/voice-sample" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r10, (async (c: Context) => {
    const guestId = c.req.param("id")!;
    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: "invalid_body" }, 400);
    const file = form.get("audio");
    if (!(file instanceof File) || file.size === 0) return c.json({ error: "audio_required" }, 400);
    if (file.size > 20 * 1024 * 1024) return c.json({ error: "audio_too_large" }, 400);
    const language = typeof form.get("language") === "string" && /^[a-z]{2,3}$/i.test(form.get("language") as string)
      ? (form.get("language") as string).toLowerCase()
      : "zh";
    const transcript = typeof form.get("transcript") === "string" && (form.get("transcript") as string).trim()
      ? (form.get("transcript") as string).trim().slice(0, 500)
      : null;
    // R2：guests/{guestId}/{language}.mp3（guest×language 唯一 upsert）
    const audioKey = `guests/${guestId}/${language}.mp3`;
    await deps.storage.put(audioKey, new Uint8Array(await file.arrayBuffer()));
    await deps.repo.guests.upsertVoiceSample({ guestId, language, audioKey, transcript });
    return c.json({ ok: true, guestId, language });
  }) as unknown as RouteHandler<typeof r10, AuthEnv>);

  /** 嘉宾采样音频（品牌声线参考音频，编辑本地 TTS 下载用） */
  const r11 = createRoute({
    method: "get",
    path: "/v1/editor/samples/guest/:guestId/audio",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/editor/samples/guest/:guestId/audio" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r11, (async (c: Context) => {
    const sample = await deps.repo.guests.voiceSampleAny(c.req.param("guestId")!);
    if (!sample) return c.json({ error: "not_found" }, 404);
    const bytes = await deps.storage.get(sample.audioKey).then((r) => r.data).catch(() => null);
    if (!bytes) return c.json({ error: "not_found" }, 404);
    return new Response(bytes as unknown as BodyInit, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=300" },
    });
  }) as unknown as RouteHandler<typeof r11, AuthEnv>);

  /** 投稿人采样音频（主持人克隆音色参考，编辑本地 TTS 下载用） */
  const r12 = createRoute({
    method: "get",
    path: "/v1/editor/samples/host/:userId/audio",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/editor/samples/host/:userId/audio" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r12, (async (c: Context) => {
    const sample = await deps.repo.episodes.getVoiceSample(c.req.param("userId")!);
    if (!sample) return c.json({ error: "not_found" }, 404);
    const bytes = await deps.storage.get(sample.audioUrl).then((r) => r.data).catch(() => null);
    if (!bytes) return c.json({ error: "not_found" }, 404);
    return new Response(bytes as unknown as BodyInit, {
      headers: { "Content-Type": "audio/webm", "Cache-Control": "private, max-age=300" },
    });
  }) as unknown as RouteHandler<typeof r12, AuthEnv>);

  return app;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}
