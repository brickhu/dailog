// 最小 chrome.runtime 类型声明（扩展运行时有全局 chrome，tsconfig 仅含 node types）
declare const chrome: {
  runtime: {
    onMessage: {
      addListener: (listener: (message: any, sender: any, sendResponse: (response: unknown) => void) => boolean | void) => void;
    };
    sendMessage: (message: unknown) => Promise<unknown>;
  };
};

import { MSG_COLLECT, type CollectResult } from "./shared";
import { collectFromDocument } from "./content/collector";
import { parseDeepSeekPage } from "./content/deepseek";
import { waitForMutation } from "./content/mutation";
import { createFab } from "./content/ui";
import { runCollectFlow } from "./content/collect-flow";

function deepSeekScroll() {
  const container = document.querySelector(".ds-scroll-area");
  if (!container) return undefined;
  return {
    container,
    readNodes: async () => parseDeepSeekPage(document),
    waitForMutation: () => waitForMutation(document.body),
  };
}

// 浮动采集按钮（支持平台对话页注入，manifest matches 已限定）
const fab = createFab({
  onClick: () => {
    fab.setBusy(true);
    void runCollectFlow({
      collect: () => collectFromDocument({ root: document, url: location.href, scroll: deepSeekScroll() }),
      send: async (msg) => (await chrome.runtime.sendMessage(msg)) as CollectResult | undefined,
      onResult: (text, kind) => fab.showToast(text, kind),
    }).finally(() => fab.setBusy(false));
  },
});

// 保留消息监听（供未来 popup/扩展页触发采集）
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== MSG_COLLECT) return;
  collectFromDocument({ root: document, url: location.href, scroll: deepSeekScroll() })
    .then((dialogue) => {
      const result: CollectResult = dialogue
        ? { ok: true, dialogue }
        : { ok: false, error: "collect_empty" };
      sendResponse(result);
    })
    .catch((e) => sendResponse({ ok: false, error: String(e instanceof Error ? e.message : e) }));
  return true; // 异步响应
});
