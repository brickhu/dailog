// 编辑端路由（P2）：/v1/editor/* —— requireRole(editor|admin) 守卫在本路由内部统一施加
// 流程：queue（待审批 inbox，先到先审）→ reviews/:id（审核+润色 → 脚本候选 1–N 版）
//       → 生成（episodes/new，完成后 status=ready）→ 发布确认（元数据 LLM 预填 + 期号分配 + 封面）
// 状态机：polishes: submitted → accepted / rejected；episodes: generating → ready → published

import { Hono } from "hono";
import { spawn } from "node:child_process";
import type { LlmClient } from "../llm/client";
import { polishPrompt, safetyMetaPrompt, parseJsonLoose } from "../llm/prompts";
import { requireRole, type AuthEnv } from "../middleware/auth";
import { segmentsToSubtitle } from "../lib/script-text";
import type { Repos } from "../repo";
import * as schema from "../db/schema";
import type { ScriptSegment } from "./episodes";

export interface EditorDeps {
  repo: Repos;
  llm: LlmClient;
  /** 平台 → 嘉宾映射（id/name/intro）——润色提示词注入 */
  guestsByPlatform: Record<string, { id: string; name: string; intro: string | null }>;
  /** 生成前内容安全审核（最终脚本）——品牌命门 */
  safetyCheck(segments: ScriptSegment[]): Promise<{ pass: boolean; reason?: string; title?: string; description?: string; tags?: string[]; topic?: string }>;
  createJob(episodeId: string): Promise<{ id: string; episodeId: string; status: string; progress: number }>;
  enqueueJob(job: { id: string; episodeId: string }): Promise<void>;
  getLatestJob(episodeId: string): Promise<{ id: string; status: string; progress: number; error: string | null } | null>;
  /** Pexels API key（封面图库搜索；未配置 → cover-search 503，发布用模板/占位） */
  pexelsApiKey?: string | null;
  /** 通知邮件发送（RESEND_API_KEY 未配置时静默跳过）——收录/拒绝/上线三类 */
  notifyEmail?(input: { to: string; subject: string; html: string }): Promise<void>;
  /** 封面存储（R2/fs）：publish 时把外链封面下载 resize 后落库 */
  storage?: { get(key: string): Promise<Uint8Array>; put(key: string, bytes: Uint8Array): Promise<void> };
  ffmpegPath?: string;
  /** 消费站基址（节目 URL /episode/{id} 拼全链接用） */
  siteBaseUrl?: string | null;
}

/** 从 profiles.persona 组装润色提示词人设文本（与投稿人端 transcripts 组装一致） */
function personaTextFrom(p: { callName?: string | null; gender?: string | null; profession?: string | null; age?: string | null; traits?: string | null } | null | undefined): { hostName: string | null; text: string } {
  const callName = p?.callName?.trim() ? p.callName.trim().slice(0, 20) : null;
  const parts: string[] = [];
  if (callName) parts.push(`称呼：${callName}`);
  if (p?.gender?.trim()) parts.push(`性别：${p.gender.trim().slice(0, 10)}`);
  if (p?.profession?.trim()) parts.push(`职业：${p.profession.trim().slice(0, 30)}`);
  if (p?.age?.trim()) parts.push(`年龄：${p.age.trim().slice(0, 10)}`);
  if (p?.traits?.trim()) parts.push(`性格：${p.traits.trim().slice(0, 100)}`);
  return { hostName: callName, text: parts.join("；") };
}

/** 润色/追加脚本共用上下文：快照对话 + 主持人（人设）+ AI 嘉宾（平台映射） */
async function polishMeta(deps: EditorDeps, polish: { userId: string; snapshotId: string }) {
  const snapshot = await deps.repo.snapshots.getById(polish.snapshotId);
  const messages = (snapshot?.parsedDialogue ?? []) as { role: string; content: string }[];
  const profile = await deps.repo.episodes.getProfile(polish.userId);
  const { hostName, text: personaText } = personaTextFrom(profile?.persona);
  const aiGuest = deps.guestsByPlatform?.[snapshot?.platform ?? ""];
  return { snapshot, messages, profile, hostName, personaText, aiGuest };
}

