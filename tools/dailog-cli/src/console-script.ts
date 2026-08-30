// 浏览器控制台兜底脚本生成（反爬终极方案——用户自己的浏览器已过 CF 挑战）：
//   pnpm editor console-script <submissionId>
//   → 打开分享页（用户浏览器）→ F12 Console → 粘贴运行
//   → 脚本提取对话消息 JSON → 自动复制到剪贴板 → 用户粘贴回对话
//   → pnpm editor paste <submissionId> 入库（草稿 dialogue.json）→ 继续管线
// 脚本策略：本地规则命中（.dailog-editor/rules.json）→ 内联规则选择器精确提取；
//           无规则 → 通用启发式（data-message-author-role / data-testid 多套尝试）
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { api, defaultAssetsDir, rulesPath } from "./lib.js";

interface DecodeRule {
  platform: string;
  host: string;
  pathPrefix?: string;
  userSelector: string;
  assistantSelector: string;
  contentSelector?: string | null;
  /** 角色专属正文容器（优先于 contentSelector；Gemini 等两端结构不同的平台用） */
  userContentSelector?: string | null;
  assistantContentSelector?: string | null;
  note?: string;
}

function loadRules(): DecodeRule[] {
  for (const p of [rulesPath(), join(defaultAssetsDir(), "rules.json")]) {
    if (existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, "utf-8")) as { rules?: DecodeRule[] } | null;
        if (Array.isArray(data?.rules)) return data.rules;
      } catch { /* 尝试下一个 */ }
    }
  }
  return [];
}

function matchRule(rules: DecodeRule[], url: string): DecodeRule | null {
  try {
    const u = new URL(url);
    return rules.find((r) => {
      if (r.host && u.hostname !== r.host && !u.hostname.endsWith(`.${r.host}`)) return false;
      if (r.pathPrefix && !u.pathname.startsWith(r.pathPrefix)) return false;
      return true;
    }) ?? null;
  } catch {
    return null;
  }
}

/** 生成控制台脚本（模板字符串；注意 JS 字符串转义） */
function buildScript(rule: DecodeRule | null): string {
  const ruleBlock = rule
    ? `
  // 规则（${rule.platform}）：${rule.userSelector} / ${rule.assistantSelector}
  const userSelector = ${JSON.stringify(rule.userSelector)};
  const assistantSelector = ${JSON.stringify(rule.assistantSelector)};
  const contentSelector = ${JSON.stringify(rule.contentSelector ?? null)};
  const userContentSelector = ${JSON.stringify(rule.userContentSelector ?? null)};
  const assistantContentSelector = ${JSON.stringify(rule.assistantContentSelector ?? null)};
  const pickContent = (el, sel) => {
    if (!sel) return null;
    const nodes = el.querySelectorAll(sel);
    if (nodes.length === 0) return null;
    return [...nodes].map((n) => n.innerText).join("\\n");
  };
  document.querySelectorAll(userSelector + ", " + assistantSelector).forEach((el) => {
    const role = el.matches(userSelector) ? "user" : "assistant";
    const perRoleSel = role === "user" ? userContentSelector : assistantContentSelector;
    const contentEl = perRoleSel ? pickContent(el, perRoleSel) : (contentSelector ? pickContent(el, contentSelector) : null);
    const text = (contentEl ?? el.innerText).replace(/[ \\t]+/g, " ").replace(/\\n{3,}/g, "\\n\\n").trim();
    if (text) messages.push({ role, content: text });
  });`
    : `
  // 通用启发式：多套角色标识尝试
  // ① data-message-author-role（chatgpt/doubao 系）
  document.querySelectorAll("[data-message-author-role]").forEach((el) => {
    const role = el.getAttribute("data-message-author-role");
    if (role !== "user" && role !== "assistant") return;
    const contentEl = el.querySelector(".markdown, .markdown-body, .ds-markdown, [class*='markdown']") || el;
    const text = contentEl.innerText.replace(/[ \\t]+/g, " ").replace(/\\n{3,}/g, "\\n\\n").trim();
    if (text) messages.push({ role, content: text });
  });
  // ② data-testid（claude 系：user-message / assistant-message）
  if (messages.length === 0) {
    document.querySelectorAll("[data-testid='user-message'], [data-testid='assistant-message']").forEach((el) => {
      const role = el.getAttribute("data-testid") === "user-message" ? "user" : "assistant";
      const contentEl = el.querySelector(".content, .markdown, [class*='content']") || el;
      const text = contentEl.innerText.replace(/[ \\t]+/g, " ").replace(/\\n{3,}/g, "\\n\\n").trim();
      if (text) messages.push({ role, content: text });
    });
  }`;
  return `(() => {
  // dailog 对话提取（浏览器控制台）——运行后自动复制 JSON 到剪贴板
  const messages = [];${ruleBlock}
  // 提示：若消息不全，先滚动页面到底（长对话懒加载）再重新运行
  const users = messages.filter((m) => m.role === "user").length;
  console.log("dailog 提取：" + messages.length + " 条消息（user " + users + " / assistant " + (messages.length - users) + "）");
  if (messages.length === 0 || users === 0 || messages.length === users) {
    console.error("消息不全（需要 user 与 assistant 双全）——滚动到底部重试，或调整选择器");
    return;
  }
  const json = JSON.stringify({ source: "browser-console", messages }, null, 2);
  console.log(json);
  navigator.clipboard.writeText(json)
    .then(() => console.log("✅ 已复制到剪贴板——粘贴回 Agent 对话框（pnpm editor paste <submissionId>）"))
    .catch(() => console.log("复制失败（非安全上下文？）——手动全选上方 JSON 复制"));
})();`;
}

export async function consoleScript(config: EditorConfig, args: string[]): Promise<void> {
  const submissionId = args[0];
  if (!submissionId) {
    console.error("用法：pnpm editor console-script <submissionId>");
    process.exit(1);
  }
  const detail = (await api(config, `/v1/editor/submissions/${submissionId}`)) as { url: string };
  const rule = matchRule(loadRules(), detail.url);

  console.log(`[console-script] 投稿 URL：${detail.url}`);
  console.log(`[console-script] 规则：${rule ? `${rule.platform}（内联选择器）` : "无（通用启发式）"}`);
  console.log("\n使用步骤：");
  console.log("  ① 在浏览器打开分享页（已登录/已过 CF 挑战）");
  console.log("  ② F12 → Console → 粘贴下面的脚本 → 回车");
  console.log("  ③ 脚本自动复制 JSON 到剪贴板 → 粘贴回本对话");
  console.log("  ④ 终端执行：pnpm editor paste <submissionId>\n");
  console.log("────────── 脚本开始（复制下面全部）──────────");
  console.log(buildScript(rule));
  console.log("────────── 脚本结束 ──────────");
}
