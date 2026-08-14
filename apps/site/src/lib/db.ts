// server-only 读库：消费端直连 Railway Postgres（只读查询，不走统一后端）。
// "use server"：SolidStart server functions——client bundle 只留 RPC 桩（fetch 调用），
// 查询代码不进客户端；SSR 首屏服务端执行，hydration 用序列化数据。
"use server";
import postgres from "postgres";

export interface EpisodeSummary {
  id: string;
  slug: string;
  title: string | null;
  description: string | null;
  durationSeconds: number | null;
  publishedAt: Date | null;
  coverUrl: string | null;
  language: string | null;
  audioUrl: string | null;
  /** 对话原文地址（投稿时用户提交的分享链接） */
  sourceUrl: string | null;
  // 频道信息
  username: string | null;
  displayName: string | null;
  /** 主持人节目中的称呼（投稿 callNameInEpisode；无则回退 displayName/username） */
  callName: string | null;
  /** 无情绪标签的完整台本（节目页展示用） */
  transcript: string | null;
}

export interface ChannelSummary {
  username: string;
  avatar: string | null;
  displayName: string;
  bio: string | null;
  episodeCount: number;
}

/**
 * 每请求连接辅助：CF Workers 的 I/O 对象绑定创建它的请求上下文，模块级连接池跨请求
 * 复用会抛 "Cannot perform I/O on behalf of a different request"（workerd）。
 * 因此不做单例池：SSR 每请求新建连接、用完即关（查询量小，可接受）；
 * 流量上来后可换 Cloudflare Hyperdrive 托管连接池。
 * dev 时 vinxi SSR 不注入 .env.local：Node 22 原生加载（生产平台注入则跳过）。
 * 放函数内而非模块顶层——server function 转换会复制顶层语句进 client 桩。
 */
