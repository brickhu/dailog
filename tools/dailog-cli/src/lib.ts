// 编辑本地 Agent 共享库（db-ops 风格配置）：
//   · 环境清单：.dailog-editor/envs.json（可多环境：local/dev/prod；模板 tools/dailog-editor/templates/envs.example.json）——
//     每次命令用 --env <名> / --api-base <url> / DAILOG_ENV 显式指定环境（会话级选择，不落全局配置）
//   · 密钥（Fish/Pexels）：.dailog-editor/.env（gitignored，chmod 600）——环境无关
//   · 认证：配对码登录（pnpm editor login --env <名>）——token **绑定环境**存
//     .dailog-editor/session.json（gitignored，chmod 600）；跨环境 token 不通用（防误操作）
//   · 草稿：.dailog-editor/drafts/{submissionId}/ 存脚本/分段音频/合成中间件/封面（gitignored）
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync, unlinkSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根：从入口位置逐级向上查找含 .dailog-editor 的目录（源码在 tools/ 下、产物在 .agents/skills/ 下，层级不同） */
function findRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, ".dailog-editor"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

const root = findRoot(dirname(fileURLToPath(import.meta.url)));
const configDir = join(root, ".dailog-editor");
/** 草稿根目录（overview 遍历全部投稿草稿用） */
export const draftsDir = join(configDir, "drafts");
/** 编辑反馈日志目录（自进化素材——SC-GATE-2 等确认门的修改意见落盘，本地无 API 依赖） */
export const feedbackDir = join(configDir, "feedback");
/** 反馈日志文件（JSONL：一行一条 FeedbackEntry） */
export const feedbackFile = join(feedbackDir, "feedback.jsonl");
/** 学习规则文件（L2 演进层）：编辑反馈蒸馏沉淀的通用规则——SC-STEP-1/2 作为附加输入注入 */
export const learnedRulesFile = join(configDir, "learned-rules.md");
const envsFile = join(configDir, "envs.json");

/** 解码规则库（本地自进化主文件）：.dailog-editor/rules.json——运行时直接读写进化，
 *  无需 build；首次使用从工程种子（assets/rules.json）自动初始化复制 */
export function rulesPath(): string {
  return join(configDir, "rules.json");
}

/** 注入式 token：CLI 不管理 token 存储——由调用方（skill 读自己的 session / lab 读 localStorage）注入。
 *  setApiToken(token) 设置全局；api()/tryApi() 优先用 tokenOverride，其次用此注入值。 */
let injectedApiToken: string | null = null;
export function setApiToken(token: string | null): void { injectedApiToken = token; }
export function getApiToken(): string | null { return injectedApiToken; }
/** cookie 会话注入（lab 密码登录用）：api() 优先用 cookie，其次 Bearer token */
let injectedApiCookie: string | null = null;
export function setApiCookie(cookie: string | null): void { injectedApiCookie = cookie; }
export function getApiCookie(): string | null { return injectedApiCookie; }

/** 默认资产目录（intro/outro 片头片尾 + rules.json 种子）：源码 src/ 与产物 scripts/ 的上一级都是 assets/ */
export function defaultAssetsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
}

export interface EditorConfig {
  /** 环境 API 基址（本次命令生效；来自 --env/--api-base/DAILOG_ENV → envs.json → .env 回退） */
  apiBase: string;
  /** 站点基址（节目 URL 拼装；来自 envs.json 的 siteUrl） */
  siteUrl: string | null;

  /** 环境名（--env/DAILOG_ENV 指定；null = 默认/未命名） */
  envName: string | null;
  pexelsApiKey?: string;
  /** .dailog-editor/.env 全量密钥（Fish API key / R2 凭证 / Pexels 等，环境无关） */
  secrets: Record<string, string>;
}

export interface EnvironmentEntry {
  name: string;
  label?: string;
  apiBase: string;
  /** 站点基址（节目 URL 拼装；可选） */
  siteUrl?: string;
}

