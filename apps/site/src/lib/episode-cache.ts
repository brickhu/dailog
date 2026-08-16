// 详情页数据缓存（客户端/SSR 共用）：列表页 hover 预取 → 点击进详情时数据已就绪（即点即开）。
// cache() 与 @solidjs/router 的 createAsync 同键命中：服务端 preload 与客户端预取都写入同一缓存。
import { cache } from "@solidjs/router";
import { getEpisode, getSlugById } from "./db";

export const getEpisodeCached = cache(async (slug: string) => {
  const bySlug = await getEpisode(slug);
  if (bySlug) return bySlug;
  // 兼容旧 /episode/<uuid>：按 id 查 slug，命中则跳转到新路径（客户端）
  if (typeof window !== "undefined") {
    const realSlug = await getSlugById(slug);
    if (realSlug) {
      window.location.replace(`/episode/${realSlug}`);
      return null;
    }
  }
  return null;
}, "episode-detail");
