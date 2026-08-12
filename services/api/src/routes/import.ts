// 分享链接导入：POST /api/import {url}
//  ① snapshots 查 URL（分享内容固定 → 快照全局唯一）——未命中调 importer
//     （成功/失败都写快照；platform_unreachable 标注 10 分钟可重试）
//  ② 节目预览：该快照已有任意用户的节目（ready/published）→ alreadyPublished（前端进预览态，不进入确认导入）
//  ③ 内容溯源：新/无指纹快照计算指纹 + 前缀检测（衍生自库内对话 → prefix_source_id + suspectedSource）
//  ④ polishes 查 user × snapshot——已存在返回 existing（前端跳编辑页）
//  ⑤ 规则检查（非 LLM）：轮数 < 3 或总字数 < 500 → 422 too_short（内容门槛）
// 预览确认后由 POST /api/polishes/new 创建容器。

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { detectPrefixSource, sequenceFingerprint, type TraceMessage } from "../lib/content-trace";
// 粘贴消息（源码解析后归一化；与 importer dialogue 消息同构）
interface PasteMsg { role: "user" | "assistant"; content: string }

export interface ImportDeps {
  getSnapshotByUrl(url: string): Promise<{
    id: string;
    platform: string;
    sourceTitle: string | null;
    sourceConversationId: string | null;
    parsedDialogue: unknown;
    fingerprint: string | null;
    status: "ok" | "unreachable" | "parse_failed";
    retryAfter: Date | null;
    lastError: string | null;
  } | null>;
  createSnapshot(row: { url: string; platform: string; sourceTitle: string | null; sourceConversationId: string | null; parsedDialogue: unknown }): Promise<{ id: string }>;
  updateSnapshotContent(id: string, row: { platform: string; sourceTitle: string | null; sourceConversationId: string | null; parsedDialogue: unknown }): Promise<void>;
  markSnapshotUnreachable(id: string, error: string): Promise<void>;
  markSnapshotParseFailed(id: string, error: string): Promise<void>;
  findPolishByUserSnapshot(userId: string, snapshotId: string): Promise<{ id: string; title: string | null } | null>;
  /** 内容溯源候选集（全部已解析快照）——前缀检测用 */
  listTraceableSnapshots(): Promise<Array<{ id: string; sourceTitle: string | null; parsedDialogue: unknown }>>;
  /** 写溯源结果（指纹 + 前缀源；import 时一次） */
  setSnapshotSourceTrace(id: string, row: { fingerprint: string | null; prefixSourceId: string | null }): Promise<void>;
  /** 快照 → 已生成节目（ready/published 取最新；任意用户）——二次提交预览态 */
  findPublishedEpisodeBySnapshot(snapshotId: string): Promise<{
    id: string;
    title: string | null;
    durationSeconds: number | null;
    hostName: string | null;
    guestName: string | null;
  } | null>;
  /** 用户复制分享页源码 → importer 按 URL 平台解析（内容来自用户浏览器，天然绕过 CF）；
   *  null = 解析失败/平台无 HTML 解析器 */
  parseShareHtml(html: string, url: string): Promise<{
    platform: string;
    conversationId: string;
    title: string;
    url: string;
    messages: { role: string; content: string }[];
  } | null>;
  /** 平台分享页规则（importer /platforms 转发——规则单一来源在 importer；sharePattern 含域名+路径+ID 三级校验）。
   *  null = importer 不可达（调用方 503，勿误判为"无规则"） */
  getPlatformRules(): Promise<Array<{ id: string; label: string; sharePattern: string }> | null>;
}

/** 平台分享页的占位标题（用户未命名对话时的默认值）——不能当节目标题用 */
const PLACEHOLDER_TITLES = new Set([
  "shared conversation", "shared chat", "untitled", "新对话",
  "claude 分享对话", "chatgpt 分享对话", "deepseek 分享对话",
  "kimi 分享对话", "豆包分享对话", "gemini 分享对话",
]);

/**
 * 有效标题：非占位且长度 ≥2 直接用；否则用首条用户消息摘要（≤40 字）。
 * 各平台分享接口的 title 常是占位值（如 DeepSeek "Shared Conversation"），
 * 展示/建容器都用真实内容标题。
 */
