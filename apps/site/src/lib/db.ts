// server-only 读库：消费端直连 Railway Postgres（只读查询，不走统一后端）。
// "use server"：SolidStart server functions——client bundle 只留 RPC 桩（fetch 调用），
// 查询代码不进客户端；SSR 首屏服务端执行，hydration 用序列化数据。
"use server";
import postgres from "postgres";

// dev 时 vinxi SSR 运行时不注入 .env.local 到 process.env：Node 22 原生加载（生产平台注入则跳过）
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    /* 生产环境无此文件，变量由部署平台注入 */
  }
}

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

let sql: postgres.Sql | null = null;

/** 惰性单例连接（SSR 请求间复用；只读：默认 sslmode=require + 只执行 SELECT） */
function db(): postgres.Sql {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL 未配置（apps/site/.env.local）");
    sql = postgres(url, { max: 5 });
  }
  return sql;
}

export const siteDb = {
  /** 最新已发布节目（首页） */
  async listLatestEpisodes(limit = 20): Promise<EpisodeSummary[]> {
    return db()`
      SELECT e.id, e.slug, e.title, e.description,
             e.duration_seconds AS "durationSeconds",
             e.published_at AS "publishedAt", e.cover_url AS "coverUrl",
             e.language, e.audio_url AS "audioUrl",
             p.username, p.display_name AS "displayName"
      FROM episodes e
      JOIN profiles p ON p.id = e.user_id
      WHERE e.status = 'published' AND e.is_public = true
      ORDER BY e.published_at DESC
      LIMIT ${limit}
    ` as unknown as Promise<EpisodeSummary[]>;
  },

  /** 单集详情（仅 published 公开） */
  async getEpisode(id: string): Promise<EpisodeSummary | null> {
    const rows = await db()`
      SELECT e.id, e.slug, e.title, e.description,
             e.duration_seconds AS "durationSeconds",
             e.published_at AS "publishedAt", e.cover_url AS "coverUrl",
             e.language, e.audio_url AS "audioUrl",
             p.username, p.display_name AS "displayName"
      FROM episodes e
      JOIN profiles p ON p.id = e.user_id
      WHERE e.id = ${id} AND e.status = 'published' AND e.is_public = true
      LIMIT 1
    `;
    return (rows[0] as unknown as EpisodeSummary | undefined) ?? null;
  },

  /** 频道页：简介 + 节目列表 */
  async getChannel(username: string): Promise<{ channel: ChannelSummary | null; episodes: EpisodeSummary[] }> {
    const rows = await db()`
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
    const episodes = await db()`
      SELECT e.id, e.slug, e.title, e.description,
             e.duration_seconds AS "durationSeconds",
             e.published_at AS "publishedAt", e.cover_url AS "coverUrl",
             e.language, e.audio_url AS "audioUrl",
             p.username, p.display_name AS "displayName"
      FROM episodes e
      JOIN profiles p ON p.id = e.user_id
      WHERE p.username = ${username} AND e.status = 'published' AND e.is_public = true
      ORDER BY e.published_at DESC
    `;
    return { channel, episodes: episodes as unknown as EpisodeSummary[] };
  },
};

export type SiteDb = typeof siteDb;
