// server 端环境（读 .env.local / 部署环境变量）
export const env = {
  /** api 基址：本地 dev 8787，生产 https://api.dailogues.com */
  apiBaseUrl: process.env.API_BASE_URL ?? (process.env.NODE_ENV === "production" ? "https://api.dailogues.com" : "http://localhost:8787"),
  /** 站点基址（登录回跳/绝对链接）：本地 dev 3000 */
  siteBaseUrl: process.env.SITE_BASE_URL ?? (process.env.NODE_ENV === "production" ? "https://dailogues.com" : "http://localhost:3000"),
  /** studio 基址（备用登录页/回跳）：本地 dev 5173 */
  studioBaseUrl: process.env.STUDIO_BASE_URL ?? (process.env.NODE_ENV === "production" ? "https://app.dailogues.com" : "http://localhost:5173"),
};

export type SiteEnv = typeof env;
