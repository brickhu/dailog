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
  // 频道信息
  username: string | null;
  displayName: string | null;
}

export interface ChannelSummary {
  username: string;
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

/** 最新已发布节目（首页） */
export async function listLatestEpisodes(limit = 20): Promise<EpisodeSummary[]> {
    return withDb((db) => db`
      SELECT e.id, e.slug, e.title, e.description,
             e.duration_seconds AS "durationSeconds",
             e.published_at AS "publishedAt", e.cover_url AS "coverUrl",
             t.language, tr.audio_url AS "audioUrl",
             p.username, p.display_name AS "displayName"
      FROM episodes e
      JOIN transcripts t ON t.id = e.transcript_id
      JOIN profiles p ON p.id = e.user_id
      LEFT JOIN LATERAL (
        SELECT tr.audio_url FROM tracks tr
        WHERE tr.episode_id = e.id
        ORDER BY tr.created_at DESC LIMIT 1
      ) tr ON true
      WHERE e.status = 'published' AND e.is_public = true
      ORDER BY e.published_at DESC
      LIMIT ${limit}
    ` as unknown as Promise<EpisodeSummary[]>);
}

/** 单集详情（仅 published 公开） */
export async function getEpisode(id: string): Promise<EpisodeSummary | null> {
    const rows = await withDb((db) => db`
      SELECT e.id, e.slug, e.title, e.description,
             e.duration_seconds AS "durationSeconds",
             e.published_at AS "publishedAt", e.cover_url AS "coverUrl",
             t.language, tr.audio_url AS "audioUrl",
             p.username, p.display_name AS "displayName"
      FROM episodes e
      JOIN transcripts t ON t.id = e.transcript_id
      JOIN profiles p ON p.id = e.user_id
      LEFT JOIN LATERAL (
        SELECT tr.audio_url FROM tracks tr
        WHERE tr.episode_id = e.id
        ORDER BY tr.created_at DESC LIMIT 1
      ) tr ON true
      WHERE e.id = ${id} AND e.status = 'published' AND e.is_public = true
      LIMIT 1
    `);
    return (rows[0] as unknown as EpisodeSummary | undefined) ?? null;
}

/** 频道页：简介 + 节目列表 */
export async function getChannel(username: string): Promise<{ channel: ChannelSummary | null; episodes: EpisodeSummary[] }> {
    return withDb(async (db) => {
    const rows = await db`
      SELECT p.username, p.display_name AS "displayName", p.bio,
             COUNT(e.id)::int AS "episodeCount"
      FROM profiles p
      LEFT JOIN episodes e ON e.user_id = p.id AND e.status = 'published' AND e.is_public = true
      WHERE p.username = ${username}
      GROUP BY p.username, p.display_name, p.bio
      LIMIT 1
    `;
    if (rows.length === 0) return { channel: null, episodes: [] };
    const raw = rows[0] as Record<string, unknown>;
    const channel: ChannelSummary = {
      username: String(raw.username),
      displayName: String(raw.displayName),
      bio: raw.bio == null ? null : String(raw.bio),
      episodeCount: Number(raw.episodeCount),
    };
    const episodes = await db`
      SELECT e.id, e.slug, e.title, e.description,
             e.duration_seconds AS "durationSeconds",
             e.published_at AS "publishedAt", e.cover_url AS "coverUrl",
             t.language, tr.audio_url AS "audioUrl",
             p.username, p.display_name AS "displayName"
      FROM episodes e
      JOIN transcripts t ON t.id = e.transcript_id
      JOIN profiles p ON p.id = e.user_id
      LEFT JOIN LATERAL (
        SELECT tr.audio_url FROM tracks tr
        WHERE tr.episode_id = e.id
        ORDER BY tr.created_at DESC LIMIT 1
      ) tr ON true
      WHERE p.username = ${username} AND e.status = 'published' AND e.is_public = true
      ORDER BY e.published_at DESC
    `;
    return { channel, episodes: episodes as unknown as EpisodeSummary[] };
    });
}
