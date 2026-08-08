// 分享采集独立服务：POST /collect {url} → dialogue 或错误。
// 独立部署（Fly/Railway/VPS）——平台规则变化只更新本服务，不影响 API/Studio。

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { collectShareUrl } from "./collect";
import { isCollectedDialogue } from "./types";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, at: new Date().toISOString() }));

const CollectBody = z.object({
  url: z.string().url(),
});

app.post("/collect", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CollectBody.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_url" }, 400);
  const result = await collectShareUrl(parsed.data.url);
  if (!isCollectedDialogue(result)) {
    const err = result as { error: string; detail?: unknown };
    const status = err.error === "unsupported_platform" ? 400 : err.error === "invalid_url" ? 400 : 502;
    return c.json(result, status as 400 | 502);
  }
  return c.json(result);
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`[share-collect] listening on :${port} (SOCKS_PROXY=${process.env.SOCKS_PROXY ? "set" : "none"})`);