export interface ReviewSummary {
  id: string;
  title: string | null;
  /** 摘要（分享页标题） */
  sourceTitle: string | null;
  /** 对话分享页 url */
  snapshotUrl: string | null;
  /** 消息量 */
  msgCount: number;
  /** 总字数 */
  wordCount: number;
  /** 投稿人邮箱 */
  email: string | null;
  platform: string | null;
  language: string | null;
  status: string;
  rejectedReason: string | null;
  /** 拒审来源：llm（自动）/ editor（人工）；null = 旧数据 */
  reviewedBy: "llm" | "editor" | null;
  reviewedAt: Date | null;
  /** 是否已通知投稿人（收录/拒审通知推断） */
  notified: boolean;
  /** 主持人（投稿人）：userId（采样播放用）+ 展示名 + 人设 + 有无声音采样 */
  host: { id: string; name: string | null; persona: schema.HostPersona | null; hasSample: boolean } | null;
  /** AI 嘉宾（按平台）：名字 + 简介 + 有无采样 */
  guest: { id: string; name: string; intro: string | null; hasSample: boolean } | null;
}

/** 审核详情 / 生成任务详情共用的投稿摘要聚合（状态无关，全状态展示） */
async function reviewSummary(deps: EditorDeps, polishId: string): Promise<ReviewSummary | null> {
  const polish = await deps.repo.polishes.getById(polishId);
  if (!polish) return null;
  const snapshot = await deps.repo.snapshots.getById(polish.snapshotId);
  const messages = (snapshot?.parsedDialogue ?? []) as { role: string; content: string }[];
  const [profile, email, transcripts] = await Promise.all([
    deps.repo.episodes.getProfile(polish.userId),
    deps.repo.notifications.getEmailByUserId(polish.userId),
    deps.repo.transcripts.listByPolish(polish.id),
  ]);
  const aiGuest = deps.guestsByPlatform?.[snapshot?.platform ?? ""];
  const guest = aiGuest
    ? {
        id: aiGuest.id,
        name: aiGuest.name,
        intro: aiGuest.intro ?? null,
        hasSample: !!(await deps.repo.guests.voiceSampleAny(aiGuest.id))?.audioKey,
      }
    : null;
  const hostSample = await deps.repo.episodes.getVoiceSample(polish.userId);
  const reviewedAt = polish.reviewedAt;
  const notified = (polish.status === "rejected" || polish.status === "accepted") && reviewedAt
    ? await deps.repo.notifications.existsAfter(polish.userId, polish.status, reviewedAt)
    : false;
  return {
    id: polish.id,
    title: polish.title,
    sourceTitle: snapshot?.sourceTitle ?? null,
    snapshotUrl: snapshot?.url ?? null,
    msgCount: messages.length,
    wordCount: messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0),
    email,
    platform: snapshot?.platform ?? null,
    language: transcripts[0]?.language ?? null,
    status: polish.status,
    rejectedReason: polish.rejectedReason,
    reviewedBy: (polish.reviewedBy as "llm" | "editor" | null) ?? null,
    reviewedAt,
    notified,
    host: {
      id: polish.userId,
      name: profile?.displayName ?? profile?.nickname ?? null,
      persona: profile?.persona ?? null,
      hasSample: !!hostSample?.audioUrl,
    },
    guest,
  };
}



/**
 * 封面标准化（Apple 指南 1400–3000px 正方形）：下载外链图 → ffmpeg 裁剪缩放 1400×1400 JPEG。
 * 失败返回 null（publish 回退无封面/模板）。
 */async function resizeCover(ffmpegPath: string, bytes: Uint8Array): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, [
      "-i", "pipe:0",
      "-vf", "scale=1400:1400:force_original_aspect_ratio=increase,crop=1400:1400",
      "-f", "mjpeg", "-q:v", "3", "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", () => {});
    child.on("error", () => resolve(null));
    child.stdin.on("error", () => resolve(null));
    child.on("close", (code: number) => {
      if (code !== 0 || chunks.length === 0) return resolve(null);
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    child.stdin.write(bytes);
    child.stdin.end();
  });
}

/** 投稿状态变化：站内通知 + 邮件（RESEND 未配静默） */
async function notifySubmission(
  polish: { id: string; userId: string; title: string | null },
  type: "accepted" | "rejected" | "published",
  reason: string | null,
  opts?: { number?: number; episodeId?: string },
): Promise<void> {
  const number = opts?.number;
  const depsCtx = getEditorDeps();
  if (!depsCtx) return;
  const { repo, notifyEmail } = depsCtx;
  const email = await repo.notifications.getEmailByUserId(polish.userId);
  const titleText = polish.title ?? "你的投稿";
  const map = {
    accepted: {
      title: "你的投稿已被收录 🎉",
      body: `「${titleText}」通过了审核，编辑部正在制作——节目上线后会第一时间通知你。`,
      link: "/me/submits",
      subject: `【dailog】你的投稿已被收录：${titleText}`,
    },
    rejected: {
      title: "投稿未通过审核",
      body: `「${titleText}」未通过审核。原因：${reason ?? "内容不符合收录标准"}。你可以修改后重新投稿。`,
      link: "/me/submits",
      subject: `【dailog】投稿未通过：${titleText}`,
    },
    published: {
      title: `你的节目上线了 · 第 ${number} 期 🎧`,
      body: `「${titleText}」已在 dailog 频道播出，快去听听你自己的声音！`,
      link: opts?.episodeId ? `/episode/${opts.episodeId}` : "/",
      subject: `【dailog】你的节目上线了：第 ${number} 期`,
    },
  }[type];
  await repo.notifications.create({
    userId: polish.userId,
    type,
    title: map.title,
    body: map.body,
    link: map.link,
  });
  if (email && notifyEmail) {
    await notifyEmail({ to: email, subject: map.subject, html: `<p>${map.body}</p><p><a href="${map.link}">查看详情</a></p>` }).catch(() => null);
  }
}

