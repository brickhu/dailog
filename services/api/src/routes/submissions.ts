// 投稿端点（本质版，2026-08-13）：
//  POST /api/v1/submissions  { url, title? } → 校验 URL 合法性 + 触达性 → 创建 submitted 投稿
//  GET  /api/v1/me/submissions → 我的投稿及状态（submitted/rejected/published + 最新节目状态）
// 投稿 = 分享链接 + 声音采样（采样走 /v1/me/voice-sample，投稿仅关联 userId）。
// 服务端不做内容采集——只做「基本合法性（http/https 格式）与触达性（网络可达）检查」，
// 内容抓取/脚本/语音/合成全部由编辑本地 Agent 完成。

import { Hono } from "hono";
import type { Repos } from "../repo";

// 待审核投稿上限：同时排队待审的投稿超过该数 → 拒绝新投稿（防队列积压 + 引导等待）
const PENDING_LIMIT = 5;

/** 触达性探活超时（ms）：网络层失败/超时 → 不可达 */
const REACH_TIMEOUT_MS = 8_000;

/** URL 基本合法性：http/https 协议 + 有 host；拒绝其它协议（javascript:/file: 等） */
export function isValidUrl(input: string): boolean {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
}

/** 触达性探活：HEAD 请求，能拿到 HTTP 响应（任何状态码）即视为可达——
 *  403/429 等反爬响应说明资源存在只是被挡（编辑本地 Agent 有浏览器可处理）；
 *  仅网络层失败（DNS/连接拒绝/超时）判不可达。 */
export async function isReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(REACH_TIMEOUT_MS),
    });
    return true;
  } catch {
    // HEAD 可能被部分站点拒绝（405/网络层），回退 GET 再试一次（小体积探测，不读 body）
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(REACH_TIMEOUT_MS),
      });
      return true;
    } catch {
      return false;
    }
  }
}

export function submissionsRoutes(repo: Repos) {
  const app = new Hono<{ Variables: { userId: string } }>();

  app.post("/v1/submissions", async (c) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as { url?: unknown; title?: unknown; callNameInEpisode?: unknown; voiceSampleId?: unknown } | null;
    if (!body) return c.json({ error: "invalid_body", detail: "请求体缺失" }, 400);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      return c.json({ error: "invalid_url", detail: "缺少分享链接（请粘贴 AI 对话分享 URL）" }, 400);
    }
    if (!isValidUrl(url)) {
      return c.json({ error: "invalid_url", detail: "链接格式不合法（仅支持 http/https 分享链接）" }, 400);
    }
    if (url.length > 2048) {
      return c.json({ error: "invalid_url", detail: "链接过长" }, 400);
    }
    // 触达性检查：网络不可达 → 提示稍后重试（不落库）
    if (!(await isReachable(url))) {
      return c.json({ error: "url_unreachable", detail: "链接当前无法访问，请确认链接有效后重试" }, 422);
    }
    // 并发限制：待审核（submitted）超过上限 → 等待审批完成后再投（明确错误码，前端映射友好文案）
    const pending = await repo.submissions.countPendingByUser(userId);
    if (pending >= PENDING_LIMIT) {
      return c.json({ error: "pending_limit", detail: { count: pending, limit: PENDING_LIMIT } }, 429);
    }
    // 重复提交同一链接 → 返回已有投稿（前端提示继续或去查看状态）
    const existing = await repo.submissions.findByUserUrl(userId, url);
    if (existing) {
      return c.json({ existing: true, submissionId: existing.id, status: existing.status });
    }
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : null;
    // 本次节目称呼（默认 displayName 填充，可改；脚本生成时按脚本语言改写）
    const callNameInEpisode = typeof body.callNameInEpisode === "string" && body.callNameInEpisode.trim()
      ? body.callNameInEpisode.trim().slice(0, 20)
      : null;
    // 投稿时使用的采样（仅记录；TTS 仍按语言匹配）——uuid 格式校验，无效忽略
    const voiceSampleId = typeof body.voiceSampleId === "string" && /^[0-9a-f-]{36}$/i.test(body.voiceSampleId)
      ? body.voiceSampleId
      : null;
    // 主持人档案快照（编辑 getDetail 免查库；脚本生成注入画像）
    const personaInfo = await repo.episodes.getPersonaSnapshot(userId).catch(() => null);
    const created = await repo.submissions.create(userId, url, title, callNameInEpisode, personaInfo, voiceSampleId);
    if (!created.id) {
      return c.json({ error: "already_submitted", detail: "该链接已提交过投稿" }, 409);
    }
    return c.json({ submissionId: created.id, status: "submitted" }, 201);
  });

  app.get("/v1/me/submissions", async (c) => {
    const userId = c.get("userId") as string;
    const list = await repo.submissions.listByUser(userId);
    return c.json(list);
  });

  return app;
}
