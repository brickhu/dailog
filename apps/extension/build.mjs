import { build } from "esbuild";
import { readFileSync, writeFileSync, cpSync, mkdirSync } from "node:fs";

// 环境注入：DAILOGUES_ENV=dev|prod（默认 prod），define 替换 src/env.ts 的默认值
const env = process.env.DAILOGUES_ENV === "dev" ? "dev" : "prod";
const hosts = {
  dev: { api: "https://api.candelbot.app", app: "https://app.candelbot.app" },
  prod: { api: "https://api.dailog.fm", app: "https://app.dailog.fm" },
}[env];

const common = {
  bundle: true,
  outdir: "dist",
  sourcemap: true,
  target: "es2022",
  define: {
    "process.env.DAILOGUES_API_BASE": JSON.stringify(hosts.api),
    "process.env.DAILOGUES_APP_BASE": JSON.stringify(hosts.app),
  },
};

await build({ ...common, entryPoints: ["src/content.ts"], format: "iife" });
await build({ ...common, entryPoints: ["src/background.ts"], format: "esm" });
await build({ ...common, entryPoints: ["src/popup.ts"], format: "iife" });

// manifest/popup.html 复制到 dist（load unpacked 指向 dist；manifest 内路径去掉 dist/ 前缀）
mkdirSync("dist", { recursive: true });
const manifest = readFileSync("manifest.json", "utf8")
  .replaceAll("dist/content.js", "content.js")
  .replaceAll("dist/background.js", "background.js");
writeFileSync("dist/manifest.json", manifest);
cpSync("popup.html", "dist/popup.html");
console.log(`extension built → dist/ (env=${env}, api=${hosts.api})`);