/** 环境清单（.dailog-editor/envs.json；缺失 → 空——用 .env 的 API_BASE 回退） */
export function listEnvironments(): EnvironmentEntry[] {
  if (!existsSync(envsFile)) return [];
  try {
    const data = JSON.parse(readFileSync(envsFile, "utf-8")) as
      | EnvironmentEntry[]
      | { environments?: EnvironmentEntry[] }
      | null;
    const list = Array.isArray(data) ? data : data?.environments;
    if (!Array.isArray(list)) return [];
    return list.filter((e): e is EnvironmentEntry =>
      !!e && typeof e.name === "string" && e.name.length > 0 && typeof e.apiBase === "string" && e.apiBase.length > 0);
  } catch {
    console.warn(`[config] ${envsFile} 不是合法 JSON——忽略，回退 .env 的 API_BASE`);
    return [];
  }
}

function parseEnvFlag(argv: string[]): { envName: string | null; apiBase: string | null } {
  let envName: string | null = null;
  let apiBase: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env" && argv[i + 1]) {
      envName = argv[i + 1];
      i++;
    } else if (arg === "--api-base" && argv[i + 1]) {
      apiBase = argv[i + 1].replace(/\/$/, "");
      i++;
    }
  }
  if (!envName) envName = process.env.DAILOG_ENV ?? null;
  return { envName, apiBase };
}