async function withDb<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      /* 生产环境无此文件，变量由部署平台注入 */
    }
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 未配置：本地在 apps/site/.env.local，部署在 CF Pages 环境变量（用 Railway DATABASE_PUBLIC_URL）");
  const sql = postgres(url, { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

/** 按 id 查 slug（旧 /<uuid> 与 /episode/<uuid> 链接 301 到 /episode/<slug> 用） */
export async function getSlugById(id: string): Promise<string | null> {
    const rows = await withDb((db) => db`
      SELECT e.slug FROM episodes e WHERE e.id = ${id} LIMIT 1
    `);
    return (rows[0] as { slug?: string } | undefined)?.slug ?? null;
}

/** 最新已发布节目（首页/发现页）。
 *  lang 可选（"zh"|"en"）：语言偏好分流——同语言内容优先（ORDER BY 匹配降序），
 *  数量不足时按时间自然 fallback 到其他语言（推荐层数据分流，不做独立 tab）。
 *  语言字段来自 episodes（编辑提交成品时固化）。 */
export async function listLatestEpisodes(limit = 20, lang?: "zh" | "en"): Promise<EpisodeSummary[]> {
    return withDb((db) => db`
      SELECT e.id, e.slug, e.title, e.description,
             e.duration_seconds AS "durationSeconds",
             e.published_at AS "publishedAt", e.cover_url AS "coverUrl",
             e.language, e.audio_url AS "audioUrl",
             u.name AS username, p.display_name AS "displayName"
      FROM episodes e
      JOIN profiles p ON p.id = e.user_id
      JOIN "user" u ON u.id = p.id
      WHERE e.status = 'published' AND e.is_public = true
      ${lang ? db`ORDER BY (e.language = ${lang}) DESC, e.published_at DESC` : db`ORDER BY e.published_at DESC`}
      LIMIT ${limit}
    ` as unknown as Promise<EpisodeSummary[]>);
}

/** 单 feed 用（dailog 频道全部已发布节目 + 音频 size + 封面） */
export interface FeedEpisode {
  id: string;
  slug: string;
  title: string | null;
  description: string | null;
  durationSeconds: number | null;
  publishedAt: Date | null;
  audioSize: number | null;
  audioUrl: string | null;
  coverUrl: string | null;
  episodeNumber: number | null;
}

/** 单 feed 用（dailog 频道全部已发布节目 + 音频 size + 封面）。
 *  lang 可选：按语言过滤；**该语言无内容时 fallback 全量**（避免订阅器拿到空 feed） */
export async function listFeedEpisodes(limit = 200, lang?: "zh" | "en"): Promise<FeedEpisode[]> {
  const q = (filter: string) => withDb((db) => db`
    SELECT e.id, e.slug, e.title, e.description,
           e.duration_seconds AS "durationSeconds",
           e.published_at AS "publishedAt",
           e.cover_url AS "coverUrl",
           e.number AS "episodeNumber",
           e.audio_size AS "audioSize",
           e.audio_url AS "audioUrl"
    FROM episodes e
    WHERE e.status = 'published' AND e.is_public = true
    ${lang && !filter ? db`AND e.language = ${lang}` : db``}
    ORDER BY e.published_at DESC
    LIMIT ${limit}
  ` as unknown as Promise<FeedEpisode[]>);
  const rows = await q("");
  if (lang && rows.length === 0) {
    // 该语言暂无内容 → fallback 全量（保留 feed 可用性）
    return q("fallback");
  }
  return rows;
}

/** 单集详情（仅 published 公开）——按 slug 查（路由 /episode/<slug>） */
export async function getEpisode(slug: string): Promise<EpisodeSummary | null> {
    const rows = await withDb((db) => db`
      SELECT e.id, e.slug, e.title, e.description,
             e.duration_seconds AS "durationSeconds",
             e.published_at AS "publishedAt", e.cover_url AS "coverUrl",
             e.language, e.audio_url AS "audioUrl",
             -- 对话原文链接：优先节目字段，缺省回退投稿链接（存量节目未写 raw_conversation_url 时仍可显示）
             COALESCE(e.raw_conversation_url, s.url) AS "sourceUrl",
             e.transcript,
             u.name AS username, p.display_name AS "displayName",
             s.call_name AS "callName"
      FROM episodes e
      JOIN submissions s ON s.id = e.submission_id
      JOIN profiles p ON p.id = e.user_id
      JOIN "user" u ON u.id = p.id
      WHERE e.slug = ${slug} AND e.status = 'published' AND e.is_public = true
      LIMIT 1
    `);
    return (rows[0] as unknown as EpisodeSummary | undefined) ?? null;
}

/** 主持人页（@name）：简介 + 节目列表。@slug = user.name（无独立 username 列） */
export async function getChannel(username: string): Promise<{ channel: ChannelSummary | null; episodes: EpisodeSummary[] }> {
    return withDb(async (db) => {
    const rows = await db`
      SELECT u.name AS username, u.image AS avatar, p.display_name AS "displayName", p.bio,
             COUNT(e.id)::int AS "episodeCount"
      FROM profiles p
      JOIN "user" u ON u.id = p.id
      LEFT JOIN episodes e ON e.user_id = p.id AND e.status = 'published' AND e.is_public = true
      WHERE u.name = ${username}
      GROUP BY u.name, u.image, p.display_name, p.bio
      LIMIT 1
    `;
    if (rows.length === 0) return { channel: null, episodes: [] };
    const raw = rows[0] as Record<string, unknown>;
    const channel: ChannelSummary = {
      username: String(raw.username),
      avatar: raw.avatar == null ? null : String(raw.avatar),
      displayName: String(raw.displayName),
      bio: raw.bio == null ? null : String(raw.bio),
      episodeCount: Number(raw.episodeCount),
    };
    const episodes = await db`
      SELECT e.id, e.slug, e.title, e.description,
             e.duration_seconds AS "durationSeconds",
             e.published_at AS "publishedAt", e.cover_url AS "coverUrl",
             e.language, e.audio_url AS "audioUrl",
             u.name AS username, p.display_name AS "displayName"
      FROM episodes e
      JOIN profiles p ON p.id = e.user_id
      JOIN "user" u ON u.id = p.id
      WHERE u.name = ${username} AND e.status = 'published' AND e.is_public = true
      ORDER BY e.published_at DESC
    `;
    return { channel, episodes: episodes as unknown as EpisodeSummary[] };
    });
}

/** 嘉宾详情页（/guest/<id>）：嘉宾信息 + 参与的公开节目。id = platform 枚举值（chatgpt/claude/...） */
export interface GuestDetail {
  id: string;
  platform: string;
  name: string;
  avatar: string | null;
  intro: string | null;
  url: string | null;
  episodes: EpisodeSummary[];
}

export async function getGuest(id: string): Promise<GuestDetail | null> {
  return withDb(async (db) => {
    const rows = await db`
      SELECT id, platform, name, avatar, intro, url
      FROM guests
      WHERE id = ${id}
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    const raw = rows[0] as Record<string, unknown>;
    const episodes = await db`
      SELECT e.id, e.slug, e.title, e.description,
             e.duration_seconds AS "durationSeconds",
             e.published_at AS "publishedAt", e.cover_url AS "coverUrl",
             e.language, e.audio_url AS "audioUrl",
             u.name AS username, p.display_name AS "displayName"
      FROM episodes e
      JOIN profiles p ON p.id = e.user_id
      JOIN "user" u ON u.id = p.id
      WHERE e.guest_id = ${id} AND e.status = 'published' AND e.is_public = true
      ORDER BY e.published_at DESC
    `;
    return {
      id: String(raw.id),
      platform: String(raw.platform),
      name: String(raw.name),
      avatar: raw.avatar == null ? null : String(raw.avatar),
      intro: raw.intro == null ? null : String(raw.intro),
      url: raw.url == null ? null : String(raw.url),
      episodes: episodes as unknown as EpisodeSummary[],
    };
  });
}
