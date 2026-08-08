import type { AudioStorage } from "./storage";
import type { CollectedDialogue } from "./dialogue";

/**
 * 原始对话存储（R2，目录规划 imports/）：
 *   imports/{importId}.dialogue.json —— 解析后的对话（脚本生成/润色来源）
 *   imports/{importId}.raw.json       —— 原始导出全文（预留：扩展采集原始导出的场景）
 * meta（userId/platform/sourceTitle/sourceUrl/status）存数据库 imports 表。
 */
export function dialogueKey(importId: string, kind: "dialogue" | "raw"): string {
  return `imports/${importId}.${kind}.json`;
}

/** 读对话（storage.get + JSON.parse）；缺失/损坏返回 null */
export async function readDialogue(
  storage: AudioStorage,
  importId: string,
): Promise<CollectedDialogue | null> {
  try {
    const bytes = await storage.get(dialogueKey(importId, "dialogue"));
    return JSON.parse(new TextDecoder().decode(bytes)) as CollectedDialogue;
  } catch {
    return null;
  }
}

/** 写对话（R2 put）；返回 key */
export async function writeDialogue(
  storage: AudioStorage,
  importId: string,
  dialogue: CollectedDialogue,
): Promise<string> {
  const key = dialogueKey(importId, "dialogue");
  await storage.put(key, new TextEncoder().encode(JSON.stringify(dialogue)));
  return key;
}

/** 删除对话对象（导入失败补偿：put 成功但 DB 写入失败时清理，防孤儿对象） */
export async function deleteDialogue(storage: AudioStorage, importId: string): Promise<void> {
  await storage.delete(dialogueKey(importId, "dialogue")).catch(() => {});
}

/**
 * 同一来源重复采集合并：按 (role, content) 全等去重，追加新增消息（原对话在结尾续接）。
 * 返回追加条数；0 = 内容完全一致（无需变更）。原始对话缺失时保守不写（返回 0）。
 */
export async function mergeDialogue(
  storage: AudioStorage,
  importId: string,
  incoming: CollectedDialogue,
): Promise<number> {
  const existing = await readDialogue(storage, importId);
  if (!existing) return 0;
  const seen = new Set(existing.messages.map((m) => `${m.role}\u0000${m.content}`));
  const added = incoming.messages.filter((m) => !seen.has(`${m.role}\u0000${m.content}`));
  if (added.length === 0) return 0;
  await writeDialogue(storage, importId, {
    ...existing,
    // 标题/URL 以最新采集为准（早期版本可能没采到标题）
    title: incoming.title || existing.title,
    url: incoming.url || existing.url,
    messages: [...existing.messages, ...added],
  });
  return added.length;
}
