import { build } from "esbuild";

const common = { bundle: true, outdir: "dist", sourcemap: true, target: "es2022" };

await build({ ...common, entryPoints: ["src/content.ts"], format: "iife" });
await build({ ...common, entryPoints: ["src/background.ts"], format: "esm" });
await build({ ...common, entryPoints: ["src/popup.ts"], format: "iife" });
console.log("extension built → dist/");
