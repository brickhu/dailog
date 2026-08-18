// 站内搜索服务（站点自建，全局内容搜索弹窗 search-dialog.tsx 的数据源）。
// "use server"：SolidStart server function——client bundle 只留 RPC 桩，查询代码不进客户端。
// 按字段命中（Postgres ILIKE 子串匹配，大小写不敏感）：
//   节目：标题 / 简介 / 台本 / 嘉宾名 / 主播名（displayName 或 @username）
//   嘉宾：名称 / 平台 / 简介
//   主播：昵称 / @username
// 返回分组结果（episodes / guests / hosts）供弹窗自动补全分组展示。
// 无外部搜索服务依赖（未接 Algolia/Pagefind 等第三方）——随内容站部署即可用；
// 将来要换第三方索引，只改本模块（保持 searchContent 签名不变）即可。
"use server";
import postgres from "postgres";

export interface SearchEpisode {
  id: string;
  slug: string;
  title: string | null;
  description: string | null;
  coverUrl: string | null;
  language: string | null;
  publishedAt: Date | null;
  durationSeconds: number | null;
  /** 数字期号（"dailog 第 N 期"） */
  number: number | null;
  guestId: string | null;
  guestName: string | null;
  hostName: string | null;
  hostUsername: string | null;
}

export interface SearchGuest {
  id: string;
  platform: string;
  name: string;
  avatar: string | null;
  intro: string | null;
}

export interface SearchHost {
  username: string;
  displayName: string;
  avatar: string | null;
  episodeCount: number;
}

export interface SearchResults {
  episodes: SearchEpisode[];
  guests: SearchGuest[];
  hosts: SearchHost[];
}

/**
 * 每请求连接（同 db.ts 模式）：CF Workers 的 I/O 对象绑定创建它的请求上下文，模块级
 * 连接池跨请求复用会抛 "Cannot perform I/O on behalf of a different request"（workerd），
 * 故 SSR 每请求新建连接、用完即关。dev 时 vinxi SSR 不注入 .env.local：
 * Node 22 原生加载（生产平台注入则跳过）。放函数内而非模块顶层——server function
 * 转换会复制顶层语句进 client 桩。
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
  if (!url) throw new Error("DATABASE_URL 未配置：本地在 apps/site/.env.local，部署在 CF Pages 环境变量");
  const sql = postgres(url, { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

/** 转义 LIKE 通配符（\ % _）：用户输入按字面匹配，不作为通配符 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const MAX_QUERY_LEN = 64;

/** 全局内容搜索（自动补全）：q 为空/纯空白直接返回空结果；分组上限 limit（嘉宾/主播封顶 5） */
export async function searchContent(q: string, limit = 8): Promise<SearchResults> {
  const query = q.trim().slice(0, MAX_QUERY_LEN);
  const empty: SearchResults = { episodes: [], guests: [], hosts: [] };
  if (!query) return empty;
  const like = `%${escapeLike(query)}%`;
  return withDb(async (db) => {
    const [episodes, guests, hosts] = await Promise.all([
      db`
        SELECT e.id, e.slug, e.title, e.description, e.language,
               e.cover_url AS "coverUrl",
               e.published_at AS "publishedAt",
               e.duration_seconds AS "durationSeconds",
               e.number, e.guest_id AS "guestId",
               g.name AS "guestName",
               COALESCE(p.display_name, u.name) AS "hostName",
               u.name AS "hostUsername"
        FROM episodes e
        LEFT JOIN guests g ON g.id = e.guest_id
        LEFT JOIN profiles p ON p.id = e.profile_id
        JOIN "user" u ON u.id = e.user_id
        WHERE e.status = 'published' AND e.is_public = true
          AND (
            e.title ILIKE ${like}
            OR e.description ILIKE ${like}
            OR e.transcript ILIKE ${like}
            OR g.name ILIKE ${like}
            OR p.display_name ILIKE ${like}
            OR u.name ILIKE ${like}
          )
        -- 标题命中优先（自动补全的联想感），其余按发布时间
        ORDER BY (e.title ILIKE ${like}) DESC, e.published_at DESC
        LIMIT ${limit}
      ` as unknown as SearchEpisode[],
      db`
        SELECT id, platform, name, avatar, intro, url
        FROM guests
        WHERE name ILIKE ${like} OR platform ILIKE ${like} OR intro ILIKE ${like}
        ORDER BY name
        LIMIT ${Math.max(1, Math.min(limit, 5))}
      ` as unknown as SearchGuest[],
      db`
        SELECT u.name AS username, p.display_name AS "displayName",
               u.image AS avatar, COUNT(e.id)::int AS "episodeCount"
        FROM profiles p
        JOIN "user" u ON u.id = p.id
        LEFT JOIN episodes e ON e.user_id = p.id AND e.status = 'published' AND e.is_public = true
        WHERE p.display_name ILIKE ${like} OR u.name ILIKE ${like}
        GROUP BY u.name, p.display_name, u.image
        ORDER BY "episodeCount" DESC, u.name
        LIMIT ${Math.max(1, Math.min(limit, 5))}
      ` as unknown as SearchHost[],
    ]);
    return { episodes, guests, hosts };
  });
}
