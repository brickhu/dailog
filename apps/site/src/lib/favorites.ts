// 收藏 API 共享函数（详情页 / 收藏页共用）：收藏 = 每用户唯一默认列表（kind=user + is_default）的增删查。
// 端点：GET /v1/me/favorites?contains=<id>（探测状态）、POST|DELETE /v1/me/favorites/:episodeId（收藏/取消）。
// 未登录（401）由调用方处理（跳登录）——函数返回原始 Response / null，status 供判断。

/** 探测收藏状态：已登录 → { contains }；未登录 / 请求失败 → null（调用方按未收藏展示） */
export async function fetchFavoriteStatus(episodeId: string): Promise<{ contains: boolean } | null> {
  try {
    const r = await fetch(`/v1/me/favorites?contains=${encodeURIComponent(episodeId)}`);
    if (!r.ok) return null;
    const d = (await r.json()) as { contains?: boolean };
    return { contains: !!d.contains };
  } catch {
    return null;
  }
}

/** 收藏 / 取消收藏：返回原始 Response（调用方处理 401 跳登录；ok 后自行刷新状态） */
export async function setFavorite(episodeId: string, favorited: boolean): Promise<Response> {
  return fetch(`/v1/me/favorites/${encodeURIComponent(episodeId)}`, { method: favorited ? "DELETE" : "POST" });
}
