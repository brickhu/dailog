// 分享页采集服务核心原型：Tier 1 直连公开接口 → Tier 2 Playwright 兜底
// 用法：
//   NODE_PATH=/Users/free/Projects/storybook/storybook-test/node_modules node share-collect.mjs <分享链接>
// 输出：JSON dialogue（platform/conversationId/title/messages）或错误

import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, request } = require("playwright");

const PROFILE = process.env.DAILOG_PROFILE ?? "./poc-profile";
const PROXY = (process.env.ALL_PROXY ?? "socks5://127.0.0.1:1081").replace("socks5h://", "socks5://");
const execFileP = promisify(execFile);

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
  if (url.includes("doubao.com/thread/")) return tryDoubaoShareFetch(url, reqCtx);
  if (url.includes("share.gemini.google/")) return tryGeminiShareFetch(url);
  return null;
}

// ---------- gemini 分享：batchexecute RPC（公开无 cookie） ----------
// share.gemini.google/{shareId} 301 → gemini.google.com/share/{convId}?skid=...，
// 对话数据在 _/BardChatUi/data/batchexecute?rpcids=ujx1Bf（POST f.req 带 convId）
// 响应（playwright request context 会 Header overflow、node fetch 不支持
// socks5 代理）→ 用 curl 传输。响应为多块流式（)]}' + 长度\nJSON 重复），
// 每块是 ["wrb.fr","ujx1Bf",PAYLOAD_STRING,...]，payload 解码后：
//   容器元素 = [ [conv_id, req_id], parent, USER_MSG, ASSISTANT_MSG, ... ]；
//   USER_MSG[0] 为文本数组；ASSISTANT_MSG[0] 内 chunk[1] 为文本数组；
//   尾部 meta 元素 [true, "标题", ..., [1, convId, "模型"], true]。

