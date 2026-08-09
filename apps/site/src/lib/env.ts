// server 端环境（读 .env.local / 部署环境变量）。
// 注意：vinxi dev 不自动加载 .env 文件（vite 只注入 VITE_ 前缀到客户端），
// 服务端 process.env 拿不到 .env.local 的值——这里手动解析 .env.local 兜底；
// 生产（CF Pages）无 .env.local 文件，直接用 process.env。

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** 解析 .env.local（KV 行；跳过注释/空行；不处理引号转义——本项目值无引号） */
function loadLocalEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const file = resolve(process.cwd(), ".env.local");
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
  }
  return out;
}

const local = loadLocalEnv();

export const env = {
  /** api 基址：本地 dev 8787，生产 https://api.dailog.fm */
  apiBaseUrl:
    process.env.API_BASE_URL ??
    local.API_BASE_URL ??
    (process.env.NODE_ENV === "production" ? "https://api.dailog.fm" : "http://localhost:8787"),
  /** 站点基址（登录回跳/绝对链接）：本地 dev 3000 */
  siteBaseUrl:
    process.env.SITE_BASE_URL ??
    local.SITE_BASE_URL ??
    (process.env.NODE_ENV === "production" ? "https://dailog.fm" : "http://localhost:3000"),
  /** studio 基址（备用登录页/回跳）：本地 dev 5173 */
  studioBaseUrl:
    process.env.STUDIO_BASE_URL ??
    local.STUDIO_BASE_URL ??
    (process.env.NODE_ENV === "production" ? "https://app.dailog.fm" : "http://localhost:5173"),
};

export type SiteEnv = typeof env;
