// 采集 → 回传 → 结果反馈 的流程编排（纯逻辑，便于测试）

import { MSG_COLLECT, type CollectResult, type CollectedDialogue } from "../shared";

export interface CollectFlowOptions {
  collect: () => Promise<CollectedDialogue | null>;
  send: (msg: unknown) => Promise<CollectResult | undefined>;
  onResult: (text: string, kind: "success" | "error") => void;
}

/** FAB 点击流程：采集 → 送 background → 展示结果 */
export async function runCollectFlow(opts: CollectFlowOptions): Promise<void> {
  try {
    const dialogue = await opts.collect();
    if (!dialogue) {
      opts.onResult("未识别到对话内容，请确认当前是对话页", "error");
      return;
    }
    const res = await opts.send({ type: MSG_COLLECT, dialogue });
    if (res?.ok) {
      opts.onResult("已采集 ✓ 去 app.dailog.fm 继续编辑", "success");
    } else {
      opts.onResult(`采集失败：${res?.error ?? "未知错误"}`, "error");
    }
  } catch (e) {
    opts.onResult(`采集失败：${e instanceof Error ? e.message : String(e)}`, "error");
  }
}
