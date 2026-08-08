// 主世界 hook（manifest content_scripts world:"MAIN" 注入——不受页面 CSP 限制）。
// 拦截页面自身 fetch/XHR，按响应形状识别对话数据（mapping/chat_messages/messages），
// postMessage 回传 content script。自包含、无 import。

(() => {
  const win = window as unknown as Window & { __dailogSniff?: boolean };
  if (win.__dailogSniff) return;
  win.__dailogSniff = true;

  const looksLike = (j: unknown): boolean => {
    if (!j || typeof j !== "object") return false;
    // 顶层直匹配（chatgpt mapping / claude chat_messages）
    if ((j as { mapping?: unknown }).mapping && typeof (j as { mapping?: unknown }).mapping === "object") return true;
    if (Array.isArray((j as { chat_messages?: unknown }).chat_messages)) return true;
    if (Array.isArray((j as { messages?: unknown }).messages)) return true;
    // 深层按 key 名找消息数组（deepseek: data.biz_data.messages 等；深度 ≤3 防大响应卡顿）
    const find = (o: unknown, depth: number): boolean => {
      if (!o || typeof o !== "object" || depth > 3) return false;
      for (const k of Object.keys(o as Record<string, unknown>)) {
        const v = (o as Record<string, unknown>)[k];
        if (
          /message|msg|list|items/i.test(k) &&
          Array.isArray(v) &&
          v.length > 0 &&
          typeof v[0] === "object" &&
          (v[0] as { role?: unknown }).role != null
        ) {
          return true;
        }
        if (find(v, depth + 1)) return true;
      }
      return false;
    };
    return find(j, 0);
  };

  const report = (url: string, data: unknown): void => {
    win.postMessage({ type: "dailog:conversation", url, data }, "*");
  };

  const of = win.fetch as unknown as (...args: unknown[]) => Promise<Response>;
  if (typeof of === "function") {
    win.fetch = ((...args: unknown[]) => {
      const p = of.apply(win, args);
      const url = typeof args[0] === "string" ? args[0] : ((args[0] as { url?: string })?.url ?? "");
      p.then((res: Response) => {
        try {
          res.clone().json().then((j: unknown) => {
            if (looksLike(j)) report(url, j);
          }).catch(() => {});
        } catch (e) { /* 流式响应跳过 */ }
      }).catch(() => {});
      return p;
    }) as typeof win.fetch;
  }

  const ox = XMLHttpRequest.prototype.open as (this: XMLHttpRequest, method: string, url: string | URL) => void;
  const os = XMLHttpRequest.prototype.send as unknown as (...args: unknown[]) => void;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL) {
    (this as XMLHttpRequest & { __dailogUrl?: string }).__dailogUrl = String(url);
    return ox.call(this, method, url);
  };
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: unknown[]) {
    this.addEventListener("load", () => {
      try {
        const j: unknown = JSON.parse(this.responseText);
        if (looksLike(j)) report((this as XMLHttpRequest & { __dailogUrl?: string }).__dailogUrl ?? "", j);
      } catch (e) { /* 非 JSON 跳过 */ }
    });
    return os.apply(this, args);
  };
})();
