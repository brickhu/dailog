/**
 * Fish 标签工具库：单一源 assets/fish-tags.json（web 补全菜单、R3 system 注入都用这一份）。
 * 热更新：按 mtime 检测，改 JSON 即生效，不用重启。
 */
import { readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, "..", "assets", "fish-tags.json");

let cache = null;
let sig = -1;

/** 原始词表（分组 + 每组 when + tags） */
export function fishTags() {
  let m = 0;
  try { m = statSync(FILE).mtimeMs; } catch { return { note: "", groups: [] }; }
  if (cache && m === sig) return cache;
  try { cache = JSON.parse(readFileSync(FILE, "utf8")); } catch { cache = { note: "", groups: [] }; }
  sig = m;
  return cache;
}

/** 扁平列表：补全菜单用 */
export function fishTagFlat() {
  const out = [];
  for (const g of fishTags().groups || []) for (const [tag, note] of g.tags || []) out.push({ group: g.name, tag, note });
  return out;
}

/** 渲染成 system 里注入的工具库正文（只给模型看，不带 JSON 结构） */
export function toolboxText() {
  const doc = fishTags();
  const L = [];
  L.push("你现在可以使用的工具就是下面这些标记。这是工具箱，不是任务清单。");
  L.push("");
  for (const g of doc.groups || []) {
    L.push("## " + g.name);
    L.push("");
    if (g.when) { L.push(g.when); L.push(""); }
    L.push((g.tags || []).map(([t, n]) => (n ? `[${t}] ${n}` : `[${t}]`)).join(" · "));
    L.push("");
  }
  return L.join("\n").trimEnd();
}
