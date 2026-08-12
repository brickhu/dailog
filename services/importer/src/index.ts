// 分享采集独立服务：POST /collect {url} → dialogue 或错误。
// 独立部署（Railway/VPS）——平台规则变化只更新本服务，不影响 API/Studio。
// 鉴权：POST /collect 需要 Bearer token（IMPORTER_TOKEN env）——公网暴露时
// 防止开放代理滥用（任意 URL 抓取 + 白烧 ScraperAPI 额度）；未配置 token
// 时拒绝一切 POST（安全默认，不裸奔）。

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { collectShareUrl, getPlatformRules, parseHtmlForUrl } from "./collect";
import { isCollectedDialogue } from "./types";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, at: new Date().toISOString() }));

/** 平台校验规则（公开下发，前端本地预检用——规则单一来源，不双写） */
app.get("/platforms", (c) => c.json({ platforms: getPlatformRules() }));

const CollectBody = z.object({
  url: z.string().url(),
});

/** POST 鉴权：Authorization: Bearer <token> 或 x-importer-token 头 */
const authed = (c: { req: { header: (name: string) => string | undefined } }): boolean => {
  const token = process.env.IMPORTER_TOKEN;
  if (!token) return false; // 未配置 token = 拒绝一切 POST（安全默认）
  const auth = c.req.header("authorization") ?? "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === token) return true;
  return c.req.header("x-importer-token") === token;
};

const ParseHtmlBody = z.object({
  html: z.string().min(50),
  url: z.string().url(),
});

/** 用户复制分享页源码（view-source/outerHTML）粘贴 → 按 URL 平台调 HTML 解析器。
 *  与 /collect 不同：不触达外网（内容来自用户浏览器，天然绕过 CF） */
app.post("/parse-html", async (c) => {
  if (!authed(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = ParseHtmlBody.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
  const d = parseHtmlForUrl(parsed.data.html, parsed.data.url);
  if (!d) return c.json({ error: "parse_failed", detail: { message: "无法从粘贴的源码中解析出对话（平台不匹配或结构变化）" } }, 422);
  return c.json(d);
});

app.post("/collect", async (c) => {
  if (!authed(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
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
console.log(`[importer] listening on :${port} (auth=${process.env.IMPORTER_TOKEN ? "on" : "OFF"})`);