/** 从 .env 读环境无关密钥（Fish/Pexels/R2/Assets） */
export function loadSecrets(): Record<string, string> {
  const envFile = join(configDir, ".env");
  const env: Record<string, string> = {};
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf-8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

/** 解析环境与配置：--env/--api-base/DAILOG_ENV 优先，其次 envs.json，最后 .env 的 API_BASE 回退 */
export function loadConfig(argv: string[] = process.argv): EditorConfig {
  const { envName, apiBase: flagApiBase } = parseEnvFlag(argv);
  const secrets = loadSecrets();

  let apiBase = flagApiBase;
  let resolvedEnvName = envName;
  let siteUrl: string | null = null;
  if (!apiBase) {
    const envs = listEnvironments();
    if (envs.length > 0) {
      const pick = envName ? envs.find((e) => e.name === envName) : undefined;
      if (envName && !pick) {
        console.error(`[config] 环境 "${envName}" 不在 ${envsFile} 中。可用环境：${envs.map((e) => e.name).join(" / ")}`);
        process.exit(1);
      }
      // 未指定环境且有多个：明确提示选择（防默认打到错误环境）
      if (!pick && envs.length > 1) {
        console.error("[config] 存在多个环境，请用 --env <名> 指定本次操作的环境：");
        for (const e of envs) console.error(`    ${e.name}${e.label ? `（${e.label}）` : ""}  ${e.apiBase}`);
        console.error("    示例：pnpm editor --env prod list");
        process.exit(1);
      }
      const target = pick ?? envs[0];
      apiBase = target.apiBase;
      resolvedEnvName = target.name;
      siteUrl = target.siteUrl ?? null;
    } else if (secrets.API_BASE) {
      apiBase = secrets.API_BASE.replace(/\/$/, "");
    }
  }
  if (!apiBase) {
    console.error(`[config] 未找到环境配置——请创建 ${envsFile}（模板 tools/dailog-editor/templates/envs.example.json）或配置 .env 的 API_BASE`);
    process.exit(1);
  }

  return {
    apiBase,
    envName: resolvedEnvName,
    siteUrl,
    secrets,
  };
}

/** multipart 序列化：undici dispatcher 路径下 FormData body 会失效（服务端收到空表单，
 *  guest-voice 上传曾 400 invalid_body）——自行编码为字节流 + boundary，不依赖 undici 版本行为 */
// 返回体用 Uint8Array<ArrayBuffer> 显式标注——避免泛型 ArrayBufferLike 与 BodyInit 不兼容
// 的 TS2336 类型报错（undici 的 BodyInit 期望 Uint8Array<ArrayBuffer>，而非宽泛的 ArrayBufferLike）
async function serializeFormData(form: FormData): Promise<{ body: Uint8Array<ArrayBuffer>; contentType: string }> {
  const boundary = `----dailog-editor-${Math.random().toString(16).slice(2)}`;
  const enc = new TextEncoder();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const push = (s: string) => chunks.push(enc.encode(s));
  for (const [name, value] of form.entries()) {
    if (value instanceof Blob) {
      const file = value as File;
      push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${file.name || "file"}"\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`);
      chunks.push(new Uint8Array(await file.arrayBuffer()));
      push("\r\n");
    } else {
      push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
    }
  }
  push(`--${boundary}--\r\n`);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** HTTP 请求（本地基址已统一为 http://localhost:8787——纯 HTTP 无需 TLS 处理；
 *  历史 .orb.local https 自签证书保留忽略校验逻辑（OrbStack 证书不被 Node 默认信任）；
 *  dev/prod 生产证书正常校验）。
 *  统一走自定义 undici Agent：整集合成（/v1/editor/tts）服务端一次调用可能超过 undici
 *  默认 300s headersTimeout——放宽到 15 分钟，避免长合成被客户端超时打断。 */
let apiAgent: Dispatcher | undefined;
let orbAgent: Dispatcher | undefined;
export async function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  let url: string;
  try {
    url = typeof input === "string" ? input : input instanceof URL ? input.href : new URL(input.url).href;
  } catch {
    return fetch(input, init);
  }
  let effectiveInit = init;
  const LONG_TIMEOUT = 900000; // 15 min：整集合成等长请求
  if (!apiAgent) apiAgent = new Agent({ connect: { timeout: 60000 }, headersTimeout: LONG_TIMEOUT, bodyTimeout: LONG_TIMEOUT });
  if (!orbAgent) orbAgent = new Agent({ connect: { timeout: 60000, rejectUnauthorized: false }, headersTimeout: LONG_TIMEOUT, bodyTimeout: LONG_TIMEOUT });
  const dispatcher = url.includes(".orb.local") ? orbAgent : apiAgent;
  return undiciFetch(input as never, { ...effectiveInit, dispatcher } as never) as unknown as Promise<Response>;
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  formData?: FormData;
  expectJson?: boolean;
}

/** 带鉴权的 API 请求（JSON 或 multipart）；非 2xx 打印错误并退出；401 → 清会话引导重新配对 */
export async function api(config: EditorConfig, path: string, opts: ApiOptions = {}, tokenOverride?: string | null): Promise<unknown> {
  // 鉴权：cookie（lab 密码登录）优先，其次 token（tokenOverride > setApiToken）
  const token = tokenOverride ?? injectedApiToken;
  const cookie = injectedApiCookie;
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = cookie;
  else if (token) headers["Authorization"] = `Bearer ${token}`;
  else throw new Error("[auth] 未提供登录凭证——调用方需注入（skill: pnpm editor login；lab: 登录）");
  let body: BodyInit | undefined;
  if (opts.formData) {
    // undici dispatcher 路径下原生 FormData 会失效（服务端收到空表单）——自行编码 multipart
    const { body: formBody, contentType } = await serializeFormData(opts.formData);
    headers["content-type"] = contentType;
    body = formBody;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await apiFetch(`${config.apiBase}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body,
  });
  if (res.status === 401) {
    throw new Error("[api] token 已失效（401）——调用方重新注入（skill: pnpm editor login；lab: 重新配对）");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[api] ${opts.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    process.exit(1);
  }
  if (opts.expectJson === false) return res;
  return res.json().catch(() => null);
}

/** 尽力而为的 API 请求：失败（未登录/token 环境不符/网络/非 2xx）返回 null，不退出进程——
 *  用于封面文字等非关键增强：拿不到称呼就无文字，不影响主流程（与 api() 的区别仅是不退出） */
export async function tryApi(config: EditorConfig, path: string, opts: ApiOptions = {}, tokenOverride?: string | null): Promise<unknown | null> {
  const token = tokenOverride ?? injectedApiToken;
  if (!token) return null;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: BodyInit | undefined;
  if (opts.formData) {
    const { body: formBody, contentType } = await serializeFormData(opts.formData);
    headers["content-type"] = contentType;
    body = formBody;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  try {
    const res = await apiFetch(`${config.apiBase}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body,
    });
    if (!res.ok) return null;
    if (opts.expectJson === false) return res;
    return res.json().catch(() => null);
  } catch {
    return null;
  }
}

