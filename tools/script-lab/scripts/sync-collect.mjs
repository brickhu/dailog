// 从 CLI 编译产物重新生成 lab 自包含采集模块（防止双份逻辑漂移）：
//   改完 tools/dailog-cli/src/fetch.ts → pnpm --filter @dailogues/dailog-cli build
//   → node tools/script-lab/scripts/sync-collect.mjs
// 生成：tools/script-lab/lib/collect.mjs + assets/rules.json（种子同步）
// CLI 正式退役后：删除 tools/dailog-cli/src/fetch.ts 等，本脚本退役，collect.mjs 转为唯一来源。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const lab = join(here, "..");
const cliDist = join(here, "..", "..", "dailog-cli", "dist");
const srcPath = join(cliDist, "fetch.js");
if (!existsSync(srcPath)) {
  console.error("[sync-collect] 缺少 CLI 产物 " + srcPath + "——先执行：pnpm --filter @dailogues/dailog-cli build");
  process.exit(1);
}
let src = readFileSync(srcPath, "utf8");

src = src.replace('import { join } from "node:path";',
  'import { dirname, join } from "node:path";\nimport { fileURLToPath } from "node:url";');
const shims = [
  "// —— lab 本地接线（替代 CLI lib.js 依赖）——",
  "const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');",
  "const LAB_ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');",
  "function rulesPath() { return join(REPO_ROOT, '.dailog-editor', 'rules.json'); }",
  "function defaultAssetsDir() { return LAB_ASSETS_DIR; }",
  "function draftDir(submissionId) { return join(osTmpdir(), 'dailog-lab-drafts', String(submissionId ?? 'lab')); }",
  "function api() { throw new Error('[collect] 采集不经服务端详情——请用 collectDialogue(url, { title })'); }",
].join("\n");
src = src.replace('import { api, defaultAssetsDir, draftDir, rulesPath } from "./lib.js";', shims);

const iStart = src.indexOf("async function extractSubmission(");
const sigEnd = src.indexOf("\n", iStart);
const dirMark = src.indexOf("  const dir = draftDir(submissionId);", sigEnd);
const platformMark = src.indexOf("  const platform = detectPlatform(url);", dirMark);
const apiBranch = src.indexOf("  if (platform?.api) {", platformMark);
if (iStart < 0 || dirMark < 0 || platformMark < 0 || apiBranch < 0) {
  console.error("[sync-collect] CLI fetch.js 结构变化，同步中止（需人工移植）");
  process.exit(1);
}
const newHead = "export async function collectDialogue(url, { title = null } = {}) {";
const newMid = "  if (!url || typeof url !== 'string') return { ok: false, error: '投稿 URL 缺失' };\n  const platform = detectPlatform(url);\n";
src = src.slice(0, iStart) + newHead + src.slice(sigEnd);
const nSigEnd = src.indexOf("\n", iStart);
const nApiBranch = src.indexOf("  if (platform?.api) {", nSigEnd + newHead.length);
src = src.slice(0, nSigEnd + 1) + newMid + src.slice(nApiBranch);

const subs = [
  ["title: detail.title", "title: title || null"],
  ["extractGemini(config, submissionId, url, detail.title, tokenOverride)", "extractGemini(null, null, url, title || null, null)"],
  ["extractGrok(config, submissionId, url, detail.title, tokenOverride)", "extractGrok(null, null, url, title || null, null)"],
  ["const pageTitle = extractPageTitle(html) || detail.title;", "const pageTitle = extractPageTitle(html) || title || null;"],
];
for (const [a, b] of subs) {
  if (!src.includes(a)) { console.error("[sync-collect] 替换目标缺失: " + a.slice(0, 60) + "（结构变化，需人工移植）"); process.exit(1); }
  src = src.split(a).join(b);
}
const iFetch = src.indexOf("async function fetchPage(");
const iExp = src.indexOf("export {");
if (iFetch < 0 || iExp < 0) { console.error("[sync-collect] fetchPage/export 锚点缺失"); process.exit(1); }
src = src.slice(0, iFetch) + src.slice(iExp);
const expOld = [
  "export {",
  "  decodeStreamTable,",
  "  extractGeminiByRule,",
  "  extractGrokByRule,",
  "  extractSubmission,",
  "  fetchPage,",
  "  findSocksProxy,",
  "  messagesFromChatgptStream,",
  "  resolveGeminiCanonical",
  "};",
].join("\n");
const expNew = [
  "export {",
  "  decodeStreamTable,",
  "  extractGeminiByRule,",
  "  extractGrokByRule,",
  "  findSocksProxy,",
  "  messagesFromChatgptStream,",
  "  resolveGeminiCanonical",
  "};",
].join("\n");
if (!src.includes(expOld)) { console.error("[sync-collect] 导出表结构变化，需人工调整"); process.exit(1); }
src = src.split(expOld).join(expNew);

const banner = [
  "// lab 自包含采集模块（原始对话内容采集——不依赖 tools/dailog-cli）",
  "// 来源：tools/dailog-cli/src/fetch.ts 编译产物的移植（CLI 源码保留，待退役后删除）。",
  "// 由 tools/script-lab/scripts/sync-collect.mjs 生成——改动请改 CLI 源后重新同步，勿手改本文件。",
  "// 与 CLI 版的差异仅接线层，采集逻辑同源：",
  "//   · 不经投稿详情服务端 API——lab 已持有 url/title，用 collectDialogue(url, { title }) 直取；",
  "//   · 运行时规则共用 <repo>/.dailog-editor/rules.json（自进化读写）；种子随 lab 分发 assets/rules.json；",
  "//   · 平台逆向知识（deepseek/doubao API、chatgpt SSR、gemini/grok Chromium、规则+嗅探）与 CLI 版一致。",
  "",
].join("\n");
src = banner + src;
writeFileSync(join(lab, "lib", "collect.mjs"), src);

// 规则种子同步
mkdirSync(join(lab, "assets"), { recursive: true });
writeFileSync(join(lab, "assets", "rules.json"), readFileSync(join(cliDist, "..", "assets", "rules.json"), "utf8"));
console.log("[sync-collect] 已生成 tools/script-lab/lib/collect.mjs + assets/rules.json（来自 CLI 产物）");
