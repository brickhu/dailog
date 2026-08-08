// 扩展消息桥：确认入库页读取/删除本地采集缓存（chrome.runtime.sendMessage，
// 未装扩展/非浏览器环境静默失败）

import { env } from "./env";

declare const chrome: {
  runtime?: { sendMessage?: (id: string, msg: unknown) => Promise<unknown> };
};

export interface CachedCollect {
  platform: string;
  conversationId: string;
  title: string;
  url: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** 低置信度采集：整页文本兜底（可能含导航噪音） */
  lowConfidence?: boolean;
  /** 问答单元数（一问一答成对数） */
  unitCount?: number;
}

async function send<T>(msg: unknown): Promise<T | undefined> {
  if (!env.extensionId || typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return undefined;
  try {
    return (await chrome.runtime.sendMessage(env.extensionId, msg)) as T;
  } catch {
    return undefined;
  }
}

/** 按 ID 读取本地采集缓存（确认页展示；扩展未装/缓存不存在 → null） */
export async function getCollect(collectId: string): Promise<CachedCollect | null> {
  const res = await send<{ ok: boolean; dialogue?: CachedCollect; error?: string }>({
    type: "dailog:get-collect",
    collectId,
  });
  return res?.ok && res.dialogue ? res.dialogue : null;
}

/** 删除本地采集缓存（取消 / 入库完成清理） */
export async function deleteCollect(collectId: string): Promise<boolean> {
  const res = await send<{ ok: boolean }>({ type: "dailog:delete-collect", collectId });
  return Boolean(res?.ok);
}

/** 关闭当前标签页（导入页取消时用——由扩展关标签，绕开 window.close 的脚本限制） */
export async function closeCurrentTab(): Promise<boolean> {
  const res = await send<{ ok: boolean }>({ type: "dailog:close-tab" });
  return Boolean(res?.ok);
}
