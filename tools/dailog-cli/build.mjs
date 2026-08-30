// dailog-cli 构建：共享 CLI 底座（skill 与 script-lab 共用）
//   src/*.ts → dist/*.js（esbuild 逐文件，ESM；依赖从仓库根 node_modules 解析）
//   产物位置：tools/dailog-cli/dist/；assets/ 随工程分发（defaultAssetsDir 基于入口定位）
// 用法：pnpm --filter @dailogues/dailog-cli build
import { build } from "esbuild";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "src");
const outDir = join(here, "dist");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const entries = readdirSync(srcDir).filter((f) => f.endsWith(".ts")).map((f) => join(srcDir, f));
await build({
  entryPoints: entries,
  outdir: outDir,
  bundle: false,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "info",
});

writeFileSync(join(outDir, "package.json"), JSON.stringify({ name: "dailog-cli-dist", private: true, type: "module" }, null, 2) + "\n");
writeFileSync(join(outDir, "README.md"), [
  "# dailog-cli 产物（构建生成，勿手改）",
  "",
  "源码在 `tools/dailog-cli/src/`；重新构建：`pnpm --filter @dailogues/dailog-cli build`",
  "运行：`node tools/dailog-cli/dist/run.js <cmd>`（根命令 `pnpm editor` 经 skill 产物）",
  "",
].join("\n"));
console.log(`[build] 产物已生成：${outDir}/（${entries.length} 个文件）`);
