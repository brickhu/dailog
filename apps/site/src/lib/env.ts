// 环境变量（site 全部用 VITE_ 一套，构建期注入、两端共用）：
//  - 客户端：import.meta.env.VITE_*（vite 注入）
//  - 服务端（代理转发）：import.meta.env.VITE_*（构建期替换成字面量，workerd 运行时无需 env）
//  - 兼容：process.env.API_BASE_URL 等旧部署变量仍可兜底（新部署统一 VITE_）
// admin（纯 SPA）同样用 VITE_API_BASE_URL / VITE_SITE_BASE_URL——两端变量名完全一致。
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
  /** 浏览器端音频/公开资源基址：本地容器内 node fetch 用 http（自签证书不可信）、浏览器音频用 https（mixed content 拦截）；
   *  未配置时与 apiBaseUrl 一致（宿主直跑/生产） */
  apiBaseUrlPublic:
    viteEnv("VITE_PUBLIC_API_BASE_URL") ??
    serverEnv.PUBLIC_API_BASE_URL ??
    null,
  /** 站点基址（登录回跳/绝对链接/代理 Origin）：本地 dev 3000 */
  siteBaseUrl:
    viteEnv("VITE_SITE_BASE_URL") ??
    serverEnv.SITE_BASE_URL ??
    (import.meta.env.DEV ? "http://localhost:3000" : "https://dailog.fm"),
};

/** 节目封面 URL：R2 key（covers/ 前缀）→ 公开端点；外链（历史 Pexels 数据）→ 直用 */
export function episodeCoverUrl(id: string, coverUrl: string | null | undefined): string | null {
  if (!coverUrl) return null;
  if (coverUrl.startsWith("covers/")) {
    return `${env.apiBaseUrlPublic ?? env.apiBaseUrl}/v1/public/episodes/${id}/cover`;
  }
  return coverUrl;
}

export type SiteEnv = typeof env;

/** 数据 fetch 基址：服务端 node fetch 必须 http（OrbStack 自签证书不被信任），直连 API；
 *  浏览器端返回空串 → 走同源相对路径（site 的 /v1/* 代理转发到 API）——
 *  避免浏览器跨域直连 API 被 CORS 拦截（local 8787 白名单不含 localhost:3000，生产同理） */
export const apiBaseForFetch = typeof window === "undefined" ? env.apiBaseUrl : "";