/** 草稿目录（按 submissionId 隔离中间产物）；不存在则创建 */
export function draftDir(submissionId: string): string {
  const dir = join(draftsDir, submissionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** 进度标记文件（会话中断恢复用）：drafts/{submissionId}/progress.json */
export function progressPath(submissionId: string): string {
  return join(draftsDir, submissionId, "progress.json");
}

/** 记录当前进度（各命令完成时调用；中断后新对话据此恢复断点） */
export function writeProgress(submissionId: string, step: string): void {
  try {
    writeFileSync(progressPath(submissionId), JSON.stringify({ step, updatedAt: new Date().toISOString() }, null, 2));
  } catch { /* 进度标记失败不阻塞流程 */ }
}

/** 发布成功后清理语音/封面等大文件产物（保留对话/脚本/页面等文本草稿）：
 *  删除 *.mp3/*.m4a/*.wav/*.webm（整集 full.mp3、合成 final.m4a、逐段 seg-*、静音段）+
 *  *.jpg/*.jpeg/*.png（封面）——本地不留语音与图片；文本资料保留供查阅/重做。
 *  清理后验证：仍有音频/图片残留时输出警告。 */
const ARTIFACT_RE = /\.(mp3|m4a|wav|webm|jpg|jpeg|png)$/i;
export function clearArtifacts(submissionId: string): void {
  const dir = draftDir(submissionId);
  if (!existsSync(dir)) return;
  let removed = 0;
  for (const f of readdirSync(dir)) {
    if (ARTIFACT_RE.test(f)) {
      try {
        rmSync(join(dir, f), { force: true });
        removed++;
      } catch { /* 单文件失败继续 */ }
    }
  }
  const remain = readdirSync(dir).filter((f) => ARTIFACT_RE.test(f));
  if (remain.length > 0) {
    console.warn(`[clearArtifacts] ⚠️ 仍有语音/封面残留（${remain.length}）：${remain.join(", ")}——请手动清理`);
  } else {
    console.log(`[clearArtifacts] 已清理 ${removed} 个语音/封面文件（文本草稿保留）`);
  }
}

/** 读取进度（无记录 → null） */
export function readProgress(submissionId: string): { step: string; updatedAt: string } | null {
  try {
    const p = progressPath(submissionId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8")) as { step: string; updatedAt: string };
  } catch {
    return null;
  }
}

export interface ScriptSegment {
  speaker: "host" | "guest";
  text: string;
  /** TTS 分段标注：1=点题 2=对谈 3=落点+收束；供 tts --parts 分 3 段独立合成 */
  part?: 1 | 2 | 3;
}

/** 读取脚本 JSON（skill 生成），校验并摊平为带 part 的扁平段：
 *  新结构 { parts: [{segments}, {segments}, {segments}], ... } → part = 数组位置+1（1=点题 2=对谈 3=落点+收束）；
 *  旧结构 { segments: [...] } / 直接数组 → 兼容（段自带 part 字段）。 */
export function readScript(path: string): ScriptSegment[] {
  const raw = readFileSync(path, "utf-8");
  const data = JSON.parse(raw) as
    | { parts?: Array<{ segments?: ScriptSegment[] }>; segments?: ScriptSegment[] }
    | ScriptSegment[];
  let segments: ScriptSegment[];
  if (Array.isArray(data)) {
    segments = data;
  } else if (Array.isArray(data.parts) && data.parts.length > 0) {
    segments = data.parts.flatMap((p, i) => (p.segments ?? []).map((s) => ({ ...s, part: (i + 1) as 1 | 2 | 3 })));
  } else if (Array.isArray(data.segments)) {
    segments = data.segments;
  } else {
    console.error(`[script] ${path} 不是合法脚本（需要 parts: [{segments}] 或 segments: [{speaker, text}]）`);
    process.exit(1);
  }
  if (segments.length === 0) {
    console.error(`[script] ${path} 无任何段落`);
    process.exit(1);
  }
  for (const seg of segments) {
    if (!seg || (seg.speaker !== "host" && seg.speaker !== "guest") || typeof seg.text !== "string") {
      console.error(`[script] ${path} 含非法 segment（speaker 只能 host/guest）`);
      process.exit(1);
    }
  }
  return segments;
}

export function durationLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
}