/** curl 封装：走 socks5 代理、跟随重定向；body 落临时文件，stdout 只留最终 URL */
async function curl(url, { postData, timeout = 30000 } = {}) {
  const tmp = `/tmp/dailog-curl-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const args = ["-s", "-L", "--max-time", String(Math.floor(timeout / 1000))];
  if (PROXY) args.push("-x", PROXY.replace("socks5://", "socks5h://"));
  args.push("-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36");
  if (postData) {
    args.push("-H", "Content-Type: application/x-www-form-urlencoded;charset=UTF-8", "-X", "POST", "--data-binary", postData);
  }
  args.push("-o", tmp, "-w", "%{url_effective}", url);
  const { stdout } = await execFileP("curl", args, { maxBuffer: 64 * 1024 });
  const body = readFileSync(tmp, "utf8");
  return { body, finalUrl: stdout.trim() };
}

/** gemini batchexecute 响应解析：)]}' + \n\n 后的内容兼容两种格式——
 *  1) 直接整个 JSON（无长度行）；2) 长度分块（<长度>\n<JSON> 重复，容错去尾）。
 *  找到 ujx1Bf 块 → 返回 payload */
function parseGeminiBatch(text) {
  const head = text.indexOf("\n\n");
  if (head < 0) return null;
  const rest = text.slice(head + 2);
  // 格式 1：整个剩余就是 JSON
  try {
    const arr = JSON.parse(rest);
    if (Array.isArray(arr) && arr[0]?.[1] === "ujx1Bf") return JSON.parse(arr[0][2]);
  } catch { /* 落长度分块格式 */ }
  // 格式 2：长度分块
  let pos = 0;
  while (pos < rest.length) {
    const nl = rest.indexOf("\n", pos);
    if (nl < 0) break;
    const len = Number(rest.slice(pos, nl));
    const start = nl + 1;
    const chunk = rest.slice(start, start + len);
    let arr = null;
    for (let cut = 0; cut <= 4; cut++) {
      try { arr = JSON.parse(chunk.slice(0, chunk.length - cut)); break; } catch { /* 长度前缀误差 → 去尾重试 */ }
    }
    if (Array.isArray(arr) && arr[0]?.[1] === "ujx1Bf") return JSON.parse(arr[0][2]);
    pos = start + len;
  }
  return null;
}

/** gemini payload → dialogue（轮次结构 + 尾部标题） */
function parseGeminiPayload(payload, convId, url) {
  const inner = payload?.[0]?.[1] ?? payload?.[1] ?? payload;
  if (!Array.isArray(inner)) return null;
  const messages = [];
  // 标题在 payload[0][2]：[true, "标题", null, ..., [1, convId, "模型"], true]
  let title = "Gemini 分享对话";
  const meta = payload?.[0]?.[2];
  if (Array.isArray(meta) && meta[0] === true && typeof meta[1] === "string" && meta[1].length > 0) title = meta[1];
  for (const el of inner) {
    if (!Array.isArray(el) || el.length < 4) continue;
    // user：el[2][0] 文本数组
    const userText = Array.isArray(el[2]?.[0]) ? el[2][0].filter((t) => typeof t === "string").join("\n\n").trim() : "";
    // assistant：el[3][0] 内 chunk[1] 文本数组
    let asstText = "";
    const chunks = el[3]?.[0];
    if (Array.isArray(chunks)) {
      for (const chunk of chunks) {
        if (Array.isArray(chunk) && Array.isArray(chunk[1])) {
          asstText += chunk[1].filter((t) => typeof t === "string").join("\n\n") + "\n\n";
        }
      }
      asstText = asstText.trim();
    }
    if (userText) messages.push({ role: "user", content: userText });
    if (asstText) messages.push({ role: "assistant", content: asstText });
  }
  if (!messages.some((m) => m.role === "assistant")) return null;
  return { platform: "gemini", conversationId: convId, title, url, messages };
}

/** gemini 分享：Tier 1（curl：301 跟随拿 convId → batchexecute RPC） */
async function tryGeminiShareFetch(url) {
  const shareId = url.match(/share\.gemini\.google\/([^/?#]+)/)?.[1];
  if (!shareId) return null;
  const dbg = (msg) => { if (process.env.DAILOG_DEBUG === "1") console.error("[gemini]", msg); };
  try {
    dbg("shareId=" + shareId);
    // 1) 跟随重定向拿 convId
    const { body, finalUrl } = await curl(`https://share.gemini.google/${shareId}`);
    dbg("finalUrl=" + finalUrl.slice(0, 100) + " body=" + body.length);
    const convId = (finalUrl || body).match(/gemini\.google\.com\/share\/([0-9A-Za-z]+)/)?.[1];
    dbg("convId=" + convId);
    if (!convId) return null;
    // 2) batchexecute RPC（最简参数已验证可行）
    const postData = `f.req=${encodeURIComponent(JSON.stringify([[["ujx1Bf", `[null,"${convId}",[4]]`, null, "generic"]]]))}`;
    const { body: batchText } = await curl(`https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=ujx1Bf`, { postData });
    dbg("batch=" + batchText.length + " 含ujx1Bf=" + batchText.includes("ujx1Bf") + " 头=" + JSON.stringify(batchText.slice(0, 16)));
    const payload = parseGeminiBatch(batchText);
    dbg("payload=" + (payload ? "ok" : "null"));
    if (!payload) return null;
    const d = parseGeminiPayload(payload, convId, url);
    dbg("dialogue=" + (d ? d.messages.length + "条" : "null"));
    return d;
  } catch (e) {
    dbg(e?.message ?? String(e));
    return null;
  }
}

// ---------- doubao 分享：SSR data-fn-args 内嵌 message_snapshot ----------
// 分享页 HTML 的 <script data-fn-name="mergeLoaderData" data-fn-args="...">
// 属性里内嵌完整分享数据（HTML 实体转义 + 多层 JSON 字符串转义）：
//   message_snapshot.message_list[i].content_block[j].content.text_block.text
// 为 markdown 原文（含 **、---、###）；user_type=1 用户 / 2 助手；
// 标题在 share_info.share_name。纯 HTTP，无浏览器无接口调用。

