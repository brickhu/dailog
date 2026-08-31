// 提示词字典（prompts/prompts.json 目录文件 + 同目录 .md 正文）——工程文件，git 随源码备份，支持热更新（mtime 检测）
// prompts.json 结构：{ "<label>": { label, version, description, config, params, messages[{role, file}] }, ... }
//   - messages[].file 指向同目录 {label}.{role}.md（提示词正文，纯文本编辑）；content 可含 {{占位符}}
//   - params 声明占位符白名单；config 承载模型参数（temperature/maxTokens/thinking）
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const PROMPTS_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "prompts");
const INDEX_FILE = join(PROMPTS_DIR, "prompts.json");

const cache = new Map();   // label → { sig, data }

function mtimeOf(file) { try { return statSync(file).mtimeMs; } catch { return 0; } }

/** 读字典目录文件（热更新：mtime 检测） */
function loadIndex() {
  const sig = mtimeOf(INDEX_FILE);
  const hit = cache.get("__index__");
  if (hit && hit.sig === sig) return hit.data;
  let data;
  try { data = JSON.parse(readFileSync(INDEX_FILE, "utf8")); }
  catch (err) { throw new Error("提示词字典目录解析失败: " + err.message); }
  if (!data || typeof data !== "object") throw new Error("提示词字典目录必须是对象");
  cache.set("__index__", { sig, data });
  return data;
}

/** 读字典：索引基于 prompts.json 的对象 key（不依赖条目内部字段）；+ md 正文；改目录或任一 md 后热更新重读 */
export function getPrompt(key) {
  const index = loadIndex();
  const entry = index[key];
  if (!entry) throw new Error("提示词字典不存在: " + key + "（prompts.json 中无此 key）");
  const name = entry.name || key;   // 条目 name 仅作展示/描述，索引始终用 key
  const msgs = (entry.messages || []).map(m => {
    const file = m.file || (key + "." + m.role + ".md");
    const f = join(PROMPTS_DIR, file);
    if (!mtimeOf(f)) throw new Error("提示词正文文件不存在: " + file + "（" + name + "）");
    return { role: m.role, file, content: readFileSync(f, "utf8") };
  });
  const sig = mtimeOf(INDEX_FILE) + ":" + msgs.map(m => mtimeOf(join(PROMPTS_DIR, m.file))).join(",");
  const hit = cache.get(key);
  if (hit && hit.sig === sig) return hit.data;
  const out = { ...entry, name, key, messages: msgs };
  validate(out);
  cache.set(key, { sig, data: out });
  return out;
}

/** 清缓存（测试/调试用） */
export function clearPromptCache() { cache.clear(); }

/** 列出所有字典 label（供调试/设置页只读展示） */
export function listPrompts() {
  return Object.keys(loadIndex()).sort();
}

/** 渲染：把 messages 里的 {{占位符}} 按 params 注入（白名单：仅替换 params 声明过的变量，未提供则替换为空串） */
export function renderPrompt(prompt, values = {}) {
  const allowed = new Set(Object.keys(prompt.params || {}));
  return (prompt.messages || []).map(m => ({
    role: m.role,
    content: String(m.content || "").replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (!allowed.has(key)) throw new Error("提示词占位符未在 params 声明: {{" + key + "}}（" + (prompt.name || prompt.key) + "）");
      const v = values[key];
      return v === undefined || v === null ? "" : (typeof v === "string" ? v : JSON.stringify(v, null, 1));
    }),
  }));
}

/** 合并 config：字典默认值 + 运行时覆盖 */
export function promptConfig(prompt, override = {}) {
  return { ...(prompt.config || {}), ...override };
}

function validate(entry) {
  if (!Array.isArray(entry.messages) || entry.messages.length === 0) throw new Error("提示词字典缺 messages: " + (entry.name || entry.key || "?"));
  for (const m of entry.messages) {
    if (!m || typeof m.role !== "string" || typeof m.file !== "string") {
      throw new Error("提示词字典 messages 结构错误（需 {role, file}）: " + (entry.name || entry.key || "?"));
    }
  }
  if (entry.params && typeof entry.params !== "object") throw new Error("提示词字典 params 必须是对象: " + (entry.name || entry.key || "?"));
}
