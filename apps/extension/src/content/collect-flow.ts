// 采集 → 回传 → 结果反馈 的流程编排（纯逻辑，便于测试）

import { MSG_COLLECT, type CollectResult, type CollectedDialogue } from "../shared";

export interface CollectFlowOptions {
  collect: () => Promise<CollectedDialogue | null>;
  send: (msg: unknown) => Promise<CollectResult | undefined>;
  onResult: (text: string, kind: "success" | "error") => void;
  /** 统一登录页地址（登录后 redirect 回当前对话页）；未登录（no_token）时触发 */
  loginUrl: string;
  /** 未登录：展开登录引导面板 */
  onLoginRequired?: (loginUrl: string) => void;
  /** 工作台 onboarding 地址；未开通频道（channel_not_activated）时触发 */
  channelUrl: string;
  /** 未开通频道：展开创建频道引导面板 */
  onChannelRequired?: (channelUrl: string) => void;
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
    } else if (res?.error === "no_token" && opts.onLoginRequired) {
      // 未登录：展开登录引导（不弹错误 toast）
      opts.onLoginRequired(opts.loginUrl);
    } else if (res?.error === "channel_not_activated" && opts.onChannelRequired) {
      // 已登录但未创建频道：展开创建频道引导
      opts.onChannelRequired(opts.channelUrl);
    } else {
      opts.onResult(`采集失败：${res?.error ?? "未知错误"}`, "error");
    }
  } catch (e) {
    opts.onResult(`采集失败：${e instanceof Error ? e.message : String(e)}`, "error");
  }
}