/** HTML 属性值实体解码（&quot; &amp; &#x27; 等） */
function unescapeHtml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** doubao 分享解析（HTML → dialogue） */
function parseDoubaoShare(html, id, url) {
  const m = html.match(/data-fn-name="mergeLoaderData"[^>]*data-fn-args="((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  let args;
  try {
    args = JSON.parse(unescapeHtml(m[1]));
  } catch {
    return null;
  }
  // data-fn-args = [路由名, [loaderData...]]，message_snapshot 在深层字符串值里
  // （多层转义）——深度遍历找含 message_snapshot 的字符串，循环 JSON.parse 解层
  const stack = [args];
  let snap = null;
  while (stack.length && !snap) {
    const v = stack.pop();
    if (typeof v === "string") {
      if (v.includes("message_snapshot")) {
        let s = v;
        for (let i = 0; i < 5; i++) {
          try {
            const p = JSON.parse(s);
            if (p?.data?.message_snapshot?.message_list) { snap = p; break; }
            s = p; // 还嵌套着，继续解一层
          } catch { break; }
        }
      }
      continue;
    }
    if (v && typeof v === "object") {
      for (const k of Object.keys(v)) stack.push(v[k]);
    }
  }
  const list = snap?.data?.message_snapshot?.message_list;
  if (!Array.isArray(list) || list.length === 0) return null;
  const messages = list
    .map((msg) => ({
      role: msg.user_type === 1 ? "user" : "assistant",
      content: (msg.content_block ?? [])
        .map((b) => b?.content?.text_block?.text ?? "")
        .filter(Boolean)
        .join("\n\n"),
    }))
    .filter((x) => x.content && (x.role === "user" || x.role === "assistant"));
  if (!messages.some((x) => x.role === "assistant")) return null;
  return {
    platform: "doubao",
    conversationId: id,
    title: snap?.data?.share_info?.share_name ?? "豆包分享对话",
    url,
    messages,
  };
}

/** doubao 分享：Tier 1 直连分享页 HTML（SSR 全量，无 CF 拦截） */
async function tryDoubaoShareFetch(url, reqCtx) {
  const shareId = url.match(/doubao\.com\/thread\/([^/?#]+)/)?.[1];
  if (!shareId) return null;
  const htmlRes = await reqCtx.get(url, {
    headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
  });
  if (!htmlRes.ok()) return null;
  const html = await htmlRes.text();
  return parseDoubaoShare(html, shareId, url);
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

// ---------- chatgpt RSC payload 解码（React Router flight 格式，全量对话） ----------
// 分享页 HTML 内嵌 streamController.enqueue("...") 多段 payload：每段为一个 JSON 数组
// （值表：对象 {"_N": M} 引用表中键名/值；N 负数/越界 = undefined；原始数值时间戳
// 直接落表）。根元素即 loaderData 所在对象。多个 enqueue chunk 各自独立成表，
// 首个 chunk（P1: 前缀）含全部数据，其余是空对象占位。

/** 提取并解析全部 enqueue chunk → 表格数组列表（已剥离 P\d+: 前缀） */
function extractRscChunks(html) {
  const chunks = [];
  const re = /streamController\.enqueue\("((?:[^"\\]|\\.)*)"\)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const doc = JSON.parse(`"${m[1]}"`);
      chunks.push(JSON.parse(doc.replace(/^P\d+:/, "")));
    } catch { /* 非 JSON 片段跳过 */ }
  }
  return chunks;
}

/** 值表解码：共享引用记忆化（每个索引只展开一次，避免共享子树指数爆炸） */
function decodeRscTable(arr) {
  const cache = new Map();
  const resolve = (v, depth = 0) => {
    if (depth > 40) return undefined;
    if (typeof v === "number") {
      if (v < 0 || v >= arr.length) return v; // 越界/负数 → 原样（时间戳等）
      if (cache.has(v)) return cache.get(v);
      const val = resolve(arr[v], depth + 1);
      cache.set(v, val);
      return val;
    }
    if (Array.isArray(v)) return v.map((x) => resolve(x, depth + 1));
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v)) {
        if (k.startsWith("_")) {
          const name = resolve(arr[Number(k.slice(1))], depth + 1);
          out[name] = resolve(v[k], depth + 1);
        } else out[k] = resolve(v[k], depth + 1);
      }
      return out;
    }
    return v;
  };
  return resolve(0);
}

/** chatgpt 分享 RSC 解析：解码 loaderData → serverResponse.data（与登录态
 *  backend-api/conversation 同构的 mapping 节点图）→ 全量消息（免滚动、免登录） */