export function effectiveTitle(title: string | null | undefined, messages: { role: string; content: string }[]): string | null {
  const t = (title ?? "").trim();
  if (t.length >= 2 && !PLACEHOLDER_TITLES.has(t.toLowerCase())) return t;
  const first = messages.find((m) => m.role === "user" && typeof m.content === "string" && m.content.trim());
  const content = first?.content?.trim() ?? "";
  if (!content) return null;
  return content.length > 40 ? content.slice(0, 40) + "…" : content;
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
      if (!res.ok) return { ok: false, error: data?.error ?? `采集失败（HTTP ${res.status}）`, detail: data?.detail };
      // 内容有效性：消息数 > 0 且至少一条有实质内容——importer 可能"伪成功"
      // （解析器对平台结构变化返回空 content 的消息数组），空内容视为解码失败
      const messages = data?.messages ?? [];
      const hasContent = messages.length > 0 && messages.some((m) => typeof m.content === "string" && m.content.trim().length > 0);
      if (!hasContent) return { ok: false, error: "parse_failed", detail: { message: "采集结果为空（平台结构可能已变化）" } };
      return { ok: true, dialogue: data };
    } catch {
      return { ok: false, error: "share_collect_unreachable" };
    }
  };

  app.post("/v1/import", async (c) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
    if (!body || typeof body.url !== "string" || !body.url.startsWith("http")) {
      return c.json({ error: "invalid_url" }, 400);
    }
    const url = body.url;

    // ④ 平台预检（采集前零成本拦截）：URL 必须匹配受支持平台的分享页结构
    // （sharePattern = 域名 + 路径前缀 + ID 格式三级校验，规则单一来源在 importer）
    // ——非支持链接直接 400，不浪费 importer 调用；平台规则变化只改 importer
    const rules = await deps.getPlatformRules();
    if (rules === null) return c.json({ error: "share_collect_not_configured" }, 503);
    const matched = rules.find((r) => {
      try {
        return new RegExp(r.sharePattern).test(url);
      } catch {
        return false;
      }
    });
    if (!matched) {
      return c.json({
        error: "unsupported_platform",
        detail: { message: "链接不是受支持的 AI 对话分享页（支持：Claude / ChatGPT / DeepSeek / Gemini / Kimi / 豆包）" },
      }, 400);
    }

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
      // unreachable 已过 TTL 且无内容（重试窗口结束）→ 重新采集，不能把空快照当可导入内容
      if (!snapshot.parsedDialogue) {
        const result = await callImporter(url);
        if (!result.ok) {
          if (result.error === "platform_unreachable" || result.error === "share_collect_unreachable") {
            await deps.markSnapshotUnreachable(snapshot.id, String((result.detail as { message?: string } | undefined)?.message ?? result.error));
            return c.json({ error: result.error }, 502);
          }
          return c.json({ error: result.error }, 422);
        }
        await deps.updateSnapshotContent(snapshot.id, {
          platform: result.dialogue.platform,
          sourceTitle: effectiveTitle(result.dialogue.title, result.dialogue.messages),
          sourceConversationId: result.dialogue.conversationId || null,
          parsedDialogue: result.dialogue.messages,
        });
        snapshot = await deps.getSnapshotByUrl(url);
      }
    } else {
      const result = await callImporter(url);
      if (!result.ok) {
        // 触达失败（网络/CF）→ 写快照（10 分钟 TTL，避免反复打 importer）；
        // 解码失败（parse_failed/内容为空）→ 不写库——通常是 importer 解析器
        // 问题（平台结构变化），修复后重试才有意义，写库会永久污染缓存
        if (result.error === "platform_unreachable" || result.error === "share_collect_unreachable") {
          const created = await deps.createSnapshot({ url, platform: "plain", sourceTitle: null, sourceConversationId: null, parsedDialogue: null });
          await deps.markSnapshotUnreachable(created.id, String((result.detail as { message?: string } | undefined)?.message ?? result.error));
          return c.json({ error: result.error }, 502);
        }
        return c.json({ error: result.error }, 422);
      }
      const created = await deps.createSnapshot({
        url,
        platform: result.dialogue.platform,
        sourceTitle: effectiveTitle(result.dialogue.title, result.dialogue.messages),
        sourceConversationId: result.dialogue.conversationId || null,
        parsedDialogue: result.dialogue.messages,
      });
      snapshot = await deps.getSnapshotByUrl(url);
      if (!snapshot) return c.json({ error: "parse_failed" }, 422);
    }
    if (!snapshot) return c.json({ error: "parse_failed" }, 422);

    // ② 节目预览：该快照已有任意用户的节目（ready/published）→ 不进入确认导入，
    // 返回预览态数据（标题/主持人/嘉宾/时长），前端引导"在原对话中续写再投稿"
    const publishedEpisode = await deps.findPublishedEpisodeBySnapshot(snapshot.id);
    if (publishedEpisode) {
      return c.json({
        alreadyPublished: true,
        episode: {
          id: publishedEpisode.id,
          title: publishedEpisode.title,
          durationSeconds: publishedEpisode.durationSeconds,
          hostName: publishedEpisode.hostName,
          guestName: publishedEpisode.guestName,
        },
      });
    }

    // ③ 内容溯源：无指纹快照（新建/历史数据）计算指纹 + 前缀源检测（衍生对话自动挂源）
    let suspectedSource: { snapshotId: string; sourceTitle: string | null } | null = null;
    if (Array.isArray(snapshot.parsedDialogue) && !snapshot.fingerprint) {
      const dialogue = snapshot.parsedDialogue as TraceMessage[];
      const candidates = await deps.listTraceableSnapshots();
      const source = detectPrefixSource(dialogue, candidates.filter((c) => c.id !== snapshot.id).map((c) => ({ id: c.id, sourceTitle: c.sourceTitle, messages: (c.parsedDialogue ?? []) as TraceMessage[] })));
      await deps.setSnapshotSourceTrace(snapshot.id, {
        fingerprint: sequenceFingerprint(dialogue),
        prefixSourceId: source?.id ?? null,
      });
      if (source) suspectedSource = { snapshotId: source.id, sourceTitle: source.sourceTitle };
    }

    // ④ polish 检查：用户已创建过该快照的容器 → 跳转编辑页
    // 展示标题用有效标题（旧容器名可能是占位复制来的；不影响 polish.title 数据本身）
    const existing = await deps.findPolishByUserSnapshot(userId, snapshot.id);
    if (existing) {
      return c.json({
        existing: true,
        polishId: existing.id,
        title: effectiveTitle(existing.title ?? snapshot.sourceTitle, (snapshot.parsedDialogue ?? []) as { role: string; content: string }[])
          ?? existing.title ?? snapshot.sourceTitle,
      });
    }

    // ③ 规则检查（非 LLM，零成本）：内容门槛——少于 3 轮问答或总字数 < 500 拒绝
    if (snapshot.parsedDialogue) {
      const messages = snapshot.parsedDialogue as { role: string; content: string }[];
      const userTurns = messages.filter((m) => m.role === "user").length;
      const totalChars = messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0);
      if (userTurns < 3 || totalChars < 500) {
        return c.json(
          { error: "too_short", detail: { message: `该对话内容过短（${userTurns} 轮问答 / 约 ${totalChars} 字），不适合制作播客单集` } },
          422,
        );
      }
    }

    return c.json({
      dialogue: {
        platform: snapshot.platform,
        conversationId: snapshot.sourceConversationId ?? url,
        title: effectiveTitle(snapshot.sourceTitle, (snapshot.parsedDialogue ?? []) as { role: string; content: string }[]) ?? "分享对话",
        url,
        messages: snapshot.parsedDialogue ?? [],
      },
      snapshotId: snapshot.id,
      // 内容溯源提示（新快照检测到衍生自库内对话时返回；无则省略）
      ...(suspectedSource ? { suspectedSource } : {}),
    });
  });

  // ---- 源码粘贴兜底：分享页被 CF 拦截时，用户复制分享页源码（view-source/outerHTML）粘贴导入 ----
  // 内容来自用户浏览器（天然绕过 CF），importer 按 URL 平台解析（结构完整，无需校对）

  /** 建粘贴快照 + 溯源检测 */
  const buildPasteSnapshot = async (messages: PasteMsg[]) => {
    const created = await deps.createSnapshot({
      url: `paste:${randomUUID()}`,
      platform: "plain",
      sourceTitle: messages.find((m) => m.role === "user")?.content.slice(0, 40) ?? "粘贴对话",
      sourceConversationId: null,
      parsedDialogue: messages,
    });
    // 内容溯源：粘贴对话同样参与前缀检测（衍生自库内已收录对话 → 提示）
    let suspectedSource: { snapshotId: string; sourceTitle: string | null } | null = null;
    const candidates = await deps.listTraceableSnapshots();
    const source = detectPrefixSource(messages, candidates.filter((c) => c.id !== created.id).map((c) => ({ id: c.id, sourceTitle: c.sourceTitle, messages: (c.parsedDialogue ?? []) as TraceMessage[] })));
    await deps.setSnapshotSourceTrace(created.id, {
      fingerprint: sequenceFingerprint(messages),
      prefixSourceId: source?.id ?? null,
    });
    if (source) suspectedSource = { snapshotId: source.id, sourceTitle: source.sourceTitle };
    return { created, suspectedSource };
  };

  /** 源码粘贴：用户复制分享页源码（view-source/outerHTML）→ importer 按平台解析 → 建快照 */
  app.post("/v1/import-paste/html", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { html?: unknown; url?: unknown } | null;
    const html = typeof body?.html === "string" ? body.html.trim() : "";
    const url = typeof body?.url === "string" ? body.url : "";
    if (!html || html.length < 50 || !url) {
      return c.json({ error: "invalid_input", detail: { message: "请粘贴分享页源码并确认来源链接" } }, 400);
    }
    const dialogue = await deps.parseShareHtml(html, url);
    if (!dialogue || !Array.isArray(dialogue.messages) || dialogue.messages.length < 2) {
      return c.json({ error: "parse_failed", detail: { message: "无法从源码中解析出对话（平台不匹配或结构变化）" } }, 422);
    }
    const messages: PasteMsg[] = dialogue.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    const userTurns = messages.filter((m) => m.role === "user").length;
    const totalChars = messages.reduce((n, m) => n + m.content.length, 0);
    if (userTurns < 1 || totalChars < 100) {
      return c.json({ error: "too_short", detail: { message: `对话内容过短（${userTurns} 轮问答 / 约 ${totalChars} 字），无法制作播客单集` } }, 422);
    }
    const { created, suspectedSource } = await buildPasteSnapshot(messages);
    return c.json({
      dialogue: {
        platform: dialogue.platform,
        conversationId: dialogue.conversationId,
        title: dialogue.title,
        url: null,
        messages,
      },
      snapshotId: created.id,
      ...(suspectedSource ? { suspectedSource } : {}),
    });
  });

  return app;
}
