// 环境配置：构建时由 build.mjs 经 esbuild define 注入（process.env.DAILOGUES_*）
// 未注入（测试环境）时回退生产域名；popup 可在运行时覆盖 API 地址（chrome.storage）
export const DEFAULT_API_BASE =
  process.env.DAILOGUES_API_BASE ?? "https://api.dailogues.com";
export const DEFAULT_APP_BASE =
  process.env.DAILOGUES_APP_BASE ?? "https://app.dailogues.com";
/** 统一登录页基址（主站 dailogues.com；构建注入 DAILOGUES_LOGIN_BASE） */
export const DEFAULT_LOGIN_BASE =
  process.env.DAILOGUES_LOGIN_BASE ?? "https://dailogues.com";
/** popup 覆盖的 API 地址存储键（chrome.storage.local） */
export const API_BASE_KEY = "dailoguesApiBase";
