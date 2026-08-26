// 投稿端点（本质版，2026-08-13）：
//  POST /api/v1/submissions  { url, title?, callNameInEpisode?, voiceSampleId?, suggestion? }
//    → 校验 URL 合法性 + 触达性 → 创建 submitted 投稿
//  GET  /api/v1/me/submissions → 我的投稿及状态（submitted/rejected/published + 最新节目状态）
// 投稿 = 分享链接 + 声音采样（采样走 /v1/me/voice-sample，投稿仅关联 userId）。
// 服务端不做内容采集——只做「基本合法性（http/https 格式）与触达性（网络可达）检查」，
// 内容抓取/脚本/语音/合成全部由编辑本地 Agent 完成。

import { createRoute, OpenAPIHono, z, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
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

/** 支持的 AI 对话平台分享链接（与前端 import-dialog 的 SHARE_HOSTS 保持一致；
 *  后端权威校验——防绕过前端检测直接提交任意 URL） */
const SHARE_HOSTS = [
  "chat.deepseek.com", "claude.ai", "chatgpt.com", "chat.openai.com",
  "gemini.google.com", "share.gemini.google", "kimi.moonshot.cn", "doubao.com", "www.doubao.com",
  "tongyi.aliyun.com", "perplexity.ai", "x.com", "twitter.com",
];

/** 专用分享子域：整个域名只承载分享页（如 share.gemini.google/<id>），任意非根路径即分享页 */
const SHARE_SUBDOMAINS = ["share.gemini.google"];

export function isShareUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (!SHARE_HOSTS.includes(host)) return false;
    const path = url.pathname.replace(/\/+$/, "");
    if (path.length <= 1) return false;
    // 专用分享子域（share.gemini.google/<shareId>）：路径即分享 ID，任意非根路径都算分享页
    if (SHARE_SUBDOMAINS.includes(host)) return true;
    return path.includes("/share/") || path.includes("/s/") || path.split("/").length > 2;
  } catch {
    return false;
  }
}

/** 规范化分享 URL：https + host 小写 + 路径（去 query/hash/协议差异）——
 *  同一分享内容可能经多个 URL（平台结构变化 / 用户追加追踪参数）访问，
 *  入库统一用提炼出的标准 URL（与 submissionKeyFromUrl 的 key 同源） */