let editorDeps: EditorDeps | null = null;
function getEditorDeps() { return editorDeps; }

export function editorRoutes(deps: EditorDeps) {
  editorDeps = deps; // 供 notifySubmission 辅助使用（模块级，单实例）
  const app = new Hono<AuthEnv>();
  // 编辑守卫：认证中间件已在 /v1/* 全局注入 role；本路由仅 editor/admin
  // （限定 /v1/editor/* 前缀——不拦截其他 /v1 未知路由的 404 语义）
  app.use("/v1/editor/*", requireRole("editor"));

  // ---- 队列（待审批 inbox） ----
  app.get("/v1/editor/queue", async (c) => {
    const status = (c.req.query("status") ?? "submitted") as "submitted" | "accepted" | "rejected";
    if (!["submitted", "accepted", "rejected"].includes(status)) return c.json({ error: "invalid_status" }, 400);
    const list = await deps.repo.polishes.listQueue(status);
    return c.json({ status, items: list });
  });

  // ---- 审核详情：投稿摘要 + 对话全文 + 脚本列表 + 最新节目 ----
  app.get("/v1/editor/reviews/:id", async (c) => {
    const polish = await deps.repo.polishes.getById(c.req.param("id"));
    if (!polish) return c.json({ error: "not_found" }, 404);
    const summary = await reviewSummary(deps, polish.id);
    if (!summary) return c.json({ error: "not_found" }, 404);
    const snapshot = await deps.repo.snapshots.getById(polish.snapshotId);
    // 内容溯源：该快照的"前缀源"快照（衍生对话自动检测）——编辑审核时可见来源
    const prefixSource = snapshot?.prefixSourceId
      ? await deps.repo.snapshots.getById(snapshot.prefixSourceId).then((s) => s ? { snapshotId: snapshot.prefixSourceId, sourceTitle: s.sourceTitle } : null)
      : null;
    const transcripts = await deps.repo.transcripts.listByPolish(polish.id);
    const episodes = await deps.repo.episodes.listByPolish(polish.id);
    return c.json({
      ...summary,
      createdAt: polish.createdAt,
      dialogue: {
        platform: snapshot?.platform ?? null,
        sourceTitle: snapshot?.sourceTitle ?? null,
        messages: (snapshot?.parsedDialogue ?? []) as { role: string; content: string }[],
      },
      prefixSource,
      transcripts: transcripts.map((t) => ({
        id: t.id,
        // 有效脚本：编辑保存后的 updated_segments ?? 原始（编辑页/生成共用）
        segments: t.updatedSegments ?? t.segments,
        topic: t.topic,
        title: t.title,
        creationNote: t.creationNote,
        language: t.language,
        createdAt: t.createdAt,
      })),
      episodes: episodes.map((e) => ({
        id: e.id,
        title: e.title,
        status: e.status,
        number: e.number,
        isPicked: e.isPicked,
        createdAt: e.createdAt,
      })),
    });
  });

  // ---- 审核 + 润色（LLM 一次调用：质量审核内联润色，quality_failed → 拒绝） ----
  app.post("/v1/editor/reviews/:id/process", async (c) => {
    const polish = await deps.repo.polishes.getById(c.req.param("id"));
    if (!polish) return c.json({ error: "not_found" }, 404);
    if (polish.status !== "submitted" && polish.status !== "accepted") {
      return c.json({ error: "invalid_status", detail: "仅 submitted/accepted 状态可触发审核润色" }, 409);
    }
    const { messages, hostName, personaText, aiGuest } = await polishMeta(deps, polish);
    if (messages.length === 0) return c.json({ error: "no_dialogue" }, 404);

    // 审核 + 按话题切分润色（非流式——编辑端一次返回全部脚本候选）
    // LLM 超时（90s 上限，client 层 AbortSignal）→ 明确错误而非无限挂起（前端 408 网络超时是模糊信号）
    let raw: string;
    try {
      raw = await deps.llm.complete(polishPrompt(messages, null, {
        hostName,
        aiName: aiGuest?.name ?? null,
        aiIntro: aiGuest?.intro ?? null,
        hostPersona: personaText || null,
      }));
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        return c.json({ error: "llm_timeout", detail: { message: "AI 审核响应超时，请稍后重试" } }, 504);
      }
      throw e;
    }
    const parsed = parseJsonLoose(raw) as
      | { language?: unknown; scripts?: unknown; quality_failed?: unknown; reason?: unknown }
      | ScriptSegment[]
      | null;

    // 质量不合格（无主题可拆分）→ 标记投稿失败（拒审来源 = LLM 自动）
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed as { quality_failed?: unknown }).quality_failed) {
      const reason = String((parsed as { reason?: unknown }).reason ?? "内容未通过审核");
      await deps.repo.polishes.setStatus(polish.id, "rejected", { rejectedReason: reason, reviewedBy: "llm" });
      await notifySubmission(polish, "rejected", reason);
      return c.json({ ok: true, rejected: true, reason });
    }

    // 解析 1–N 版脚本（按话题切分）
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
    if (scripts.length === 0) return c.json({ error: "polish_output_invalid" }, 502);

    // 落库 1–N 条 + accepted
    const saved: { id: string }[] = [];
    for (const script of scripts) {
      saved.push(await deps.repo.transcripts.create(polish.id, script.segments, language, {
        topic: script.topic,
        title: script.title,
        creationNote: script.creationNote,
        hostName,
        ...(aiGuest ? { guestId: aiGuest.id, guestName: aiGuest.name } : {}),
      }));
    }
    await deps.repo.polishes.setStatus(polish.id, "accepted");
    await notifySubmission(polish, "accepted", null);
    return c.json({
      ok: true,
      rejected: false,
      transcriptIds: saved.map((s) => s.id),
      transcripts: scripts.map((script, i) => ({
        id: saved[i].id,
        title: script.title,
        creationNote: script.creationNote,
        topic: script.topic,
      })),
    });
  });

  // ---- 拒绝（任何阶段可用；reason 必填，投稿人可见） ----
  app.post("/v1/editor/reviews/:id/reject", async (c) => {
    const polish = await deps.repo.polishes.getById(c.req.param("id"));
    if (!polish) return c.json({ error: "not_found" }, 404);
    if (polish.status === "rejected") return c.json({ ok: true });
    const body = (await c.req.json().catch(() => null)) as { reason?: unknown } | null;
    const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 300) : "";
    if (!reason) return c.json({ error: "reason_required", detail: "拒绝时必须填写原因（投稿人可见）" }, 400);
    // 拒审来源 = 编辑人工（LLM 自动拒走 /process quality_failed）
    await deps.repo.polishes.setStatus(polish.id, "rejected", { rejectedReason: reason, reviewedBy: "editor" });
    await notifySubmission(polish, "rejected", reason);
    return c.json({ ok: true });
  });

  // ---- 追加脚本（已收录投稿；LLM 按创作要求追加一条，复用润色提示词 instruction） ----
  app.post("/v1/editor/reviews/:id/scripts", async (c) => {
    const polish = await deps.repo.polishes.getById(c.req.param("id"));
    if (!polish) return c.json({ error: "not_found" }, 404);
    if (polish.status !== "accepted") return c.json({ error: "invalid_status", detail: "仅已收录（accepted）投稿可追加脚本" }, 409);
    const body = (await c.req.json().catch(() => null)) as { prompt?: unknown } | null;
    const prompt = typeof body?.prompt === "string" && body.prompt.trim() ? body.prompt.trim().slice(0, 500) : "";
    if (!prompt) return c.json({ error: "prompt_required", detail: "请填写追加脚本的创作要求" }, 400);
    const { messages, hostName, personaText, aiGuest } = await polishMeta(deps, polish);
    if (messages.length === 0) return c.json({ error: "no_dialogue" }, 404);
    let raw: string;
    try {
      raw = await deps.llm.complete(polishPrompt(messages, prompt, {
        hostName,
        aiName: aiGuest?.name ?? null,
        aiIntro: aiGuest?.intro ?? null,
        hostPersona: personaText || null,
      }));
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        return c.json({ error: "llm_timeout", detail: { message: "脚本创作超时，请稍后重试" } }, 504);
      }
      throw e;
    }
    const parsed = parseJsonLoose(raw) as { scripts?: unknown } | ScriptSegment[] | null;
    // 追加只取第一条脚本（LLM 可能按习惯返回多脚本，追加语义 = 一条新脚本）
    let script: { topic: string | null; title: string | null; creationNote: string | null; segments: ScriptSegment[] } | null = null;
    if (Array.isArray(parsed)) {
      script = { topic: null, title: null, creationNote: null, segments: parsed as ScriptSegment[] };
    } else if (parsed && Array.isArray((parsed as { scripts?: unknown }).scripts)) {
      const s = (parsed as { scripts: { topic?: unknown; title?: unknown; creationNote?: unknown; segments?: unknown }[] }).scripts[0];
      if (s && Array.isArray(s.segments)) {
        script = {
          topic: typeof s.topic === "string" && s.topic.trim() ? s.topic.trim().slice(0, 60) : null,
          title: typeof s.title === "string" && s.title.trim() ? s.title.trim().slice(0, 120) : null,
          creationNote: typeof s.creationNote === "string" && s.creationNote.trim() ? s.creationNote.trim().slice(0, 500) : null,
          segments: s.segments as ScriptSegment[],
        };
      }
    }
    if (!script || script.segments.length === 0) return c.json({ error: "polish_output_invalid" }, 502);
    const saved = await deps.repo.transcripts.create(polish.id, script.segments, "zh", {
      topic: script.topic,
      title: script.title,
      creationNote: script.creationNote,
      hostName,
      ...(aiGuest ? { guestId: aiGuest.id, guestName: aiGuest.name } : {}),
    });
    return c.json({
      ok: true,
      transcript: { id: saved.id, title: script.title, topic: script.topic, creationNote: script.creationNote, segments: script.segments },
    });
  });

  // ---- 生成任务列表（已收录投稿 + 脚本数 + 节目语音状态聚合） ----
  app.get("/v1/editor/generates", async (c) => {
    const polishes = await deps.repo.polishes.listAccepted();
    const items = await Promise.all(polishes.map(async (p) => {
      const [transcripts, episodes] = await Promise.all([
        deps.repo.transcripts.listByPolish(p.id),
        deps.repo.episodes.listByPolish(p.id),
      ]);
      const eps = await Promise.all(episodes.map(async (e) => ({
        id: e.id,
        transcriptId: e.transcriptId,
        status: e.status,
        jobStatus: (await deps.getLatestJob(e.id))?.status ?? null,
      })));
      return {
        id: p.id,
        title: p.title,
        snapshotTitle: p.snapshotTitle,
        platform: p.platform,
        createdAt: p.createdAt,
        reviewedAt: p.reviewedAt,
        scripts: transcripts.length,
        episodes: eps,
      };
    }));
    return c.json({ items });
  });

  // ---- 生成任务详情（投稿摘要 + 审核结果 + 脚本列表（含各自节目/job 状态）） ----
  app.get("/v1/editor/generates/:id", async (c) => {
    const summary = await reviewSummary(deps, c.req.param("id"));
    if (!summary) return c.json({ error: "not_found" }, 404);
    const [transcripts, episodes] = await Promise.all([
      deps.repo.transcripts.listByPolish(summary.id),
      deps.repo.episodes.listByPolish(summary.id),
    ]);
    const scripts = await Promise.all(transcripts.map(async (t) => {
      const ep = episodes.find((e) => e.transcriptId === t.id);
      const job = ep ? await deps.getLatestJob(ep.id) : null;
      return {
        id: t.id,
        title: t.title,
        topic: t.topic,
        creationNote: t.creationNote,
        language: t.language,
        segments: t.updatedSegments ?? t.segments,
        status: t.status, // unused / used
        episode: ep
          ? { id: ep.id, status: ep.status, jobStatus: job?.status ?? null, jobError: job?.error ?? null, publishedAt: ep.publishedAt }
          : null,
      };
    }));
    return c.json({ ...summary, scripts });
  });

  // ---- 概览统计（审核 / 脚本 / 发布三组计数） ----
  app.get("/v1/editor/overview", async (c) => {
    return c.json(await deps.repo.polishes.overviewStats());
  });

  // ---- 发布页详情：节目元数据 + 音频 + 投稿/脚本摘要 + 已通知推断 ----
  app.get("/v1/editor/episodes/:id/publish-detail", async (c) => {
    const ep = await deps.repo.episodes.getById(c.req.param("id"));
    if (!ep) return c.json({ error: "not_found" }, 404);
    const [polish, transcript, audioKey] = await Promise.all([
      deps.repo.polishes.getById(ep.polishId),
      deps.repo.transcripts.getById(ep.transcriptId),
      deps.repo.episodes.getPublicAudioKey(ep.id),
    ]);
    const snapshot = polish ? await deps.repo.snapshots.getById(polish.snapshotId) : null;
    const [email, profile, guest] = await Promise.all([
      polish ? deps.repo.notifications.getEmailByUserId(polish.userId) : Promise.resolve(null),
      polish ? deps.repo.episodes.getProfile(polish.userId) : Promise.resolve(null),
      transcript?.guestId ? deps.repo.guests.getByPlatform(transcript.guestId) : Promise.resolve(null),
    ]);
    const hostSample = polish ? await deps.repo.episodes.getVoiceSample(polish.userId) : null;
    const notified = await deps.repo.notifications.existsByLink(`/episode/${ep.id}`);
    return c.json({
      episode: {
        id: ep.id,
        title: ep.title,
        description: ep.description,
        coverUrl: ep.coverUrl,
        tags: ep.tags,
        status: ep.status,
        number: ep.number,
        publishedAt: ep.publishedAt,
      },
      audioUrl: audioKey ? `/v1/editor/episodes/${ep.id}/audio` : null,
      polish: polish
        ? { id: polish.id, title: polish.title, snapshotUrl: snapshot?.url ?? null, sourceTitle: snapshot?.sourceTitle ?? null, email }
        : null,
      transcript: transcript
        ? { id: transcript.id, title: transcript.title, topic: transcript.topic, language: transcript.language, segments: transcript.updatedSegments ?? transcript.segments }
        : null,
      host: profile
        ? { id: polish?.userId ?? null, name: profile.displayName ?? profile.nickname ?? null, callName: profile.persona?.callName ?? null, hasSample: !!hostSample?.audioUrl }
        : null,
      guest: guest ? { id: guest.id, name: guest.name } : null,
      notified,
      programUrl: ep.status === "published" ? `${deps.siteBaseUrl ?? ""}/episode/${ep.id}` : null,
    });
  });

  // ---- 节目音频（编辑端试听：语音已生成后的 audio player 用） ----
  app.get("/v1/editor/episodes/:id/audio", async (c) => {
    const key = await deps.repo.episodes.getPublicAudioKey(c.req.param("id"));
    if (!key || !deps.storage) return c.json({ error: "not_found" }, 404);
    try {
      const data = await deps.storage.get(key.audioKey);
      return new Response(new Uint8Array(data), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=300" } });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  });

  // ---- 主持人采样音频（投稿人录音；审核/生成页"采样播放"按钮） ----
  app.get("/v1/editor/samples/host/:userId/audio", async (c) => {
    const row = await deps.repo.episodes.getVoiceSample(c.req.param("userId"));
    if (!row?.audioUrl || !deps.storage) return c.json({ error: "not_found" }, 404);
    try {
      const bytes = await deps.storage.get(row.audioUrl);
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "audio/webm", "Cache-Control": "private, max-age=300" } });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  });

  // ---- 嘉宾采样音频（AI 人设；审核/生成页"采样播放"按钮） ----
  app.get("/v1/editor/samples/guest/:guestId/audio", async (c) => {
    const row = await deps.repo.guests.voiceSampleAny(c.req.param("guestId"));
    if (!row?.audioKey || !deps.storage) return c.json({ error: "not_found" }, 404);
    try {
      const bytes = await deps.storage.get(row.audioKey);
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "audio/webm", "Cache-Control": "private, max-age=300" } });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  });

  // ---- 编辑修改脚本（无归属校验——editor 权限） ----
  app.put("/v1/editor/transcripts/:id", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { segments?: unknown } | null;
    if (!Array.isArray(body?.segments) || !body.segments.every((seg: ScriptSegment) =>
      (seg.speaker === "host" || seg.speaker === "guest") && typeof seg.text === "string")) {
      return c.json({ error: "invalid_script" }, 400);
    }
    const t = await deps.repo.transcripts.getById(c.req.param("id"));
    if (!t) return c.json({ error: "not_found" }, 404);
    await deps.repo.transcripts.updateSegments(c.req.param("id"), body.segments as ScriptSegment[]);
    return c.json({ ok: true });
  });

  // ---- 生成（选脚本 → 安全审核 → job；完成后 status=ready 待发布确认） ----
  app.post("/v1/editor/episodes/new", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { transcriptId?: unknown; title?: unknown; description?: unknown } | null;
    if (!body || typeof body.transcriptId !== "string") return c.json({ error: "invalid_transcript" }, 400);
    const transcript = await deps.repo.transcripts.getById(body.transcriptId);
    if (!transcript) return c.json({ error: "not_found" }, 404);
    if (transcript.status === "used") return c.json({ error: "script_used", detail: "该脚本已生成过节目" }, 409);
    const polish = await deps.repo.polishes.getById(transcript.polishId);
    if (!polish) return c.json({ error: "not_found" }, 404);
    if (polish.status !== "accepted") return c.json({ error: "invalid_status", detail: "仅已收录（accepted）投稿可生成" }, 409);

    // 生成前校验投稿人已有声音采样（TTS 零样本克隆需要参考音频——没有采样会 400 且卡 generating）
    const voiceSample = await deps.repo.episodes.getVoiceSample(polish.userId);
    if (!voiceSample) {
      return c.json({ error: "missing_voice_sample", detail: "投稿人尚未录制声音采样，无法生成——请先让投稿人在投稿流程完成录音" }, 422);
    }

    // 生成前内容安全审核（最终脚本，含编辑手工改动）——品牌命门
    const segments = (transcript.updatedSegments ?? transcript.segments) as ScriptSegment[];
    const safety = await deps.safetyCheck(segments);
    if (!safety.pass) return c.json({ error: "safety_rejected", reason: safety.reason }, 422);

    const episode = await deps.repo.episodes.create({
      userId: polish.userId,
      transcriptId: transcript.id,
      polishId: polish.id,
      title: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : safety.title ?? transcript.title,
      description: typeof body.description === "string" && body.description.trim() ? body.description.trim().slice(0, 2000) : safety.description ?? null,
      topic: transcript.topic,
      tags: safety.tags ? safety.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8) : null,
      subtitle: segmentsToSubtitle(segments),
      snapshotId: polish.snapshotId,
      hostId: polish.userId,
      guestId: transcript.guestId ?? null,
    });
    // 唯一约束兜底（并发/残留）：同一脚本已有节目时友好报错而不是 internal_error
    if (!episode.id) return c.json({ error: "script_used", detail: "该脚本已生成过节目（请对失败的 job 使用重试）" }, 409);
    await deps.repo.transcripts.markUsed(transcript.id);
    const job = await deps.createJob(episode.id);
    await deps.enqueueJob({ id: job.id, episodeId: job.episodeId });
    return c.json({ episodeId: episode.id, jobId: job.id, status: job.status }, 202);
  });

  // ---- 重试失败/中断的生成（job 重跑，不新建节目） ----
  app.post("/v1/editor/episodes/:id/retry", async (c) => {
    const ep = await deps.repo.episodes.getById(c.req.param("id"));
    if (!ep) return c.json({ error: "not_found" }, 404);
    // 进行中的 job 不重复跑
    const latest = await deps.getLatestJob(c.req.param("id"));
    if (latest && ["queued", "tts", "merge", "upload"].includes(latest.status)) {
      return c.json({ error: "job_running", detail: "节目正在生成中" }, 409);
    }
    const job = await deps.createJob(c.req.param("id"));
    await deps.enqueueJob({ id: job.id, episodeId: job.episodeId });
    return c.json({ episodeId: ep.id, jobId: job.id, status: job.status }, 202);
  });

  // ---- 发布预填（LLM 生成标题/摘要/标签/封面关键词，预填为主，可改） ----
  app.get("/v1/editor/episodes/:id/publish-form", async (c) => {
    const ep = await deps.repo.episodes.getById(c.req.param("id"));
    if (!ep) return c.json({ error: "not_found" }, 404);
    if (ep.status !== "ready") return c.json({ error: "invalid_status", detail: "仅待发布（ready）节目可生成发布信息" }, 409);
    const transcript = await deps.repo.transcripts.getById(ep.transcriptId);
    if (!transcript) return c.json({ error: "not_found" }, 404);
    const segments = (transcript.updatedSegments ?? transcript.segments) as ScriptSegment[];
    const meta = parseJsonLoose(await deps.llm.complete(safetyMetaPrompt(segments))) as {
      pass?: boolean; reason?: string; title?: string; description?: string; tags?: string[]; topic?: string; coverKeywords?: string[];
    };
    if (meta.pass === false) return c.json({ error: "safety_rejected", reason: meta.reason }, 422);
    return c.json({
      title: meta.title ?? null,
      description: meta.description ?? null,
      tags: Array.isArray(meta.tags) ? meta.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8) : null,
      topic: meta.topic ?? null,
      coverKeywords: Array.isArray(meta.coverKeywords) ? meta.coverKeywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 4) : null,
    });
  });

  // ---- 发布确认：元数据落库 + 期号分配（max+1）+ published ----
  app.post("/v1/editor/episodes/:id/publish", async (c) => {
    const ep = await deps.repo.episodes.getById(c.req.param("id"));
    if (!ep) return c.json({ error: "not_found" }, 404);
    if (ep.status !== "ready") return c.json({ error: "invalid_status", detail: "仅待发布（ready）节目可发布" }, 409);
    const body = (await c.req.json().catch(() => null)) as {
      title?: unknown; description?: unknown; tags?: unknown; coverUrl?: unknown; isPicked?: unknown;
    } | null;
    if (!body || typeof body.title !== "string" || !body.title.trim()) {
      return c.json({ error: "title_required" }, 400);
    }
    const tags = Array.isArray(body.tags)
      ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
      : null;
    const rawCover = typeof body.coverUrl === "string" && body.coverUrl.trim() ? body.coverUrl.trim().slice(0, 500) : null;
    // 封面标准化：外链（Pexels）→ 下载 → 1400×1400 → R2（失败回退 null，发布不阻塞）
    let coverUrl: string | null = null;
    if (rawCover && /^https?:\/\//.test(rawCover) && deps.storage && deps.ffmpegPath) {
      try {
        const res = await fetch(rawCover, { signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          const resized = await resizeCover(deps.ffmpegPath, new Uint8Array(await res.arrayBuffer()));
          if (resized) {
            await deps.storage.put(`covers/${ep.id}.jpg`, resized);
            coverUrl = `covers/${ep.id}.jpg`;
          }
        }
      } catch { coverUrl = null; }
    }
    const result = await deps.repo.episodes.publish(ep.id, {
      title: body.title.trim().slice(0, 200),
      description: typeof body.description === "string" && body.description.trim() ? body.description.trim().slice(0, 2000) : null,
      tags,
      coverUrl,
      isPicked: body.isPicked === true,
    });
    // 上线通知 + 邮件（投稿人）
    const polish = await deps.repo.polishes.getById(ep.polishId);
    if (polish) await notifySubmission(polish, "published", null, { number: result.number, episodeId: ep.id });
    return c.json({ ok: true, number: result.number });
  });

  // ---- 已发布节目清单（清单入口：tags / 精选管理） ----
  app.get("/v1/editor/episodes", async (c) => {
    const items = await deps.repo.episodes.listPublished();
    return c.json({ items });
  });

  // ---- 已发布节目编辑：tags / 精选 / 元数据（发布页标题/封面/摘要可修改） ----
  app.put("/v1/editor/episodes/:id", async (c) => {
    const ep = await deps.repo.episodes.getById(c.req.param("id"));
    if (!ep) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => null)) as { tags?: unknown; isPicked?: unknown; title?: unknown; description?: unknown; coverUrl?: unknown } | null;
    const row: { tags?: string[] | null; isPicked?: boolean; title?: string | null; description?: string | null; coverUrl?: string | null } = {};
    if (body && "tags" in body) {
      row.tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8) : null;
    }
    if (body && "isPicked" in body) row.isPicked = body.isPicked === true;
    if (body && "title" in body) {
      if (typeof body.title !== "string" || !body.title.trim()) return c.json({ error: "invalid_title" }, 400);
      row.title = body.title.trim().slice(0, 200);
    }
    if (body && "description" in body) {
      row.description = typeof body.description === "string" && body.description.trim() ? body.description.trim().slice(0, 2000) : null;
    }
    if (body && "coverUrl" in body) {
      row.coverUrl = typeof body.coverUrl === "string" && body.coverUrl.trim() && /^https?:\/\//.test(body.coverUrl.trim())
        ? body.coverUrl.trim().slice(0, 500)
        : null;
    }
    if (Object.keys(row).length === 0) return c.json({ error: "invalid_input" }, 400);
    await deps.repo.episodes.updatePublished(ep.id, row);
    return c.json({ ok: true });
  });

  // ---- 封面候选：LLM 关键词 → Pexels 搜索 4 张 ----
  app.post("/v1/editor/reviews/:id/cover-search", async (c) => {
    if (!deps.pexelsApiKey) return c.json({ error: "pexels_not_configured" }, 503);
    const body = (await c.req.json().catch(() => null)) as { keywords?: unknown } | null;
    const keywords = Array.isArray(body?.keywords)
      ? body.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 4)
      : [];
    const query = keywords.join(" ");
    if (!query) return c.json({ error: "keywords_required" }, 400);
    try {
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=4&orientation=landscape`, {
        headers: { Authorization: deps.pexelsApiKey },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return c.json({ error: "pexels_error", detail: `HTTP ${res.status}` }, 502);
      const data = (await res.json()) as { photos?: Array<{ id: number; src?: Record<string, string>; photographer?: string; alt?: string }> };
      return c.json({
        query,
        candidates: (data.photos ?? []).map((p) => ({
          id: p.id,
          url: p.src?.large2x ?? p.src?.large ?? null,
          photographer: p.photographer ?? null,
          alt: p.alt ?? null,
        })),
      });
    } catch {
      return c.json({ error: "pexels_unreachable" }, 502);
    }
  });

  // ---- 嘉宾管理（迁移自 admin.ts 白名单；列表 + 采样上传） ----
  app.get("/v1/editor/guests", async (c) => {
    const guests = await deps.repo.guests.list();
    const samples = await deps.repo.guests.listVoiceSamples();
    return c.json({ guests, samples });
  });

  return app;
}

