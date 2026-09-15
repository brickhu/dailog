// 采集兜底回归（离线，不触网）：验证 microlink 托管渲染兜底的接线与开关
//   用法：node tools/script-lab/scripts/verify-collect-fallback.mjs
//   原理：全局 fetch 打桩——「直连」按场景返回失败/壳页/正常页，「microlink」按场景返回渲染后 HTML。
//   覆盖：默认关 · 开关两种写法 · 直连失败兜底 · 壳页兜底 · 直连正常不动用兜底 · 429 如实失败
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const { collectDialogue } = await import(join(here, "..", "lib", "collect.mjs"));

const SHELL = '<html><head><title>分享的对话</title></head><body><div id="app"></div></body></html>';
const FULL = '<html><head><title>我和 AI 的一次对话</title></head><body>' +
  '<div data-message-author-role="user"><div class="markdown">我想问一个问题</div></div>' +
  '<div data-message-author-role="assistant"><div class="markdown">这是回答</div></div></body></html>';

let calls = [];
function stub({ direct, microlink }) {
  calls = [];
  globalThis.fetch = async (input) => {
    const u = String(input);
    calls.push(u.startsWith("https://api.microlink.io") ? "microlink" : "direct");
    if (u.startsWith("https://api.microlink.io")) {
      if (microlink === "throw") throw new Error("boom");
      if (microlink === 429) return { ok: false, status: 429, headers: { get: () => "" }, text: async () => "", json: async () => ({}) };
      return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => "", json: async () => ({ status: "success", data: { html: microlink } }) };
    }
    if (direct === "throw") throw new Error("blocked");
    return { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => direct, json: async () => ({}) };
  };
}
const t = (name, o) => { console.log((o ? "PASS " : "FAIL ") + name); if (!o) process.exitCode = 1; };

const URLX = "https://chat.example.com/share/abc";

// ① 默认关：直连失败 → 不碰 microlink
delete process.env.DAILOG_MICROLINK; delete process.env.MICROLINK_API_KEY;
stub({ direct: "throw", microlink: FULL });
let r = await collectDialogue(URLX, { title: null });
t("默认关：不调用 microlink", !calls.includes("microlink") && r.ok === false);

// ② 开（DAILOG_MICROLINK=1）：直连失败 → 兜底取回，走通用嗅探
process.env.DAILOG_MICROLINK = "1";
stub({ direct: "throw", microlink: FULL });
r = await collectDialogue(URLX, { title: null });
t("兜底命中：2 条消息 + source=sniff", r.ok === true && r.messages?.length === 2 && r.source === "sniff" && calls.includes("microlink"));
t("兜底拿到的正文正确", r.messages?.[0]?.content === "我想问一个问题" && r.messages?.[1]?.role === "assistant");

// ③ 壳页：直连 200 但提取不到消息 → 再渲染一次
stub({ direct: SHELL, microlink: FULL });
r = await collectDialogue(URLX, { title: null });
t("壳页 → 兜底重试命中", r.ok === true && r.messages?.length === 2 && r.title === "我和 AI 的一次对话");

// ④ 直连正常：不动用兜底额度
stub({ direct: FULL, microlink: FULL });
r = await collectDialogue(URLX, { title: null });
t("直连命中：不动用兜底", r.ok === true && !calls.includes("microlink"));

// ⑤ 兜底 429：如实失败、不抛
stub({ direct: "throw", microlink: 429 });
r = await collectDialogue(URLX, { title: null });
t("兜底 429：如实失败", r.ok === false && typeof r.error === "string");

// ⑥ 显式关（有 key 也关）
process.env.DAILOG_MICROLINK = "0"; process.env.MICROLINK_API_KEY = "k";
stub({ direct: "throw", microlink: FULL });
r = await collectDialogue(URLX, { title: null });
t("显式关：不调用", r.ok === false && !calls.includes("microlink"));

// ⑦ 只配 key 即开
delete process.env.DAILOG_MICROLINK;
stub({ direct: "throw", microlink: FULL });
r = await collectDialogue(URLX, { title: null });
t("只配 MICROLINK_API_KEY 即开", r.ok === true && calls.includes("microlink"));

console.log(process.exitCode ? "\n有失败用例" : "\n全部通过");
