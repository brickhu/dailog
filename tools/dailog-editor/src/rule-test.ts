// 解码规则验证（大模型学习闭环的一环）：用草稿 page.html 验证候选规则，跑通后入库
//   pnpm editor rule-test <submissionId> --user-selector "..." --assistant-selector "..." [--content-selector "..."] [--platform claude] [--save]
//   ① 读草稿 page.html（需先 fetch）→ cheerio 按候选选择器提取
//   ② 输出：消息数 / user·assistant 分布 / 首条预览——与人工核对一致才算跑通
//   ③ --save：校验通过后写入 .dailog-editor/rules.json（platform/host/pathPrefix 从投稿 URL 推断）
//      下次 fetch 自动命中（无需 build）
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load as loadHtml } from "cheerio";
import type { EditorConfig } from "./lib.js";
import { api, draftDir, rulesPath } from "./lib.js";

function parseArgs(args: string[]): {
  submissionId: string;
  userSelector: string;
  assistantSelector: string;
  contentSelector?: string;
  platform?: string;
  save: boolean;
} {
  const submissionId = args[0];
  const take = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
  };
  const userSelector = take("--user-selector");
  const assistantSelector = take("--assistant-selector");
  if (!submissionId || !userSelector || !assistantSelector) {
    console.error("用法：pnpm editor rule-test <submissionId> --user-selector \"...\" --assistant-selector \"...\" [--content-selector \"...\"] [--platform claude] [--save]");
    process.exit(1);
  }
  return {
    submissionId,
    userSelector,
    assistantSelector,
    contentSelector: take("--content-selector"),
    platform: take("--platform"),
    save: args.includes("--save"),
  };
}

function normalizeText(s: string): string {
  return s.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

export async function ruleTest(config: EditorConfig, args: string[]): Promise<void> {
  const { submissionId, userSelector, assistantSelector, contentSelector, platform, save } = parseArgs(args);
  const dir = draftDir(submissionId);
  const pagePath = join(dir, "page.html");
  if (!existsSync(pagePath)) {
    console.error(`[rule-test] 缺少 ${pagePath}——先运行 pnpm editor fetch ${submissionId}`);
    process.exit(1);
  }

  // ① 按候选规则提取
  const $ = loadHtml(readFileSync(pagePath, "utf-8"));
  const messages: { role: string; content: string }[] = [];
  $(`${userSelector}, ${assistantSelector}`).each((_, el) => {
    const $el = $(el);
    const isUser = $el.is(userSelector);
    const $content = contentSelector ? $el.find(contentSelector).first() : $el;
    const text = normalizeText($content.length > 0 ? $content.text() : $el.text());
    if (text) messages.push({ role: isUser ? "user" : "assistant", content: text });
  });

  // ② 结果判定
  const users = messages.filter((m) => m.role === "user").length;
  const assistants = messages.length - users;
  console.log(`[rule-test] 候选规则提取：${messages.length} 条消息（user ${users} / assistant ${assistants}）`);
  if (messages.length > 0 && users > 0 && assistants > 0) {
    console.log(`[rule-test] 首条预览：${messages[0]?.role}：「${messages[0]?.content.slice(0, 60)}…」`);
    console.log("[rule-test] ✅ 消息双全——与人工核对一致即可入库");
  } else if (messages.length > 0) {
    console.log("[rule-test] ⚠️ 只提取到单侧消息（user 或 assistant 缺失）——选择器可能只命中一半，调整后重试");
  } else {
    console.log("[rule-test] ❌ 未提取到消息——选择器未命中，参考草稿 page.html 调整");
  }

  // ③ --save 入库（校验：消息双全；platform/host 必填）
  if (!save) {
    if (messages.length > 0 && users > 0 && assistants > 0) {
      console.log("[rule-test] 验证通过——加 --save 写入 .dailog-editor/rules.json（下次 fetch 生效）");
    }
    return;
  }
  if (messages.length === 0 || users === 0 || assistants === 0) {
    console.error("[rule-test] 校验未通过，不入库（红线：验证跑通才沉淀规则）");
    process.exit(1);
  }
  if (!platform) {
    console.error("[rule-test] --save 需要 --platform <平台名>（如 claude/chatgpt/deepseek）");
    process.exit(1);
  }
  // host/pathPrefix 从投稿 URL 推断
  const detail = (await api(config, `/v1/editor/submissions/${submissionId}`)) as { url: string };
  const u = new URL(detail.url);
  const pathPrefix = u.pathname.split("/").slice(0, 2).join("/") + "/"; // 分享路径段（如 /share/）

  // 写入本地规则库（存在则追加/校准，缺失则新建）
  const rulesPathLocal = rulesPath();
  let rules: Array<Record<string, unknown>> = [];
  if (existsSync(rulesPathLocal)) {
    try {
      rules = (JSON.parse(readFileSync(rulesPathLocal, "utf-8")) as { rules?: Array<Record<string, unknown>> }).rules ?? [];
    } catch { /* 损坏则重建 */ }
  }
  const entry = {
    platform,
    host: u.hostname,
    pathPrefix,
    userSelector,
    assistantSelector,
    contentSelector: contentSelector ?? null,
    note: `${new Date().toISOString().slice(0, 10)} 大模型学习沉淀（rule-test 验证通过）`,
    hits: 0,
  };
  const existing = rules.find((r) => r.platform === platform && r.host === u.hostname);
  if (existing) Object.assign(existing, entry);
  else rules.push(entry);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(rulesPathLocal, JSON.stringify({ version: 1, note: "dailog 编辑解码规则库（本地自进化）——运行时读写，无需 build", rules }, null, 2));
  console.log(`[rule-test] ✅ 规则已入库：${rulesPathLocal}`);
  console.log(`[rule-test]   ${platform} · ${u.hostname}${pathPrefix}（${userSelector} / ${assistantSelector}）`);
  console.log(`[rule-test]   下次 pnpm editor fetch ${submissionId}（或同平台投稿）自动命中`);
}