function parseChatgptShareRsc(html, id, url) {
  const chunks = extractRscChunks(html);
  if (chunks.length === 0) return null;
  let d = null;
  for (const chunk of chunks) {
    const root = decodeRscTable(chunk);
    const data = root?.loaderData?.["routes/share.$shareId.($action)"]?.serverResponse?.data;
    if (data?.mapping) { d = data; break; }
  }
  if (!d) return null;
  // 与扩展 parseChatgptConversation 一致：根节点 → children DFS → 拼接 parts → 过滤空
  const mapping = d.mapping;
  const rootId = Object.keys(mapping).find((k) => !mapping[k]?.message);
  if (!rootId) return null;
  const messages = [];
  const visit = (nodeId) => {
    const node = mapping[nodeId];
    if (!node) return;
    const role = node.message?.author?.role;
    if (role === "user" || role === "assistant") {
      const parts = (node.message?.content?.parts ?? []).filter((p) => typeof p === "string");
      const content = parts.join("\n\n");
      if (content) messages.push({ role, content });
    }
    for (const c of node.children ?? []) visit(c);
  };
  visit(rootId);
  if (messages.length === 0) return null;
  return {
    platform: "chatgpt",
    conversationId: typeof d.conversation_id === "string" && d.conversation_id ? d.conversation_id : id,
    title: typeof d.title === "string" && d.title ? d.title : "ChatGPT 分享对话",
    url,
    messages,
  };
}

/** chatgpt 分享解析：静态 HTML 里 data-message-author-role 标记的消息（降级：仅渲染部分） */
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

/** chatgpt 分享：Tier 1 直连分享页 HTML（可能被 CF 拦 → null 落 Tier 2）。
 *  优先 RSC 解码（全量消息）；RSC 缺失/结构变化 → 降级静态 HTML（仅渲染部分） */
