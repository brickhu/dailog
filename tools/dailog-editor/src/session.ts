// skill 的 token 管理（session.json 读写）——CLI 底座不管理 token，此模块归 skill 所有
//   · 配对码登录产物存 .dailog-editor/session.json（gitignored，chmod 600）
//   · token 绑定环境（apiBase 一致才算有效；跨环境不通用防误操作）
import { readFileSync, writeFileSync, chmodSync, unlinkSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根：从入口位置逐级向上查找含 .dailog-editor 的目录（产物在 .agents/skills/ 下，向上找） */
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
const sessionFile = join(configDir, "session.json");

export interface SessionData {
  /** token 绑定的环境 API 基址（跨环境不通用） */
  apiBase?: string;
  token?: string;
  createdAt?: string;
}

/** 读取本地缓存的 bearer token（配对码登录产物）；无 → null */
export function readSession(): SessionData | null {
  try {
    return JSON.parse(readFileSync(sessionFile, "utf-8")) as SessionData;
  } catch {
    return null;
  }
}

/** 写入会话缓存（配对成功）；权限 600——token 等同密码；apiBase 记录环境绑定 */
export function saveSession(token: string, apiBase: string): void {
  writeFileSync(sessionFile, JSON.stringify({ apiBase, token, createdAt: new Date().toISOString() }), { mode: 0o600 });
  chmodSync(sessionFile, 0o600);
  console.log(`[auth] token 已缓存到 ${sessionFile}（chmod 600；绑定环境 ${apiBase}；过期重跑 pnpm editor login）`);
}

/** 清除会话缓存（token 失效 / 登出） */
export function clearSession(): void {
  try { unlinkSync(sessionFile); } catch { /* 无文件 */ }
}

/** 本地是否已有**当前环境**的有效登录态（session 存在且 token 绑定环境一致） */
export function hasValidSession(apiBase: string): boolean {
  const session = readSession();
  return !!session?.token && session.apiBase === apiBase;
}

/** 会话缓存文件路径（登录/登出提示用） */
export function sessionPath(): string {
  return sessionFile;
}

/** 待配对授权缓存路径（配对码登录：--code 复用同一授权的中间态；随登录态绑定环境） */
export function pendingDevicePath(): string {
  return join(configDir, "pending-device.json");
}

/** 编辑认证 token：须绑定当前环境；无/环境不符 → 抛错引导配对登录 */
export function getToken(apiBase: string): string {
  const session = readSession();
  if (session?.token && session.apiBase === apiBase) return session.token;
  if (session?.token && session.apiBase !== apiBase) {
    throw new Error(`[auth] 本地 token 绑定的是 ${session.apiBase}，当前操作环境是 ${apiBase}——跨环境不通用（防止误操作）。请重新配对：pnpm editor login`);
  }
  throw new Error("[auth] 未登录。请先执行：pnpm editor login（浏览器配对后 token 缓存到本地）");
}
