// clilib.mjs —— lab 自包含的“环境解析 + API HTTP”，取代 dailog-cli/dist/lib.js
// 原则：不读仓库根 .dailog-editor/*；环境 = 内置清单 / 环境变量覆盖；HTTP = Node 全局 fetch
import { parseEnvFile } from "./config.mjs";
import { toolDir } from "./config.mjs";

const BUILTIN_ENVS = [
  { name: "local", label: "本地开发（API localhost:8787）", apiBase: "http://localhost:8787", siteUrl: "http://localhost:3000" },
  { name: "dev", label: "远程开发（站点 candelbot.app）", apiBase: "https://api.candelbot.app", siteUrl: "https://candelbot.app" },
  { name: "prod", label: "生产（站点 dailog.fm）", apiBase: "https://api.dailog.fm", siteUrl: "https://dailog.fm" },
];

export function listEnvironments() {
  // lab 是 api services 的本地管理工具：默认暴露 local/dev/prod 三套。
  // 容器/部署场景：LAB_API_BASE 覆盖“所管 api 服务”那一档（默认 local；DAILOG_ENV=dev/prod 可指定覆盖哪档），
  // 其余档仍走内置远端地址——一个登录页即可管理本机与远程三套 api。
  const over = (process.env.LAB_API_BASE || "").replace(/\/+$/, "");
  if (over) {
    const pinned = BUILTIN_ENVS.some((e) => e.name === process.env.DAILOG_ENV) ? process.env.DAILOG_ENV : "local";
    const siteOverride = process.env.LAB_SITE_URL || "";
    return BUILTIN_ENVS.map((e) => {
      if (e.name !== pinned) return { ...e };
      return {
        ...e,
        apiBase: over,
        siteUrl: siteOverride || e.siteUrl,
        label: e.label.replace(/（API [^）]*）/, "（" + over + "）"),
      };
    });
  }
  return BUILTIN_ENVS;
}

function flagEnvValue(argv) {
  const i = argv.indexOf("--env");
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

/** 解析密钥：tools/script-lab/.env（parseEnvFile）合并 process.env；容器直接注入环境变量即可 */
function loadSecrets() {
  const fileEnv = parseEnvFile(toolDir + "/.env");
  const out = { ...fileEnv };
  for (const k of Object.keys(process.env)) if (String(process.env[k]) !== "") out[k] = process.env[k];
  return out;
}

/** 返回 { envName, apiBase, siteUrl, secrets }——兼容旧 CLI loadConfig 消费方（configFor） */
export function loadConfig(argv = process.argv) {
  const name = flagEnvValue(argv) || process.env.DAILOG_ENV || (process.env.LAB_API_BASE ? "local" : null);
  const envs = listEnvironments();
  const target = (name && envs.find((e) => e.name === name)) || (envs.length === 1 ? envs[0] : null);
  if (!target) {
    throw new Error("环境不存在: " + (name || "?") + "（可用: " + envs.map((e) => e.name).join(" / ") + "；容器可用 LAB_API_BASE 指定）");
  }
  return { envName: target.name, apiBase: target.apiBase, siteUrl: target.siteUrl || target.apiBase, secrets: loadSecrets() };
}

/** 通用 API HTTP（Node 全局 fetch）；保持与旧 undici Response 用法兼容：status/ok/text/json/arrayBuffer/headers */
export function apiFetch(input, init) {
  return fetch(input, init);
}