export function canonicalUrl(input: string): string {
  try {
    const u = new URL(input);
    return `https://${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return input;
  }
}

/** 触达性探测结果：
 *  reachable = 资源存在（200/3xx/403/429 等——反爬响应说明资源存在只是被挡，
 *              编辑本地 Agent 有浏览器可处理；重定向 follow 后看最终状态码）；
 *  notfound  = 明确 404——页面不存在；
 *  unknown   = 网络层失败（DNS/连接拒绝/超时）——无法区分 404/存在，交由调用方兜底。
 * 判定标准：白名单域名内「非 404」即可触达。 */
export type Reachability = "reachable" | "notfound" | "unknown";

export async function probeReachability(url: string): Promise<Reachability> {
  // HEAD 优先（轻量）：非 404 响应即可判定存在；404/拿不到响应（405/网络层）不轻信，GET 确认
  let headStatus: number | null = null;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(REACH_TIMEOUT_MS),
    });
    headStatus = res.status;
    if (headStatus !== 404) return "reachable"; // 200/3xx/403/429 等：资源存在
  } catch {
    // HEAD 被拒（405/网络层）→ 走 GET 确认
  }
  // GET 确认（小体积探测，不读 body）：404 = 不存在；其余（含 403/429/5xx）视为存在
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(REACH_TIMEOUT_MS),
    });
    return res.status === 404 ? "notfound" : "reachable";
  } catch {
    return "unknown";
  }
}

// —— 确定性投稿 ID ——
// 由「平台标识 + 平台内容 ID」hash 生成（UUID v5 / RFC 4122 命名空间）：
// 同一分享 URL 永远得到同一 ID —— 天然幂等（重复提交撞唯一约束）、详情链接稳定、
// 并发竞态由 DB 唯一约束兜底。存量数据（随机 UUID）保留不变，两者兼容。
import { createHash } from "node:crypto";

const SUBMISSION_NS = "d6a5c441-58e7-4b1c-9a2d-3f0e1b2c3d4e"; // 投稿命名空间（固定）

/** 规范化分享 URL → 平台标识 + 内容 ID（去 query/hash、host 小写）：
 *  https://chat.deepseek.com/share/dy7ngmaqp1t8o642km?x=1 → "chat.deepseek.com:share/dy7ngmaqp1t8o642km"
 *  （分享链接的 query 常带追踪参数，不计入 ID —— 同内容同 ID） */
export function submissionKeyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}:${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url;
  }
}

/** UUID v5：sha1(命名空间 + 名称) 取前 16 字节 → 标准 UUID 格式（确定性） */
export function submissionIdFromUrl(url: string): string {
  const key = submissionKeyFromUrl(url);
  const digest = createHash("sha1").update(SUBMISSION_NS + key).digest();
  const b = digest.subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function submissionsRoutes(repo: Repos) {
  const app = new OpenAPIHono<{ Variables: { userId: string } }>();
  const Err = z.object({ error: z.string() });

  // 预检：同 URL 是否已投稿/已生成节目（输入地址即提示，无需采样/触达检查）
  const r1 = createRoute({
    method: "post",
    path: "/v1/submissions/check",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/submissions/check" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r1, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!isValidUrl(url)) {
      return c.json({ error: "invalid_url", detail: "链接格式不合法（仅支持 http/https 分享链接）" }, 400);
    }
    if (!isShareUrl(url)) {
      return c.json({ error: "unsupported_url", detail: "暂不支持的链接——仅支持 Claude / ChatGPT / DeepSeek / Gemini / Kimi / 豆包 的分享页" }, 400);
    }
    // 规范化：同内容多 URL（含追踪参数）→ 同一标准 URL 查询
    const canonical = canonicalUrl(url);
    // 确定性 ID：同 URL 同 ID → 直接按主键查（全局唯一，不涉及用户）；
    // 存量数据（随机 UUID）按 URL 全局兜底（任何人提交过都算重复）
    const existing =
      (await repo.submissions.findById(submissionIdFromUrl(url))) ??
      (await repo.submissions.findByUrl(canonical));
    if (!existing) return c.json({ existing: false });
    const episodes = await repo.episodes.listBySubmission(existing.id).catch(() => []);
    const published = episodes.find((e) => e.status === "published" && e.isPublic) ?? null;
    return c.json({
      existing: true,
      submissionId: existing.id,
      status: existing.status,
      episode: published ? { id: published.id, slug: published.slug, title: published.title, coverUrl: published.coverUrl, number: published.number } : null,
    });
  }) as unknown as RouteHandler<typeof r1, { Variables: { userId: string } }>);

  const rReach = createRoute({
    method: "post",
    path: "/v1/submissions/reachable",
    responses: {
      200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "URL 可达" },
      400: { content: { "application/json": { schema: Err } }, description: "URL 非法" },
      404: { content: { "application/json": { schema: Err } }, description: "URL 不存在（404）" },
      422: { content: { "application/json": { schema: Err } }, description: "URL 不可达（网络层失败）" },
    },
  });
  app.openapi(rReach, (async (c: Context) => {
    const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url) return c.json({ error: "invalid_url", detail: "缺少分享链接（请粘贴 AI 对话分享 URL）" }, 400);
    if (!isValidUrl(url)) return c.json({ error: "invalid_url", detail: "链接格式不合法（仅支持 http/https 分享链接）" }, 400);
    if (!isShareUrl(url)) return c.json({ error: "unsupported_url", detail: "暂不支持的链接——仅支持 Claude / ChatGPT / DeepSeek / Gemini / Kimi / 豆包 的分享页" }, 400);
    if (url.length > 2048) return c.json({ error: "invalid_url", detail: "链接过长" }, 400);
    // 探活用原生 URL（实际可访问性）；响应返回规范 URL 供前端存储
    const canonical = canonicalUrl(url);
    const r = await probeReachability(url);
    if (r === "notfound") return c.json({ error: "not_found", detail: "链接不存在（页面返回 404），请确认链接有效" }, 404);
    if (r === "unknown") return c.json({ error: "url_unreachable", detail: "链接当前无法访问，请确认链接有效后重试" }, 422);
    return c.json({ ok: true, url: canonical });
  }) as unknown as RouteHandler<typeof rReach, { Variables: { userId: string } }>);

  const r2 = createRoute({
    method: "post",
    path: "/v1/submissions",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/submissions" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r2, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as { url?: unknown; title?: unknown; callNameInEpisode?: unknown; voiceSampleId?: unknown; suggestion?: unknown } | null;
    if (!body) return c.json({ error: "invalid_body", detail: "请求体缺失" }, 400);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      return c.json({ error: "invalid_url", detail: "缺少分享链接（请粘贴 AI 对话分享 URL）" }, 400);
    }
    if (!isValidUrl(url)) {
      return c.json({ error: "invalid_url", detail: "链接格式不合法（仅支持 http/https 分享链接）" }, 400);
    }
    if (!isShareUrl(url)) {
      return c.json({ error: "unsupported_url", detail: "暂不支持的链接——仅支持 Claude / ChatGPT / DeepSeek / Gemini / Kimi / 豆包 的分享页" }, 400);
    }
    if (url.length > 2048) {
      return c.json({ error: "invalid_url", detail: "链接过长" }, 400);
    }
    // 入库统一用标准 URL（用户原生输入不落库；同内容多 URL → 同一规范形式）
    const canonicalUrl2 = canonicalUrl(url);
    // 声音采样严格要求：投稿必须关联一条属于该用户的 ready 采样（前端按钮已禁用，接口兜底防绕过）
    const voiceSampleId = typeof body.voiceSampleId === "string" && /^[0-9a-f-]{36}$/i.test(body.voiceSampleId)
      ? body.voiceSampleId
      : null;
    if (!(await repo.submissions.hasReadyVoiceSample(userId, voiceSampleId))) {
      return c.json({ error: "voice_sample_required", detail: "投稿必须提供声音采样（请先完成录音）" }, 422);
    }
    // 可达性由用户端检测（浏览器直连探测——服务端数据中心 IP 可能被平台封锁而误判）；
    // 服务端不再以 isReachable 阻断提交，仅校验合法性与平台白名单。
    // 并发限制：待审核（submitted）超过上限 → 等待审批完成后再投（明确错误码，前端映射友好文案）
    const pending = await repo.submissions.countPendingByUser(userId);
    if (pending >= PENDING_LIMIT) {
      return c.json({ error: "pending_limit", detail: { count: pending, limit: PENDING_LIMIT } }, 429);
    }
    // 重复提交同一链接（全局唯一，不涉及用户）→ 返回已有投稿 + 已生成节目
    const existing =
      (await repo.submissions.findById(submissionIdFromUrl(url))) ??
      (await repo.submissions.findByUrl(canonicalUrl2));
    if (existing) {
      const episodes = await repo.episodes.listBySubmission(existing.id).catch(() => []);
      const published = episodes.find((e) => e.status === "published" && e.isPublic) ?? null;
      return c.json({
        existing: true,
        submissionId: existing.id,
        status: existing.status,
        episode: published ? { id: published.id, slug: published.slug, title: published.title, coverUrl: published.coverUrl, number: published.number } : null,
      });
    }
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : null;
    // 本次节目称呼（默认 displayName 填充，可改；脚本生成时按脚本语言改写）
    const callNameInEpisode = typeof body.callNameInEpisode === "string" && body.callNameInEpisode.trim()
      ? body.callNameInEpisode.trim().slice(0, 20)
      : null;
    // 投稿人节目建议（可选；编辑生成脚本时仅供选题视角参考，无参考价值可忽略）
    const suggestion = typeof body.suggestion === "string" && body.suggestion.trim()
      ? body.suggestion.trim().slice(0, 500)
      : null;
    // 主持人档案快照（编辑 getDetail 免查库；脚本生成注入画像）
    const personaInfo = await repo.episodes.getPersonaSnapshot(userId).catch(() => null);
    const created = await repo.submissions.create(submissionIdFromUrl(url), userId, canonicalUrl2, title, callNameInEpisode, personaInfo, voiceSampleId, suggestion);
    if (!created.id) {
      return c.json({ error: "already_submitted", detail: "该链接已提交过投稿" }, 409);
    }
    return c.json({ submissionId: created.id, status: "submitted" }, 201);
  }) as unknown as RouteHandler<typeof r2, { Variables: { userId: string } }>);

  const r3 = createRoute({
    method: "get",
    path: "/v1/me/submissions",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/me/submissions" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r3, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const list = await repo.submissions.listByUser(userId);
    return c.json(list);
  }) as unknown as RouteHandler<typeof r3, { Variables: { userId: string } }>);

  const r4 = createRoute({
    method: "get",
    path: "/v1/me/submissions/:id",
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "当前用户单条投稿详情（含最新节目信息）" },
      404: { content: { "application/json": { schema: Err } }, description: "投稿不存在或非本人" },
    },
  });
  app.openapi(r4, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const row = await repo.submissions.getByUser(userId, c.req.param("id")!);
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(row);
  }) as unknown as RouteHandler<typeof r4, { Variables: { userId: string } }>);

  return app;
}
