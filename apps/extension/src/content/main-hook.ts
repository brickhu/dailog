// 主世界 hook（manifest content_scripts world:"MAIN" 注入——不受页面 CSP 限制）。
// 拦截页面自身 fetch/XHR，按响应形状识别对话数据（mapping/chat_messages/messages），
// postMessage 回传 content script。自包含、无 import。

(() => {
  const win = window as unknown as Window & { __dailogSniff?: boolean };
  if (win.__dailogSniff) return;
  win.__dailogSniff = true;

  const looksLike = (j: unknown): boolean =>
    !!j && typeof j === "object" &&
    ((j as { mapping?: unknown }).mapping && typeof (j as { mapping?: unknown }).mapping === "object" ||
      Array.isArray((j as { chat_messages?: unknown }).chat_messages) ||
      Array.isArray((j as { messages?: unknown }).messages));

  const report = (url: string, data: unknown): void => {
    win.postMessage({ type: "dailog:conversation", url, data }, "*");
  };

  const of = win.fetch;
  if (typeof of === "function") {
    win.fetch = ((...args: Parameters<typeof of>) => {
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

  const ox = XMLHttpRequest.prototype.open;
  const os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL) {
    (this as XMLHttpRequest & { __dailogUrl?: string }).__dailogUrl = String(url);
    return ox.call(this, method, url);
  };
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: Parameters<typeof os>) {
    this.addEventListener("load", () => {
      try {
        const j: unknown = JSON.parse(this.responseText);
        if (looksLike(j)) report((this as XMLHttpRequest & { __dailogUrl?: string }).__dailogUrl ?? "", j);
      } catch (e) { /* 非 JSON 跳过 */ }
    });
    return os.apply(this, args);
  };
})();
