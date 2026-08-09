// 分享页采集转发：studio 调本接口（已有 auth），内部转发到 importer
// 独立服务（Railway 同 project 内网域名或公网 URL，IMPORTER_URL 配置）。
// 平台规则变化只更新 importer，本路由无需改动。
// 转发带 IMPORTER_TOKEN（Bearer）——importer 的 POST /collect 鉴权。

import { Hono } from "hono";

export function importerRoutes(getShareCollectUrl: () => string | null) {
  const app = new Hono<{ Variables: { userId: string } }>();

  /** 采集分享页 → dialogue（透传 importer 结果/错误） */
  app.post("/importer/collect", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
    if (!body || typeof body.url !== "string" || !body.url.startsWith("http")) {
      return c.json({ error: "invalid_url" }, 400);
    }
    const base = getShareCollectUrl();
    if (!base) return c.json({ error: "share_collect_not_configured" }, 503);
    const token = process.env.IMPORTER_TOKEN;
    let res: Response;
    try {
      res = await fetch(`${base.replace(/\/$/, "")}/collect`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url: body.url }),
        signal: AbortSignal.timeout(90000), // importer 多通道重试可能较慢
      });
    } catch {
      return c.json({ error: "share_collect_unreachable" }, 502);
    }
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) return c.json(data ?? { error: "share_collect_error" }, 502);
    return c.json(data);
  });

  return app;
}
