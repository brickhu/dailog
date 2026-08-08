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
  if (url.includes("chat.deepseek.com/share/")) return tryDeepSeekShareFetch(url, reqCtx);
  if (url.includes("chatgpt.com/share/")) return tryChatgptShareFetch(url, reqCtx);
  // doubao 分享页解析器后续补充
  return null;
}

/** deepseek 分享解析（/api/v0/share/content → data.biz_data.messages；role 大小写不敏感） */
function parseDeepSeekShare(d, id, url) {
  const msgs = d?.data?.biz_data?.messages ?? [];
  const messages = msgs
    .map((m) => ({ role: (m.role ?? "").toLowerCase(), content: m.content ?? "" }))
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => m.content);
  if (messages.length === 0) return null;
  return {
    platform: "deepseek",
    conversationId: id,
    title: d?.data?.biz_data?.title ?? "DeepSeek 分享对话",
    url,
    messages,
  };
}

/** deepseek 分享：Tier 1 直连公开接口（可能无 CF 强保护——直连直接可用） */
async function tryDeepSeekShareFetch(url, reqCtx) {
  const shareId = url.match(/chat\.deepseek\.com\/share\/([A-Za-z0-9]+)/)?.[1];
  if (!shareId) return null;
  const apiRes = await reqCtx.get(`https://chat.deepseek.com/api/v0/share/content?share_id=${shareId}`, {
    headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
  });
  if (!apiRes.ok()) return null;
  const d = await apiRes.json();
  return parseDeepSeekShare(d, shareId, url);
}

/** chatgpt 分享解析：静态 HTML 里 data-message-author-role 标记的消息 */
function parseChatgptShareHtml(html, id, url) {
  const messages = [];
  // 逐段匹配消息元素（含嵌套 div 文本；用标签计数找闭合——HTML 结构固定可简化：
  // 每个消息 div 后跟 3 层闭合，直接对剩余片段做惰性匹配）
  const re = /data-message-author-role="(user|assistant)"[^>]*>([\s\S]*?)(?=data-message-author-role="|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/section>)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const role = m[1];
    let frag = m[2];
    // 去掉 sr-only 标签与多余换行
    frag = frag.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (frag && (role === "user" || role === "assistant")) messages.push({ role, content: frag });
  }
  if (messages.length === 0) return null;
  return { platform: "chatgpt", conversationId: id, title: "ChatGPT 分享对话", url, messages };
}

/** chatgpt 分享：Tier 1 直连分享页 HTML + 提取（可能被 CF 拦 → null 落 Tier 2） */
async function tryChatgptShareFetch(url, reqCtx) {
  const shareId = url.match(/chatgpt\.com\/share\/([^/?#]+)/)?.[1];
  if (!shareId) return null;
  const htmlRes = await reqCtx.get(url, {
    headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
  });
  if (!htmlRes.ok()) return null;
  const html = await htmlRes.text();
  return parseChatgptShareHtml(html, shareId, url);
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
        const u = res.url();
        const j = await res.json();
        if (u.includes("chat_snapshots")) {
          result = parseClaudeSnapshot(j, u.match(/chat_snapshots\/([0-9a-f-]{36})/)?.[1] ?? "?", url);
        } else if (u.includes("/share/content")) {
          const id = u.match(/share_id=([A-Za-z0-9]+)/)?.[1] ?? "?";
          result = parseDeepSeekShare(j, id, url);
        }
      } catch (e) { /* 非 JSON 跳过 */ }
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (url.includes("chatgpt.com/share/")) {
      // chatgpt 分享页无接口响应：静态 HTML 渲染，等 3s 后直接读 DOM
      await page.waitForTimeout(3000);
      const shareId = url.match(/share\/([^/?#]+)/)?.[1] ?? "?";
      const texts = await page.locator("[data-message-author-role]").evaluateAll((els) =>
        els.map((el) => ({ role: el.getAttribute("data-message-author-role"), content: (el.textContent ?? "").trim() }))
          .filter((x) => x.content && (x.role === "user" || x.role === "assistant")),
      );
      if (texts.length) result = { platform: "chatgpt", conversationId: shareId, title: "ChatGPT 分享对话", url, messages: texts };
    } else {
      // 有接口的平台（claude/deepseek）：等接口响应
      const deadline = Date.now() + 90000;
      while (!result && Date.now() < deadline) await page.waitForTimeout(500);
    }
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