async function tryChatgptShareFetch(url, reqCtx) {
  const shareId = url.match(/chatgpt\.com\/share\/([^/?#]+)/)?.[1];
  if (!shareId) return null;
  const htmlRes = await reqCtx.get(url, {
    headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
  });
  if (!htmlRes.ok()) return null;
  const html = await htmlRes.text();
  const rsc = parseChatgptShareRsc(html, shareId, url);
  if (rsc) return rsc;
  return parseChatgptShareHtml(html, shareId, url);
}

// ============ Tier 2：Playwright 兜底 ============

/** chatgpt 分享页步进采集（虚拟列表）。
 *  分享页初始只渲染尾部几条真实消息，其余为 h-[--estimated-turn-height] 占位
 *  slot（slot 顺序 = 对话顺序）；向上滚动时占位替换为真实消息——与登录态
 *  对话页同款虚拟列表。从底部向上逐屏步进：目标 = 视口内第 2 条消息
 *  scrollIntoView（留重叠防漏），等渲染稳定后读取当前渲染消息，按内容键合并
 *  （虚拟列表无稳定 id，跨窗口累积靠 role+content 键 + 前缀降级保护）；
 *  到顶（scrollTop≈0）且无新增 → 完成。 */
async function collectChatgptShareByScroll(page, shareId, url) {
  await page.waitForSelector("[data-message-author-role]", { timeout: 30000 });
  await page.waitForTimeout(1200);

  const readRendered = () =>
    page.locator("[data-message-author-role]").evaluateAll((els) => {
      const sc = [...document.querySelectorAll("div")].find((d) => d.scrollHeight > d.clientHeight + 500);
      const scTop = sc ? sc.getBoundingClientRect().top : 0;
      const scST = sc ? sc.scrollTop : 0;
      return els
        .map((el) => ({
          role: el.getAttribute("data-message-author-role"),
          content: (el.textContent ?? "").trim(),
          // 绝对文档位置（虚拟列表窗口漂移时首见序不可靠——占位高度是估计值，
          // 槽位可能延迟渲染；按文档位置排序才是真实对话顺序）
          pos: scST + el.getBoundingClientRect().top - scTop,
        }))
        .filter((x) => x.content && (x.role === "user" || x.role === "assistant"));
    });

  // 内容键合并（同 key 保留首见位置；跨窗口累积靠 role+content 键 + 前缀降级保护）
  const acc = new Map();
  const merge = (nodes) => {
    for (const n of nodes) {
      const k = `${n.role}\u0000${n.content}`;
      const old = acc.get(k);
      if (old && old.length > n.content.length && old.startsWith(n.content)) continue; // 截断重渲染 → 保留完整版
      acc.set(k, n);
    }
  };

  /** 向上一步：把视口内最上方消息滚到容器顶部上方 80px（留重叠）。
   *  关键：虚拟列表按 IntersectionObserver 渲染——只有未渲染的占位 slot
   *  进入视口才触发渲染；固定小步长（如 620px）会停在高消息内部导致
   *  无新 slot 进入 → 不渲染。滚动到最上方消息顶部必然把上方占位拉进视口。 */
  const stepUp = () =>
    page.evaluate(() => {
      const sc = [...document.querySelectorAll("div")].find((d) => d.scrollHeight > d.clientHeight + 500);
      if (!sc) return { atTop: true, scrollTop: 0 };
      const msgs = [...document.querySelectorAll("[data-message-author-role]")];
      if (!msgs.length) return { atTop: true, scrollTop: sc.scrollTop };
      if (sc.scrollTop <= 4) return { atTop: true, scrollTop: 0 };
      const first = msgs[0];
      const scTop = sc.getBoundingClientRect().top;
      const target = Math.max(0, sc.scrollTop + first.getBoundingClientRect().top - scTop - 80);
      sc.scrollTop = target;
      return { atTop: sc.scrollTop <= 4, scrollTop: sc.scrollTop };
    });

  let lastCount = 0;
  let stuck = 0;
  for (let i = 0; i < 120; i++) {
    merge(await readRendered());
    const grew = acc.size > lastCount;
    lastCount = acc.size;
    const step = await stepUp();
    await page.waitForTimeout(250); // 虚拟列表渲染周期（实测 250ms 足够窗口切换）
    if (step.atTop && !grew && i > 2) break; // 到顶且无新增 → 完成
    if (!grew) {
      // 位置未动且无新增 → 卡住计数；3 次放弃
      const next = await page.evaluate(() => {
        const sc = [...document.querySelectorAll("div")].find((d) => d.scrollHeight > d.clientHeight + 500);
        return sc ? sc.scrollTop : 0;
      });
      if (Math.abs(next - step.scrollTop) < 2) {
        if (++stuck >= 3) break;
      } else stuck = 0;
    }
  }
  const messages = [...acc.values()].sort((a, b) => a.pos - b.pos).map(({ role, content }) => ({ role, content }));
  if (messages.length === 0) return null;
  const title = (await page.title()).replace(/\s*[-|·]\s*(ChatGPT|OpenAI)\s*$/, "").trim() || "ChatGPT 分享对话";
  return { platform: "chatgpt", conversationId: shareId, title, url, messages };
}

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
      // chatgpt 分享页无公开接口且虚拟列表懒渲染（window 滚动无效——滚动容器
      // 是内部 div）→ 步进策略：底部向上逐屏 + 内容键合并（见 collectChatgptShareByScroll）
      const shareId = url.match(/share\/([^/?#]+)/)?.[1] ?? "?";
      result = await collectChatgptShareByScroll(page, shareId, url);
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
  // Tier 1：直连公开接口（快路径，无浏览器进程）；DAILOG_TIER=tier2 可跳过
  if (process.env.DAILOG_TIER !== "tier2") {
    const reqCtx = await request.newContext({ proxy: { server: PROXY } });
    try {
      const t1 = await tryFetchShare(url, reqCtx);
      if (t1) return { tier: "fetch", ...t1 };
    } finally {
      await reqCtx.dispose().catch(() => {});
    }
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
  const summary = { platform: d.platform, conversationId: d.conversationId, title: d.title, messages: d.messages };
  if (process.env.DAILOG_FULL === "1") console.log(JSON.stringify(summary));
  else console.log(JSON.stringify(summary, null, 2).slice(0, 800));
} else {
  console.error("采集失败");
  process.exit(1);
}
