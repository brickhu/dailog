// server 端环境（读 .env.local / 部署环境变量）。
// 注意：vinxi dev 不自动加载 .env 文件（vite 只注入 VITE_ 前缀到客户端），
// 服务端 process.env 拿不到 .env.local 的值——这里用 process.loadEnvFile()
// （node 20.12+ 内置）加载兜底；生产（CF Pages）无 .env.local 文件，直接用 process.env。
//
// ⚠️ 本模块同时被客户端 import（login 等页面用 siteBaseUrl）——禁止 import 任何
// node: 模块（vite 的 externalize 在 import 时即抛错，静态 import 就是雷）：
// 客户端（isServer=false）不执行加载逻辑，走 VITE_ 变量（vite 注入）。

const isServer = typeof process !== "undefined" && typeof process.versions?.node === "string";

// 服务端：把 .env.local 注入 process.env（幂等；无文件/低版本 node 静默跳过）
if (isServer) {
  try {
    process.loadEnvFile?.(".env.local");
  } catch {
    // 文件不存在或版本不支持：env 由部署环境变量提供
  }
}

const serverEnv = isServer ? (process.env as Record<string, string | undefined>) : {};

const viteEnv = (key: string): string | undefined => {
  const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
};

export const env = {
  /** api 基址：本地 dev 8787，生产 https://api.dailog.fm */
  apiBaseUrl:
    serverEnv.API_BASE_URL ??
    viteEnv("VITE_API_BASE_URL") ??
    (import.meta.env.DEV ? "http://localhost:8787" : "https://api.dailog.fm"),
  /** 站点基址（登录回跳/绝对链接）：本地 dev 3000 */
  siteBaseUrl:
    serverEnv.SITE_BASE_URL ??
    viteEnv("VITE_SITE_BASE_URL") ??
    (import.meta.env.DEV ? "http://localhost:3000" : "https://dailog.fm"),
  /** studio 基址（备用登录页/回跳）：本地 dev 5173 */
  studioBaseUrl:
    serverEnv.STUDIO_BASE_URL ??
    viteEnv("VITE_STUDIO_BASE_URL") ??
    (import.meta.env.DEV ? "http://localhost:5173" : "https://app.dailog.fm"),
};

export type SiteEnv = typeof env;
