// 环境变量（一套变量两端共用）：
//  - 服务端：process.env（部署环境变量）→ .env.local（本地，process.loadEnvFile）
//  - 客户端：SSR 注入的 window.__ENV__（entry-server 渲染时从服务端 env 序列化）→
//    VITE_ 变量（兼容旧配置，新部署无需再配）→ 默认值
// 站点只用 API_BASE_URL / SITE_BASE_URL / STUDIO_BASE_URL 三个变量（CF Pages/Railway
// 各环境配置一份即可）；studio（纯 SPA 无 SSR）仍用 VITE_API_BASE_URL / VITE_SITE_BASE_URL。
//
// ⚠️ 本模块同时被客户端 import——禁止 import 任何 node: 模块（vite externalize 在
// import 时即抛错）；客户端（isServer=false）不执行文件加载逻辑。

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

/** 客户端：SSR 注入的 window.__ENV__（entry-server 序列化服务端 env） */
function injectedEnv(key: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  const injected = (window as unknown as { __ENV__?: Record<string, string | undefined> }).__ENV__;
  const v = injected?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** 兼容旧配置：import.meta.env.VITE_ 变量（vite 注入；新部署无需再配） */
function viteEnv(key: string): string | undefined {
  const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[`VITE_${key}`];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export const env = {
  /** api 基址：本地 dev 8787，生产 https://api.dailog.fm */
  apiBaseUrl:
    serverEnv.API_BASE_URL ??
    injectedEnv("API_BASE_URL") ??
    viteEnv("API_BASE_URL") ??
    (import.meta.env.DEV ? "http://localhost:8787" : "https://api.dailog.fm"),
  /** 站点基址（登录回跳/绝对链接）：本地 dev 3000 */
  siteBaseUrl:
    serverEnv.SITE_BASE_URL ??
    injectedEnv("SITE_BASE_URL") ??
    viteEnv("SITE_BASE_URL") ??
    (import.meta.env.DEV ? "http://localhost:3000" : "https://dailog.fm"),
  /** studio 基址（备用登录页/回跳）：本地 dev 5173 */
  studioBaseUrl:
    serverEnv.STUDIO_BASE_URL ??
    injectedEnv("STUDIO_BASE_URL") ??
    viteEnv("STUDIO_BASE_URL") ??
    (import.meta.env.DEV ? "http://localhost:5173" : "https://app.dailog.fm"),
};

export type SiteEnv = typeof env;
