// 采集流程编排（纯逻辑，便于测试）：采集 → 本地缓存（background 自动打开确认入库页）。
// 扩展只做 DOM 解析 + 数据传输；是否登录/开通频道由 app 的 auth provider 在入库时校验。

import type { CollectedDialogue, CacheCollectResult } from "../shared";

export interface CollectFlowOptions {
  /** 页面采集（DOM 解析） */
  collect: () => Promise<CollectedDialogue | null>;
  /** 本地缓存（background 实现；成功后自动打开确认入库页） */
  cache: (dialogue: CollectedDialogue) => Promise<CacheCollectResult>;
  onResult: (text: string, kind: "success" | "error") => void;
}

/** FAB 点击流程：采集 → 缓存 → background 打开确认入库页 */
export async function runCollectFlow(opts: CollectFlowOptions): Promise<void> {
  try {
    // 1) 采集
    const dialogue = await opts.collect();
    if (!dialogue) {
      opts.onResult("未识别到对话内容，请确认当前是对话页", "error");
      return;
    }
    // 2) 本地缓存（background 侧自动打开确认入库页）
    const res = await opts.cache(dialogue);
    if (res?.ok) {
      opts.onResult("已采集 ✓ 请在打开的页面确认入库", "success");
    } else {
      opts.onResult(`采集失败：${res?.error ?? "未知错误"}`, "error");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 扩展重新加载后旧页面 content script 上下文失效——引导刷新页面重新注入
    if (msg.includes("Extension context invalidated")) {
      opts.onResult("扩展已更新：请刷新本页面后重试", "error");
    } else {
      opts.onResult(`采集失败：${msg}`, "error");
    }
  }
}
