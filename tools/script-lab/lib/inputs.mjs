// 通用输入：任意提示词文件（.mjs 模块 / .md 文本）+ 任意输入文件 → 用户消息
import { readFileSync, existsSync } from "node:fs";
import { join, isAbsolute, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { toolDir } from "./config.mjs";

/** 按点路径取子值（支持数组下标：messages.0.content）；路径不存在 → undefined */
export function getByPath(value, path) {
  if (!path) return value;
  let cur = value;
  for (const seg of String(path).split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && String(Number(seg)) === seg) cur = cur[Number(seg)];
    else cur = cur[seg];
  }
  return cur;
}

/** 读取输入文件：JSON（对象/数组/原始值）→ parsed + 美化文本；非 JSON → 原样文本；
 *  label 为可选标签（信封 key / 段落标题）；extract 为可选点路径（如 messages）——从 JSON 里抠出该子值 */
export function loadInputFile(path, label = null, extract = null) {
  const raw = readFileSync(path, "utf-8");
  let content = raw;
  let parsed;
  try {
    parsed = JSON.parse(raw);
    content = JSON.stringify(parsed, null, 1);
  } catch {
    /* 非 JSON，保留原文 */
  }
  if (extract && parsed !== undefined) {
    const sub = getByPath(parsed, extract);
    if (sub === undefined) {
      console.warn("[script-lab] ⚠️ --extract 路径不存在：" + extract + "（输入 " + path + "）——保留原值");
    } else {
      parsed = sub;
      content = JSON.stringify(sub, null, 1);
    }
  }
  return { path, content, label, parsed };
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** 动态加载 .mjs/.js 提示词模块：default 导出（字符串）+ 可选 config 导出（本环节 LLM 配置） */
async function loadJsPrompt(path) {
  const mod = await import(pathToFileURL(path).href);
  const content = typeof mod.default === "string" ? mod.default : mod.prompt ?? mod.system;
  if (typeof content !== "string") {
    throw new Error("[script-lab] 提示词模块需默认导出字符串（export default ）：" + path);
  }
  const moduleConfig = mod.config && typeof mod.config === "object" ? mod.config : {};
  return { path, content, moduleConfig };
}

/**
 * 解析提示词（异步）：
 *   - 名称（如 selection / draft / meta / 自定义）→ 优先 prompts/<名称>.mjs，回退 prompts/<名称>.md
 *   - 路径（含 / 或 .md/.mjs/.js 结尾）→ .mjs/.js 动态 import；.md 读原文
 */
export async function resolvePrompt(nameOrPath) {
  let path = nameOrPath;
  const pathLike =
    isAbsolute(path) || path.includes("/") ||
    path.endsWith(".md") || path.endsWith(".mjs") || path.endsWith(".js");
  if (!pathLike) {
    // ① prompts.json（.dailog-editor）按名称取——权威存储（webui 编辑 + R2 同步）
    const cfgJson = join(toolDir, "..", "..", ".dailog-editor", "prompts.json");
    try {
      const j = JSON.parse(readFileSync(cfgJson, "utf-8"));
      if (typeof j[nameOrPath] === "string") {
        return { path: cfgJson + "#" + nameOrPath, content: j[nameOrPath], moduleConfig: {} };
      }
    } catch { /* json 缺失走 fallback */ }
    // ② .dailog-editor/prompts/*.mjs|.md（产物副本）
    const cfgDir = join(toolDir, "..", "..", ".dailog-editor", "prompts");
    const candJs = join(cfgDir, nameOrPath + ".mjs");
    const candMd = join(cfgDir, nameOrPath + ".md");
    if (existsSync(candJs)) path = candJs;
    else if (existsSync(candMd)) path = candMd;
    else {
      // ③ 工程内保底稿
      const legacyJs = join(toolDir, "prompts", nameOrPath + ".mjs");
      const legacyMd = join(toolDir, "prompts", nameOrPath + ".md");
      if (existsSync(legacyJs)) path = legacyJs;
      else if (existsSync(legacyMd)) path = legacyMd;
    }
  }
  if (!existsSync(path)) {
    throw new Error(
      "[script-lab] 提示词不存在：" + path + "\n" +
      "  提示词在 .dailog-editor/prompts.json（selection / polish / meta）或 .dailog-editor/prompts/ 下，或传 .md/.mjs 文件路径"
    );
  }
  if (path.endsWith(".mjs") || path.endsWith(".js")) return loadJsPrompt(path);
  return { path, content: readFileSync(path, "utf-8"), moduleConfig: {} };
}

/**
 * 拼装用户消息（JSON key 指针约定）：
 *   · JSON 输入 + --as <key> → 包成 envelope[key]（任意 JSON 形态都可以，指针即 key）
 *   · JSON 对象输入无 --as → 顶层合并进 envelope（后者覆盖同名 key）
 *   · JSON 数组/原始值、文本输入无 --as → 按 "## 文件名" 段落追加（--as 则作为段落标题）
 *   · 仅 JSON 时 user 消息就是 envelope 本身；混有段落时 JSON 加语义标题
 *   · 末尾追加 --note 附加指令（自动说明由 run.mjs 追加）
 */
export function buildUserMessage(inputs, note = null) {
  const merged = {};
  const wrapped = [];
  const sections = [];
  for (const inp of inputs) {
    const hasLabel = !!(inp.label && inp.label.trim());
    if (inp.parsed !== undefined) {
      if (hasLabel) wrapped.push({ key: inp.label.trim(), value: inp.parsed });
      else if (isPlainObject(inp.parsed)) Object.assign(merged, inp.parsed);
      else sections.push(inp);
    } else {
      sections.push(inp);
    }
  }
  const envelope = Object.assign({}, merged);
  for (const w of wrapped) envelope[w.key] = w.value;

  const parts = [];
  const envKeys = Object.keys(envelope);
  if (envKeys.length > 0) {
    const json = JSON.stringify(envelope, null, 1);
    parts.push(sections.length > 0 ? "## 输入 JSON（按 key 取用）\n" + json : json);
  }
  for (const inp of sections) {
    const title = (inp.label && inp.label.trim()) || basename(inp.path);
    parts.push("## " + title + "\n" + inp.content);
  }
  if (note) {
    parts.push("## 附加指令（仅本次调用）\n" + note);
  }
  return parts.join("\n\n");
}
