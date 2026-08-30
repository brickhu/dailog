// LLM 配置解析：命令行 flag > 提示词模块 config（.mjs 的 export const config）> 环境变量 > .env 文件 > 默认
// 约定沿用仓库：DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL；通用 LLM_* 变量；默认 DeepSeek。

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const toolDir = dirname(dirname(fileURLToPath(import.meta.url)));

/** 极简 dotenv：解析 KEY=VALUE 行（# 注释、引号剥离），返回对象 */
export function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function findRootEnv() {
  const root = join(dirname(toolDir), ".env");
  return existsSync(root) ? root : null;
}

/** 解析 --flag value 型参数 */
export function flagValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}

export function hasFlag(args, name) {
  return args.includes(name);
}

/** 环境变量名 → 命令行短 flag 别名（无别名则 --kebab-case 化） */
const FLAG_ALIAS = {
  DEEPSEEK_API_KEY: "--api-key",
  LLM_API_KEY: "--api-key",
  API_KEY: "--api-key",
  DEEPSEEK_BASE_URL: "--base-url",
  LLM_BASE_URL: "--base-url",
  DEEPSEEK_MODEL: "--model",
  LLM_MODEL: "--model",
  LLM_TEMPERATURE: "--temperature",
  LLM_MAX_TOKENS: "--max-tokens",
  LLM_SEED: "--seed",
};

/** 环境变量名 → 提示词模块 config 的键名（模块里写驼峰小写） */
const MODULE_KEY = {
  DEEPSEEK_API_KEY: "apiKey",
  LLM_API_KEY: "apiKey",
  API_KEY: "apiKey",
  DEEPSEEK_BASE_URL: "baseUrl",
  LLM_BASE_URL: "baseUrl",
  DEEPSEEK_MODEL: "model",
  LLM_MODEL: "model",
  LLM_TEMPERATURE: "temperature",
  LLM_MAX_TOKENS: "maxTokens",
  LLM_SEED: "seed",
};

function makePicker(args, moduleConfig) {
  const fileEnv = { ...parseEnvFile(join(toolDir, ".env")), ...(findRootEnv() ? parseEnvFile(findRootEnv()) : {}) };
  return (...names) => {
    for (const n of names) {
      // 1. 命令行 flag
      const flag = FLAG_ALIAS[n] || "--" + n.toLowerCase().replace(/_/g, "-");
      const v = flagValue(args, flag);
      if (v !== undefined && v !== "") return v;
      // 2. 提示词模块 config（selection.mjs 等）
      const mk = MODULE_KEY[n];
      if (mk && moduleConfig[mk] !== undefined && moduleConfig[mk] !== null) return moduleConfig[mk];
      // 3. 环境变量 / .env 文件
      if (process.env[n] !== undefined && process.env[n] !== "") return process.env[n];
      if (fileEnv[n] !== undefined && fileEnv[n] !== "") return fileEnv[n];
    }
    return undefined;
  };
}

/**
 * 按优先级合并出最终 LLM 配置：命令行 flag > 提示词模块 config > 环境变量/.env > 默认。
 * moduleConfig 来自提示词 .mjs 的 export const config = { temperature, seed, ... }。
 */
export function resolveLlmConfig(args, moduleConfig = {}) {
  const pick = makePicker(args, moduleConfig);

  const config = {
    apiKey: pick("DEEPSEEK_API_KEY", "LLM_API_KEY", "API_KEY"),
    baseUrl: (pick("DEEPSEEK_BASE_URL", "LLM_BASE_URL") || "https://api.deepseek.com").replace(/\/$/, ""),
    model: pick("DEEPSEEK_MODEL", "LLM_MODEL") || "deepseek-chat",
    temperature: Number(pick("LLM_TEMPERATURE") || "0.7"),
    maxTokens: (() => {
      const v = pick("LLM_MAX_TOKENS");
      const n = v !== undefined ? Number(v) : NaN;
      return Number.isFinite(n) && n > 0 ? n : undefined;
    })(),
    seed: (() => {
      const v = pick("LLM_SEED");
      const n = v !== undefined ? Number(v) : NaN;
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    })(),
  };

  if (!config.apiKey) {
    console.error("[config] 未找到 LLM API key。配置方式（任选）：");
    console.error("  1) 环境变量：export DEEPSEEK_API_KEY=sk-xxx");
    console.error("  2) 工具目录配置：cp tools/script-lab/.env.example tools/script-lab/.env 后填入");
    console.error("  3) 命令行：--api-key sk-xxx");
    console.error("  当前 base-url=" + config.baseUrl + " model=" + config.model);
    process.exit(1);
  }
  return config;
}

/** 展示生效的 LLM 设置（不校验 key，供启动信息打印） */
export function describeSettings(args, moduleConfig = {}) {
  const pick = makePicker(args, moduleConfig);
  const parts = [];
  const add = (label, v) => {
    if (v !== undefined && v !== "") parts.push(label + "=" + v);
  };
  add("temp", pick("LLM_TEMPERATURE"));
  add("seed", pick("LLM_SEED"));
  add("max_tokens", pick("LLM_MAX_TOKENS"));
  add("model", pick("DEEPSEEK_MODEL", "LLM_MODEL"));
  const fromModule = [];
  if (moduleConfig.temperature !== undefined) fromModule.push("temp");
  if (moduleConfig.seed !== undefined) fromModule.push("seed");
  if (moduleConfig.maxTokens !== undefined) fromModule.push("max_tokens");
  if (moduleConfig.model !== undefined) fromModule.push("model");
  const desc = parts.length > 0 ? parts.join(" ") : "默认";
  return fromModule.length > 0 ? desc + "（提示词文件 config：" + fromModule.join("、") + "）" : desc;
}
