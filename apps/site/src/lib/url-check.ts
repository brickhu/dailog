// URL 合法性与本地存储的统一入口（localStorage JSON，key = 确定性投稿 ID）：
// - 输入 URL → 算 ID（平台标识 + 内容 ID 的 UUID v5，与后端 submissionIdFromUrl 一致）
// - 合法性（平台白名单，可靠门槛）→ 结果存 localStorage：{ [id]: { url, valid, reachable, checkedAt } }
// - /submit?id=… 直接从 localStorage 取 URL 与合法性，无需重新检测、不暴露 URL 参数
// 设计说明：可达性探测不可靠（CORP/网络/反爬均会误判），且后端投稿端点不校验可达性——
// 因此 reachable 仅作展示参考，不作为投稿门槛；内容有效性由编辑端采集时验证。
import { isShareUrl } from "../components/import-dialog";

// 与后端 submissionIdFromUrl 一致的命名空间与算法（sha1 + UUID v5 位标记）
const SUBMISSION_NS = "d6a5c441-58e7-4b1c-9a2d-3f0e1b2c3d4e";

/** 规范化分享 URL → 平台标识 + 内容 ID（host 小写 + 路径，去 query/hash） */
export function submissionKeyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}:${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url;
  }
}

/** 确定性投稿 ID（浏览器 Web Crypto 实现，与后端 submissionIdFromUrl 输出一致） */
export async function submissionIdFromUrl(url: string): Promise<string> {
  const data = new TextEncoder().encode(SUBMISSION_NS + submissionKeyFromUrl(url));
  const digest = await crypto.subtle.digest("SHA-1", data);
  const b = new Uint8Array(digest).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// —— 检测结果存储（localStorage JSON）——
export interface UrlCheckEntry {
  url: string;
  valid: boolean;
  /** 可达性探测结果（仅展示参考，不阻断投稿）：true = 可达 / false = 探测失败 / null = 未确认 */
  reachable: boolean | null;
  checkedAt: number;
}

const STORE_KEY = "dailog.urlChecks";
const STORE_MAX = 50;
/** 检测结果有效期：10 分钟（可达性可能变化，过期后需重新检测） */
export const URL_CHECK_TTL = 10 * 60 * 1000;

function readStore(): Record<string, UrlCheckEntry> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, UrlCheckEntry>;
  } catch {
    return {};
  }
}
function writeStore(store: Record<string, UrlCheckEntry>): void {
  try {
    const keys = Object.keys(store);
    if (keys.length > STORE_MAX) {
      // 超上限：清掉最旧一半
      keys.sort((a, b) => (store[a]?.checkedAt ?? 0) - (store[b]?.checkedAt ?? 0));
      for (const k of keys.slice(0, Math.floor(STORE_MAX / 2))) delete store[k];
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // 存储不可用（隐私模式）：静默（调用方仍可用本次结果）
  }
}

// —— 已提交 URL 记录（提交成功后标记：剪贴板检测不再弹该 URL）——
const SUBMITTED_KEY = "dailog.submittedUrls";
const SUBMITTED_MAX = 100;

function readSubmitted(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(SUBMITTED_KEY) ?? "[]") as string[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** 是否已提交过该 URL（提交成功后标记；剪贴板自动弹窗跳过） */
export function isSubmittedUrl(url: string): boolean {
  return readSubmitted().includes(url);
}

/** 标记 URL 已提交（提交成功时调用） */
export function markSubmitted(url: string): void {
  try {
    const list = readSubmitted();
    if (list.includes(url)) return;
    list.push(url);
    if (list.length > SUBMITTED_MAX) list.splice(0, list.length - SUBMITTED_MAX);
    localStorage.setItem(SUBMITTED_KEY, JSON.stringify(list));
  } catch {
    // 存储不可用：静默
  }
}

/** 按 ID 取检测结果（未过期才返回；无/过期 → null） */
export function getUrlCheck(id: string): UrlCheckEntry | null {
  const entry = readStore()[id];
  if (!entry) return null;
  if (Date.now() - entry.checkedAt > URL_CHECK_TTL) return null;
  return entry;
}

/** 可达性探测结果：
 *  reachable = 资源存在（白名单内非 404：200/3xx/403/429 等——反爬/挑战页说明资源存在）；
 *  notfound  = 明确 404——页面不存在；
 *  unknown   = 无法确认（用户本地与服务端都拿不到响应：网络层失败/CORP 拦截/服务器被平台封锁）。
 * 判定标准：白名单域名内「非 404」即可触达。
 * 通道顺序：① 用户本地优先——no-cors 直连，用户本地能拿到任何响应即视为可达
 *          （最贴近用户真实体验：用户能打开的页面即为存在，且不依赖服务端）；
 *          ② 服务端兜底（/v1/submissions/reachable：HEAD/GET 读真实状态码，区分 404）
 *          ——仅在客户端失败时启用（如 Google 分享页 CORP 拦截、用户网络到目标不通）。
 * 结果仅供展示提示，不阻断投稿（后端投稿端点不校验可达性）。 */
export type Reachability = "reachable" | "notfound" | "unknown";

export async function probeReachable(url: string): Promise<Reachability> {
  // ① 用户本地优先：no-cors 直连——任何 HTTP 响应（含 403/挑战页/404 的 opaque）
  //    都说明用户本地能访问该页面 → 视为可达（与用户浏览器中的实际体验一致）
  try {
    await fetch(url, { mode: "no-cors", redirect: "follow", signal: AbortSignal.timeout(8000) });
    return "reachable";
  } catch {
    // 客户端失败（CORP 拦截/用户网络到目标不通）→ ② 服务端兜底
  }
  // ② 服务端兜底：能读真实状态码（HEAD/GET），区分 404（页面不存在）
  try {
    const res = await fetch("/v1/submissions/reachable", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return "reachable";
    if (res.status === 404) return "notfound";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** 统一检测入口：算 ID → 合法性（平台白名单，可靠门槛）→ 存 localStorage → 返回结果。
 *  可达性**不在入口等待探测**（探测仅供提交页展示；入口阻塞会让有效链接因误判被拦）。
 *  reachable 字段由提交页异步探测后更新，或保持 null（未确认）。 */
export async function checkUrlAndStore(url: string): Promise<{ id: string; valid: boolean; reachable: boolean | null }> {
  const id = await submissionIdFromUrl(url);
  const valid = isShareUrl(url);
  const entry: UrlCheckEntry = { url, valid, reachable: null, checkedAt: Date.now() };
  const store = readStore();
  store[id] = entry;
  writeStore(store);
  return { id, valid, reachable: null };
}
