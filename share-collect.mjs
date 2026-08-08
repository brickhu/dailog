// 分享页采集服务核心原型：Tier 1 直连公开接口 → Tier 2 Playwright 兜底
// 用法：
//   NODE_PATH=/Users/free/Projects/storybook/storybook-test/node_modules node share-collect.mjs <分享链接>
// 输出：JSON dialogue（platform/conversationId/title/messages）或错误

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, request } = require("playwright");

const PROFILE = process.env.DAILOG_PROFILE ?? "./poc-profile";
const PROXY = (process.env.ALL_PROXY ?? "socks5://127.0.0.1:1081").replace("socks5h://", "socks5://");

// ============ 各平台解析（Tier 1：直连公开接口） ============

/** claude 分享：页面 HTML 里提取 org id + 直连 chat_snapshots 公开接口。
 *  返回 { platform, conversationId, title, messages } 或 null（被 CF 拦/未找到）。
 *  用 Playwright request context（轻量 HTTP 客户端：支持 socks5 代理、
 *  TLS 指纹接近浏览器——不启动浏览器进程） */
async function tryClaudeShareFetch(url, reqCtx) {
  const shareId = url.match(/claude\.ai\/share\/([0-9a-f-]{36})/)?.[1];
  if (!shareId) return null;
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
  // 1) 拉页面 HTML（顺带暴露 org id 的 API 路径）
  const htmlRes = await reqCtx.get(url, { headers: { "user-agent": UA } });
  if (!htmlRes.ok()) return null; // 403 = CF 拦截 → Tier 2
  const html = await htmlRes.text();
  const orgMatch = html.match(/\/api\/organizations\/([0-9a-f-]{36})\/chat_snapshots\/[0-9a-f-]{36}/);
  const orgId = orgMatch?.[1];
  if (!orgId) return null;
  // 2) 直连公开接口
  const apiRes = await reqCtx.get(
    `https://claude.ai/api/organizations/${orgId}/chat_snapshots/${shareId}?rendering_mode=messages&render_all_tools=true`,
    { headers: { "user-agent": UA } },
  );
  if (!apiRes.ok()) return null;
  const d = await apiRes.json();
  return parseClaudeSnapshot(d, shareId, url);
}

/** claude 快照解析（chat_messages: sender human/assistant + 附件正文并入） */
function parseClaudeSnapshot(d, id, url) {
  const msgs = Array.isArray(d?.chat_messages) ? d.chat_messages : [];
  const messages = msgs
    .filter((m) => m.sender === "human" || m.sender === "assistant")
    .map((m) => {
      const attach = (m.attachments ?? [])
        .filter((a) => a.extracted_content)
        .map((a) => a.extracted_content)
        .join("\n\n");
      return {
        role: m.sender === "human" ? "user" : "assistant",
        content: [m.text ?? "", attach].filter(Boolean).join("\n\n"),
      };
    });
  if (messages.length === 0) return null;
  return {
    platform: "claude",
    conversationId: id,
    title: typeof d.name === "string" && d.name ? d.name : "Claude 分享对话",
    url,
    messages,
  };
}

/** Tier 1：按平台分发直连尝试；失败返回 null（request context 复用） */
async function tryFetchShare(url, reqCtx) {
  if (url.includes("claude.ai/share/")) return tryClaudeShareFetch(url, reqCtx);
  // chatgpt/deepseek/doubao 分享页解析器后续按同样模式补充
  return null;
}

// ============ Tier 2：Playwright 兜底 ============

/** Playwright 加载分享页 → 拦截对话数据响应 → 解析（持久化 profile 免挑战） */
async function collectWithPlaywright(url) {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    channel: "chrome",
    proxy: { server: PROXY },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await context.newPage();
    let result = null;
    page.on("response", async (res) => {
      try {
        if (res.url().includes("chat_snapshots")) {
          const j = await res.json();
          result = parseClaudeSnapshot(j, url.match(/share\/([0-9a-f-]{36})/)?.[1] ?? "?", url);
        }
      } catch (e) { /* 非 JSON 跳过 */ }
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const deadline = Date.now() + 90000;
    while (!result && Date.now() < deadline) await page.waitForTimeout(500);
    await page.close();
    return result;
  } finally {
    await context.close();
  }
}

// ============ 主流程 ============

async function collectShare(url) {
  // Tier 1：直连公开接口（快路径，无浏览器进程）
  const reqCtx = await request.newContext({ proxy: { server: PROXY } });
  try {
    const t1 = await tryFetchShare(url, reqCtx);
    if (t1) return { tier: "fetch", ...t1 };
  } finally {
    await reqCtx.dispose().catch(() => {});
  }
  // Tier 2：Playwright 兜底
  const t2 = await collectWithPlaywright(url);
  if (t2) return { tier: "playwright", ...t2 };
  return null;
}

const url = process.argv[2];
if (!url) {
  console.error("用法: node share-collect.mjs <分享链接>");
  process.exit(1);
}
const t0 = Date.now();
const d = await collectShare(url);
if (d) {
  console.log(`[${d.tier}] ${d.messages.length} 条消息 | "${d.title}" | ${Date.now() - t0}ms`);
  console.log(JSON.stringify({ platform: d.platform, conversationId: d.conversationId, title: d.title, messages: d.messages }, null, 2).slice(0, 800));
} else {
  console.error("采集失败");
  process.exit(1);
}
