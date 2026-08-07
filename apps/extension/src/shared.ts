export type Platform =
  | "claude" | "deepseek" | "chatgpt" | "gemini"
  | "kimi" | "doubao" | "tongyi" | "plain";

export type Role = "user" | "assistant";

export interface DialogueMessage {
  role: Role;
  content: string;
}

export interface CollectedDialogue {
  platform: Platform;
  conversationId: string;
  title: string;
  url: string;
  messages: DialogueMessage[];
  /** 低置信度采集：结构化解析失败后的整页文本兜底（可能含导航等噪音；确认页提示） */
  lowConfidence?: boolean;
}

export const PLATFORMS: readonly Platform[] = [
  "claude", "deepseek", "chatgpt", "gemini", "kimi", "doubao", "tongyi", "plain",
];

export function isCollectedDialogue(value: unknown): value is CollectedDialogue {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!PLATFORMS.includes(v.platform as Platform)) return false;
  if (typeof v.conversationId !== "string" || v.conversationId.length === 0) return false;
  if (typeof v.title !== "string") return false;
  if (typeof v.url !== "string" || !v.url.startsWith("http")) return false;
  if (!Array.isArray(v.messages) || v.messages.length === 0) return false;
  return v.messages.every((m) => {
    if (typeof m !== "object" || m === null) return false;
    const msg = m as Record<string, unknown>;
    return (msg.role === "user" || msg.role === "assistant") && typeof msg.content === "string";
  });
}

// ============ 消息协议（content/popup ↔ background ↔ app 页面） ============

/** content → background：采集完成，请求本地缓存（返回 collectId + appUrl） */
export const MSG_CACHE_COLLECT = "dailog:cache-collect";
/** app 页面 → background：按 ID 读取本地缓存的采集数据（确认入库页展示） */
export const MSG_GET_COLLECT = "dailog:get-collect";
/** app 页面 → background：取消采集，删除本地缓存 */
export const MSG_DELETE_COLLECT = "dailog:delete-collect";
/** app 页面 → background：关闭当前标签页（导入页取消时用——扩展关标签绕开 window.close 的脚本限制） */
export const MSG_CLOSE_TAB = "dailog:close-tab";
/** popup → content：触发采集（返回 dialogue；由 popup/background 转缓存） */
export const MSG_COLLECT = "dailog:collect";
/** content → background：读取全部缓存条目摘要（对话页「已采集」判定 / studio 待入库角标共用）。
 *  可携带 appBase 按域过滤（不传 = 按扩展当前生效的 app 基址过滤） */
export const MSG_LIST_COLLECTS = "dailog:list-collects";
/** content → background：拉取远程抓取规则（本地解析失败时的 fallback；background 侧 TTL 缓存） */
export const MSG_GET_RULES = "dailog:get-rules";

/** 平台抓取规则（远程托管 JSON 的 schema；选择器驱动，通用解析器消费） */
export interface CollectRule {
  /** 消息节点候选（缺省 = userSelector ∪ assistantSelector） */
  messageSelector?: string;
  userSelector: string;
  assistantSelector: string;
  /** 取文本的子节点（如 deepseek 的 .ds-markdown）；缺省 = 节点自身 */
  contentSelector?: string;
  /** 对话标题选择器（可选；缺省用现有 extractTitle 兜底） */
  titleSelector?: string;
  /** 虚拟列表滚动容器（可选；v1 通用解析器暂不消费，预留） */
  scrollContainer?: string;
}

export interface CollectRules {
  version: number;
  platforms: Partial<Record<Platform, CollectRule>>;
}

export type GetRulesResult = { ok: true; rules: CollectRules } | { ok: false; error: string };

/** 缓存结果（cacheCollect）：成功返回 collectId 与确认入库页地址 */
export type CacheCollectResult =
  | { ok: true; collectId: string; appUrl: string }
  | { ok: false; error: string };

/** 缓存条目摘要（列表展示用）；appBase = 条目所属确认入库页基址（按域隔离 dev/主网） */
export interface CollectSummary {
  collectId: string;
  title: string;
  platform: Platform;
  url: string;
  createdAt: number;
  messageCount: number;
  appBase: string;
}

/** 读取全部缓存条目结果（listCollects） */
export type ListCollectsResult =
  | { ok: true; items: CollectSummary[] }
  | { ok: false; error: string };

/** 会话唯一键：按 pathname 归一（同会话重访/重采集判定；忽略 query/hash） */
export function conversationKey(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "");
  } catch {
    return url;
  }
}

/** 消息文本规范化：保留换行与行首缩进（代码块/列表结构），只清行尾空白、
 *  折叠多余空行、整体 trim——比全折叠（\s+→空格）保真度高，供解析器统一使用 */
export function normalizeMessageText(text: string): string {
  return text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 读取缓存结果（getCollect） */
export type GetCollectResult =
  | { ok: true; dialogue: CollectedDialogue }
  | { ok: false; error: string };

/** 删除缓存结果 */
export type DeleteCollectResult = { ok: true };
