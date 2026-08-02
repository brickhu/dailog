// 最小 chrome.runtime 类型声明（扩展运行时有全局 chrome，tsconfig 仅含 node types）
declare const chrome: {
  runtime: {
    onMessage: {
      addListener: (listener: (message: any, sender: any, sendResponse: (response: unknown) => void) => boolean | void) => void;
    };
  };
};

import { MSG_COLLECT, type CollectResult } from "./shared";
import { collectFromDocument } from "./content/collector";
import { parseDeepSeekPage } from "./content/deepseek";
import { waitForMutation } from "./content/mutation";

function deepSeekScroll() {
  const container = document.querySelector(".ds-scroll-area");
  if (!container) return undefined;
  return {
    container,
    readNodes: async () => parseDeepSeekPage(document),
    waitForMutation: () => waitForMutation(document.body),
  };
}

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
