// 环境变量（site 全部用 VITE_ 一套，构建期注入、两端共用）：
//  - 客户端：import.meta.env.VITE_*（vite 注入）
//  - 服务端（代理转发）：import.meta.env.VITE_*（构建期替换成字面量，workerd 运行时无需 env）
//  - 兼容：process.env.API_BASE_URL 等旧部署变量仍可兜底（新部署统一 VITE_）
// studio（纯 SPA）同样用 VITE_API_BASE_URL / VITE_SITE_BASE_URL——两端变量名完全一致。
//
// ⚠️ 本模块同时被客户端 import——禁止 import 任何 node: 模块（vite externalize 在
// import 时即抛错）；客户端（isServer=false）不访问 process。

const isServer = typeof process !== "undefined" && typeof process.versions?.node === "string";
const serverEnv = isServer ? (process.env as Record<string, string | undefined>) : {};

function viteEnv(key: string): string | undefined {
  const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export const env = {
  /** api 基址：本地 dev 8787，生产 https://api.dailog.fm */
  apiBaseUrl:
    viteEnv("VITE_API_BASE_URL") ??
    serverEnv.API_BASE_URL ??
    (import.meta.env.DEV ? "http://localhost:8787" : "https://api.dailog.fm"),
  /** 站点基址（登录回跳/绝对链接/代理 Origin）：本地 dev 3000 */
  siteBaseUrl:
    viteEnv("VITE_SITE_BASE_URL") ??
    serverEnv.SITE_BASE_URL ??
    (import.meta.env.DEV ? "http://localhost:3000" : "https://dailog.fm"),
  /** studio 基址（备用登录页/回跳）：本地 dev 5173 */
  studioBaseUrl:
    viteEnv("VITE_STUDIO_BASE_URL") ??
    serverEnv.STUDIO_BASE_URL ??
    (import.meta.env.DEV ? "http://localhost:5173" : "https://app.dailog.fm"),
};

export type SiteEnv = typeof env;
