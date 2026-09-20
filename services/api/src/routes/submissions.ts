// 投稿端点（本质版，2026-08-13；投稿区 2026-09）：
//  POST /api/v1/submissions  { url, language?, title?, callNameInEpisode?, voiceSampleId?, suggestion? }
//    → 校验 URL 合法性 + 投稿区 + 采样（语种必须与投稿区一致）→ 创建 submitted 投稿
//    → 归属规则：同一对话的投递权归**首个投稿人**（owner）；owner 可对同一 URL 追加其他语言区，
//      非 owner 一律 409 already_claimed；owner 重复提交同一语言区 → 幂等返回已有投稿
//  GET  /api/v1/me/submissions → 我的投稿及状态（submitted/rejected/published + 最新节目状态）
// 投稿 = 分享链接 + 声音采样（采样走 /v1/me/voice-sample，投稿仅关联 userId）。
// 服务端不做内容采集——只做「基本合法性（http/https 格式）与触达性（网络可达）检查」，
// 内容抓取/脚本/语音/合成全部由编辑本地 Agent 完成。

import { createRoute, OpenAPIHono, z, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { Repos } from "../repo";
import { createHash, randomBytes } from "node:crypto";

// 待审核投稿上限：同时排队待审的投稿超过该数 → 拒绝新投稿（防队列积压 + 引导等待）
const PENDING_LIMIT = 5;

/** 投稿区（目标语言）：用户投稿时选择的目标语言区——**一投稿 = 一语言区 = 一期节目**。
 *  当前开放 zh/en（与站点 lib/languages.ts 的 ENABLED_SAMPLE_LANGUAGES 对齐）；
 *  开放新区时，此处与站点投稿区选择器同步加值即可（其余链路均为语言参数化）。 */
export const ZONES = ["zh", "en"] as const;
export type Zone = (typeof ZONES)[number];
/** 缺省投稿区（老客户端不带 language 时按 zh 处理，保持既有行为） */
const DEFAULT_ZONE: Zone = "zh";

/** 解析投稿区：缺省 → DEFAULT_ZONE；给了非法值 → null（路由返回 400） */
function parseZone(input: unknown): Zone | null {
  if (typeof input !== "string" || !input.trim()) return DEFAULT_ZONE;
  const v = input.trim().toLowerCase();
  return (ZONES as readonly string[]).includes(v) ? (v as Zone) : null;
}

/** 触达性探活超时（ms）：网络层失败/超时 → 不可达 */
const REACH_TIMEOUT_MS = 8_000;

/** 从分享 URL 猜平台（匹配 guests 表 guest_id 用） */
function guessPlatform(url: string): string | null {
  const u = String(url || "").toLowerCase();
  if (u.includes("chatgpt") || u.includes("openai") || u.includes("chat.openai")) return "chatgpt";
  if (u.includes("claude")) return "claude";
  if (u.includes("kimi")) return "kimi";
  if (u.includes("doubao")) return "doubao";
  if (u.includes("gemini")) return "gemini";
  if (u.includes("deepseek")) return "deepseek";
  if (u.includes("grok") || u.includes("x.com") || u.includes("twitter")) return "grok";
  if (u.includes("tongyi") || u.includes("qwen")) return "tongyi";
  if (u.includes("perplexity")) return "perplexity";
  return null;
}

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

/** 平台分享链接的同站点宿主别名（host 等价 → 统一到标准 host，防同一分享内容经别名 URL 重复投稿）：
 *  doubao.com/www.doubao.com、chat.openai.com/chatgpt.com（旧分享链接重定向）、twitter.com/x.com */
const HOST_ALIASES: Record<string, string> = {
  "doubao.com": "www.doubao.com",
  "chat.openai.com": "chatgpt.com",
  "twitter.com": "x.com",
};

/** 规范化分享 URL：https + host 小写（别名 host 归一）+ 路径（去 query/hash/协议差异）——
 *  同一分享内容可能经多个 URL（平台结构变化 / 用户追加追踪参数 / 别名域名）访问，
 *  入库统一用提炼出的标准 URL（与 submissionKeyFromUrl 的 key 同源） */
export function canonicalUrl(input: string): string {
  try {
    const u = new URL(input);
    const host = u.hostname.toLowerCase();
    return `https://${HOST_ALIASES[host] ?? host}${u.pathname.replace(/\/+$/, "")}`;
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

/** 投稿 ID：sha256(userId|url|timestamp|rand|host) 前 16 字节 → UUID 格式（确定性 + 绝对防撞 + 环境隔离）
 *  - rand：每次随机 → 同参数也绝不碰撞
 *  - host：生成时环境维度 → 多环境共用 R2 不冲突
 *  - 生成一次存库，不重算（host/rand 仅生成瞬间参与） */
export function generateSubmissionId(userId: string, url: string, ts: number, rand: string, host: string): string {
  const digest = createHash("sha256").update([userId, url, String(ts), rand, host].join("|")).digest();
  const b = digest.subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4 风格
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 已上线节目摘要（投稿区/详情展示用） */
export interface EpisodeBrief {
  id: string;
  slug: string;
  title: string | null;
  coverUrl: string | null;
  number: number | null;
}

/** 取同一分享 URL 的全部投稿：规范 URL 优先；未命中再查原始 URL（历史行可能是原始形式） */
async function submissionsForUrl(repo: Repos, rawUrl: string, canonical: string) {
  const canon = await repo.submissions.listByUrl(canonical).catch(() => []);
  if (canon.length > 0 || canonical === rawUrl) return canon;
  return repo.submissions.listByUrl(rawUrl).catch(() => []);
}

/** 该投稿已上线（published + 公开）的节目摘要；未上线 → null */
async function publishedEpisodeOf(repo: Repos, submissionId: string): Promise<EpisodeBrief | null> {
  const episodes = await repo.episodes.listBySubmission(submissionId).catch(() => []);
  const p = episodes.find((e) => e.status === "published" && e.isPublic) ?? null;
  return p ? { id: p.id, slug: p.slug, title: p.title, coverUrl: p.coverUrl, number: p.number } : null;
}

/** 幂等响应体（owner 重复提交同一语言区 / 并发撞唯一约束时复用） */
async function existingPayload(repo: Repos, sub: { id: string; status: string; language: string }) {
  return {
    existing: true as const,
    submissionId: sub.id,
    status: sub.status,
    language: sub.language,
    episode: await publishedEpisodeOf(repo, sub.id),
  };
}

export function submissionsRoutes(repo: Repos) {
  const app = new OpenAPIHono<{ Variables: { userId: string } }>();
  const Err = z.object({ error: z.string() });

  // 预检：该 URL 的归属与各投稿区占用（URL 输入后即提示；zone 选择器的数据源）
  //   owner = self（自己的对话：可投未占用的区）/ other（他人的对话：一律拒绝）
  //         / none（尚无投稿：两个区都可投）
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
    // 投稿 ID 含 rand 不可重算——查重按 URL 权威（(url, language) 唯一约束兜底）
    const rows = await submissionsForUrl(repo, url, canonical);
    const mine = rows.filter((r) => r.userId === userId);
    const owner: "self" | "other" | "none" = rows.length === 0 ? "none" : mine.length > 0 ? "self" : "other";

    // 各投稿区占用情况（zone 选择器：已占用的区 disabled；hasSample = 该区采样是否就绪）
    const zones: Record<string, {
      submitted: boolean;
      submissionId: string | null;
      status: string | null;
      episode: EpisodeBrief | null;
      hasSample: boolean;
      canSubmit: boolean;
    }> = {};
    for (const zone of ZONES) {
      const sub = mine.find((r) => r.language === zone) ?? null;
      zones[zone] = {
        submitted: !!sub,
        submissionId: sub?.id ?? null,
        status: sub?.status ?? null,
        episode: sub ? await publishedEpisodeOf(repo, sub.id) : null,
        // 他人投稿：整条流程不可用，不查采样（避免无谓查询）
        hasSample: owner === "other" ? false : await repo.submissions.hasReadyVoiceSample(userId, null, zone).catch(() => false),
        canSubmit: !sub && owner !== "other",
      };
    }

    // 兼容字段（旧前端：existing/submissionId/status/episode）——**仅本人投稿才回传**，
    // 他人投稿不再暴露其 submissionId 与节目信息（B 只看到"已被他人提交"）
    const primary = mine[0] ?? null;
    return c.json({
      existing: rows.length > 0,
      owner,
      zones,
      submissionId: primary?.id ?? null,
      status: primary?.status ?? null,
      language: primary?.language ?? null,
      episode: primary ? await publishedEpisodeOf(repo, primary.id) : null,
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
    const body = (await c.req.json().catch(() => null)) as { url?: unknown; language?: unknown; title?: unknown; callNameInEpisode?: unknown; voiceSampleId?: unknown; suggestion?: unknown } | null;
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
    // 投稿区（目标语言）：一投稿 = 一语言区 = 一期节目（缺省 zh；非法值拒绝）
    const language = parseZone(body.language);
    if (!language) {
      return c.json({ error: "invalid_language", detail: `投稿区仅支持 ${ZONES.join(" / ")}` }, 400);
    }
    // 入库统一用标准 URL（用户原生输入不落库；同内容多 URL → 同一规范形式）
    const canonicalUrl2 = canonicalUrl(url);
    // 归属判定（先于采样校验：非 owner 不该被追问采样）
    //   · 该 URL 已有他人投稿 → 409 already_claimed（同一对话的投递权归首个投稿人）
    //   · 本人已投该语言区   → 幂等返回已有投稿（不重复创建）
    const urlRows = await submissionsForUrl(repo, url, canonicalUrl2);
    if (urlRows.length > 0 && !urlRows.some((r) => r.userId === userId)) {
      return c.json({ error: "already_claimed", detail: "该对话已被其他投稿人提交——同一分享链接的投递权归首个投稿人" }, 409);
    }
    const mineInZone = urlRows.find((r) => r.userId === userId && r.language === language);
    if (mineInZone) {
      return c.json(await existingPayload(repo, mineInZone));
    }
    // 声音采样严格要求：必须有一条属于该用户、ready、且**语种与该投稿区一致**的采样
    // （前端按钮已禁用，接口兜底防绕过；语种约束防「英文区静默用中文采样读英文」）
    const voiceSampleId = typeof body.voiceSampleId === "string" && /^[0-9a-f-]{36}$/i.test(body.voiceSampleId)
      ? body.voiceSampleId
      : null;
    if (!(await repo.submissions.hasReadyVoiceSample(userId, voiceSampleId, language))) {
      return c.json({ error: "voice_sample_required", detail: `投稿区「${language}」需要一条该语种的 ready 声音采样（请先完成录音）` }, 422);
    }
    // 可达性由用户端检测（浏览器直连探测——服务端数据中心 IP 可能被平台封锁而误判）；
    // 服务端不再以 isReachable 阻断提交，仅校验合法性与平台白名单。
    // 并发限制：待审核（submitted）超过上限 → 等待审批完成后再投（明确错误码，前端映射友好文案）
    const pending = await repo.submissions.countPendingByUser(userId);
    if (pending >= PENDING_LIMIT) {
      return c.json({ error: "pending_limit", detail: { count: pending, limit: PENDING_LIMIT } }, 429);
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
    // 主持人画像快照（账号级，不区分语言：displayName/bio/性别/职业/年龄/国籍）
    const personaInfo = await repo.episodes.getPersonaSnapshot(userId).catch(() => null);
    // 嘉宾快照：按 URL 猜平台 → guests 表匹配（guest jsonb 定格，preview/脚本直接取）
    let guest = null;
    try {
      const platform = guessPlatform(canonicalUrl2);
      if (platform) {
        const g = await repo.guests.getByPlatform(platform);
        if (g) guest = { id: g.id, name: g.name, intro: g.intro ?? null };
      }
    } catch { /* 嘉宾匹配失败不影响投稿 */ }
    const host = { callName: callNameInEpisode ?? null, personaInfo: personaInfo ?? null, voiceSampleId: voiceSampleId ?? null };
    // 投稿 ID：sha256(userId|url|timestamp|rand|host) → UUID 格式（绝对防撞 + 环境隔离；生成一次存库不重算）
    const rand = randomBytes(8).toString("hex");
    const reqHost = c.req.header("host") || "default";
    const created = await repo.submissions.create(generateSubmissionId(userId, canonicalUrl2, Date.now(), rand, reqHost), userId, canonicalUrl2, title, suggestion, guest, host, language);
    if (!created.id) {
      // 并发撞 (url, language) 唯一约束 → 回查本人该区投稿并幂等返回；查不到才是真失败
      const raced = (await repo.submissions.listByUrl(canonicalUrl2).catch(() => []))
        .find((r) => r.userId === userId && r.language === language);
      if (raced) return c.json(await existingPayload(repo, raced));
      return c.json({ error: "already_submitted", detail: "该链接已提交过投稿" }, 409);
    }
    return c.json({ submissionId: created.id, status: "submitted", language }, 201);
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
