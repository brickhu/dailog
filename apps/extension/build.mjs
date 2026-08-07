import { build } from "esbuild";
import { readFileSync, writeFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { generateIcons } from "./scripts/gen-icons.mjs";

// 图标（彩/灰两套）先于构建生成；manifest icons 与 setIcon 均引用 icons/ 相对路径
generateIcons();

// 清空上次构建产物（避免 dev/prod 切换残留旧文件，如已废弃的 dev.html）
rmSync("dist", { recursive: true, force: true });

// 环境注入：DAILOGUES_ENV=dev|prod（默认 prod），define 替换 src/env.ts 的回退默认值；
// 运行时配置由扩展配置页（options.html）编辑，存 chrome.storage，保存即生效
const env = process.env.DAILOGUES_ENV === "dev" ? "dev" : "prod";
const hosts = {
  dev: { app: "http://localhost:5173" },
  prod: { app: "https://app.dailog.fm" },
}[env];

const common = {
  bundle: true,
  outdir: "dist",
  sourcemap: true,
  target: "es2022",
  define: {
    "process.env.DAILOGUES_APP_BASE": JSON.stringify(hosts.app),
  },
};

await build({ ...common, entryPoints: ["src/content.ts"], format: "iife" });
await build({ ...common, entryPoints: ["src/content/print-emulation-main.ts"], format: "iife" });
await build({ ...common, entryPoints: ["src/background.ts"], format: "esm" });
await build({ ...common, entryPoints: ["src/popup.ts"], format: "iife" });
await build({ ...common, entryPoints: ["src/options.ts"], format: "iife" });

// manifest/popup.html/options.html 复制到 dist（load unpacked 指向 dist；manifest 内路径去掉 dist/ 前缀）
mkdirSync("dist", { recursive: true });
const manifest = readFileSync("manifest.json", "utf8")
  .replaceAll("dist/content.js", "content.js")
  .replaceAll("dist/print-emulation-main.js", "print-emulation-main.js")
  .replaceAll("dist/background.js", "background.js");
writeFileSync("dist/manifest.json", manifest);
cpSync("popup.html", "dist/popup.html");
cpSync("options.html", "dist/options.html");
cpSync("icons", "dist/icons", { recursive: true });
console.log(`extension built → dist/ (env=${env}, app=${hosts.app})`);
