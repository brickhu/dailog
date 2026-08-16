// 详情页数据缓存（客户端/SSR 共用）：列表页 hover 预取 → 点击进详情时数据已就绪（即点即开）。
// cache() 与 @solidjs/router 的 createAsync 同键命中：服务端 preload 与客户端预取都写入同一缓存。
//
// 数据源 = API 公开详情端点（而非 server function 直连 PG）：SolidStart 1.3 对 server function
// 的处理是渲染期间延后执行 → Suspense 一直挂起到 shell flush，head 的 OG 标签只能拿到 fallback。
// fetch 在 SSR 渲染期间真实执行 → Suspense resolve 后（blockingPromises 等待）才输出 shell，
// 此时 Suspense 内重渲染的 Title/Meta 已注册进 head（injectAssets）——社交爬虫读 SSR HTML 时
// og:title / og:image 完整。
import { cache } from "@solidjs/router";
import { apiBaseForFetch } from "./env";
import type { EpisodeSummary } from "./db";

export const getEpisodeCached = cache(async (idOrSlug: string) => {
  const r = await fetch(`${apiBaseForFetch}/v1/public/episodes/${encodeURIComponent(idOrSlug)}`);
  if (!r.ok) return null;
  const ep = (await r.json()) as EpisodeSummary;
  // JSON 序列化后 publishedAt 是 ISO 字符串 → 转回 Date（组件类型对齐；容器内 Date 无时区问题）
  if (ep.publishedAt) (ep as { publishedAt: Date | null }).publishedAt = new Date(ep.publishedAt);
  return ep;
}, "episode-detail");
