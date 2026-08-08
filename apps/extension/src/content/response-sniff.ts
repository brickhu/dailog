// 主世界响应拦截：页面自身发起的对话详情请求（可能带加密认证/token，如
// chatgpt 已移除 localStorage __session）由主世界 hook 抓取响应，postMessage
// 回传 content script——不依赖 token、不猜端点，按响应形状识别对话数据。

/** 已捕获的对话数据（URL → 数据） */
const captured = new Map<string, unknown>();

/** 监听主世界 hook 回传（hook 由 manifest world:"MAIN" content script 注入——
 *  不受页面 CSP 限制；幂等） */
export function installResponseSniff(): void {
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (d?.type === "dailog:conversation" && typeof d.url === "string") {
      captured.set(d.url, d.data);
      console.info(`[dailog] sniff captured: ${d.url}`);
    }
  });
}

/** 按对话 id 查已捕获的对话数据（URL 含 /{id}） */
export function findCapturedConversation(id: string): unknown | null {
  for (const [url, data] of captured) {
    if (url.includes(`/${id}`)) return data;
  }
  return null;
}

/** 清空捕获（采集结束/取消；会话内可复用） */
export function clearCapturedConversations(): void {
  captured.clear();
}
