// dailog-editor 子工程构建（skill 壳）：CLI 能力（tools/dailog-cli）+ skill 专属（src/）+ SKILL 文档 → 产物
//   · scripts/*.js：CLI 底座提供能力命令（list/fetch/tts/merge/cover/publish 等，不管理 token）；
//     skill 专属（src/：run.ts 入口 / session.ts token 管理 / login / auth-status）同样编译进产物——
//     token 管理归 skill（session.json 读写），CLI 底座仅接受 setApiToken 注入
//   · SKILL.md / docs / prompts / reference / templates / assets：复制到产物
// 用法：pnpm --filter @dailogues/dailog-editor build
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliSrcDir = join(here, "..", "dailog-cli", "src");
const skillSrcDir = join(here, "src");
const outDir = join(here, "..", "..", ".agents", "skills", "dailog-editor");
const scriptsDir = join(outDir, "scripts");

// 0. 清空产物 scripts（旧文件随源码删除同步移除，避免残留）
rmSync(scriptsDir, { recursive: true, force: true });
mkdirSync(scriptsDir, { recursive: true });

// 1. 编译 CLI 能力 src + skill 专属 src → 产物 scripts/*.js（逐文件，不 bundle）
//    run.ts 只在 skill src（CLI 无 run）；同名文件 skill 优先（后编译覆盖）
const cliEntries = readdirSync(cliSrcDir).filter((f) => f.endsWith(".ts")).map((f) => join(cliSrcDir, f));
const skillEntries = readdirSync(skillSrcDir).filter((f) => f.endsWith(".ts")).map((f) => join(skillSrcDir, f));
// 先编译 CLI（能力），再编译 skill（专属 + 覆盖 run 等）——esbuild 同名输出后写覆盖
await build({
  entryPoints: cliEntries,
  outdir: scriptsDir,
  bundle: false,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "warning",
});
await build({
  entryPoints: skillEntries,
  outdir: scriptsDir,
  bundle: false,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "warning",
});

// 2. 产物脚本入口说明（shebang 提示 + 构建产物标记 + ESM 类型声明）
const { writeFileSync } = await import("node:fs");
writeFileSync(join(scriptsDir, "package.json"), JSON.stringify({ name: "dailog-editor-scripts", private: true, type: "module" }, null, 2) + "\n");
writeFileSync(join(scriptsDir, "README.md"), [
  "# dailog-editor 产物脚本（构建生成，勿手改）",
  "",
  "源码（共享底座）在 `tools/dailog-cli/src/`；重新构建：`pnpm --filter @dailogues/dailog-editor build`",
  "运行：`node .agents/skills/dailog-editor/scripts/run.js <cmd>`（根命令 `pnpm editor`）",
  "",
].join("\n"));
writeFileSync(join(scriptsDir, "package.json"), JSON.stringify({ name: "dailog-editor-scripts", private: true, type: "module" }, null, 2) + "\n");

// 3. skill 文档与配置模板
cpSync(join(here, "skill", "SKILL.md"), join(outDir, "SKILL.md"));
// 3.0 分册文档（能力/附录独立分册，随产物分发；与 reference/、prompts/ 同级，SKILL.md 按 docs/*.md 引用）
const docsSrc = join(here, "docs");
const docsOut = join(outDir, "docs");
rmSync(docsOut, { recursive: true, force: true });
mkdirSync(docsOut, { recursive: true });
for (const f of readdirSync(docsSrc)) {
  cpSync(join(docsSrc, f), join(docsOut, f));
}
// 3.1 提示词模板（脚本生成参照文件）
const promptsSrc = join(here, "prompts");
const promptsOut = join(outDir, "prompts");
mkdirSync(promptsOut, { recursive: true });
for (const f of readdirSync(promptsSrc)) {
  cpSync(join(promptsSrc, f), join(promptsOut, f));
}
// 3.2 参考文档（深度参考，随产物分发）
const refSrc = join(here, "reference");
const refOut = join(outDir, "reference");
mkdirSync(refOut, { recursive: true });
for (const f of readdirSync(refSrc)) {
  cpSync(join(refSrc, f), join(refOut, f));
}
cpSync(join(here, "templates", "envs.example.json"), join(outDir, "envs.example.json"));
cpSync(join(here, "templates", "env.example"), join(outDir, "env.example"));

// 4. 资源文件（intro/outro/guest 品牌声线，随产物分发；运行时从产物 assets/ 定位）
//    先清空产物 assets（旧语言专属文件不随源码删除会残留，且会遮蔽通用 intro.mp3 fallback）
const assetsSrc = join(here, "assets");
const assetsOut = join(outDir, "assets");
rmSync(assetsOut, { recursive: true, force: true });
if (existsSync(assetsSrc)) {
  mkdirSync(assetsOut, { recursive: true });
  for (const f of readdirSync(assetsSrc)) {
    cpSync(join(assetsSrc, f), join(assetsOut, f));
  }
  console.log(`[build]   assets/（${readdirSync(assetsSrc).length} 个资源文件）`);
}

console.log(`[build] 产物已生成：${outDir}/`);
console.log(`[build]   scripts/*.js（${cliEntries.length + skillEntries.length} 个）、SKILL.md、envs.example.json、env.example`);
console.log(`[build] 根命令：pnpm editor <cmd>（node .agents/skills/dailog-editor/scripts/run.js）`);
