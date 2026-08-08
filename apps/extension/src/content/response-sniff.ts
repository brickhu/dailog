// 主世界响应拦截：页面自身发起的对话详情请求（可能带加密认证/token，如
// chatgpt 已移除 localStorage __session）由主世界 hook 抓取响应，postMessage
// 回传 content script——不依赖 token、不猜端点，按响应形状识别对话数据。

/** 注入主世界的 hook 源码（fetch + XHR 双钩子；按响应形状识别对话：
 *  mapping（chatgpt）/ chat_messages（claude）/ messages 数组） */
const HOOK_SOURCE = `
(function () {
  if (window.__dailogSniff) return;
  window.__dailogSniff = true;
  var looksLike = function (j) {
    return !!j && typeof j === "object" && (
      (j.mapping && typeof j.mapping === "object") ||
      (j.chat_messages && Array.isArray(j.chat_messages)) ||
      (Array.isArray(j.messages))
    );
  };
  var report = function (url, data) {
    window.postMessage({ type: "dailog:conversation", url: url, data: data }, "*");
  };
  // fetch 钩子
  var of = window.fetch;
  if (of) {
    window.fetch = function () {
      var p = of.apply(this, arguments);
      var url = typeof arguments[0] === "string" ? arguments[0] : (arguments[0] && arguments[0].url) || "";
      p.then(function (res) {
        try {
          res.clone().json().then(function (j) {
            if (looksLike(j)) report(url, j);
          }).catch(function () {});
        } catch (e) {}
      }).catch(function () {});
      return p;
    };
  }
  // XHR 钩子
  var ox = window.XMLHttpRequest.prototype.open;
  var os = window.XMLHttpRequest.prototype.send;
  window.XMLHttpRequest.prototype.open = function (method, url) {
    this.__dailogUrl = url;
    return ox.apply(this, arguments);
  };
  window.XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    this.addEventListener("load", function () {
      try {
        var j = JSON.parse(xhr.responseText);
        if (looksLike(j)) report(xhr.__dailogUrl || "", j);
      } catch (e) {}
    });
    return os.apply(this, arguments);
  };
})();
`;

/** 已捕获的对话数据（URL → 数据） */
const captured = new Map<string, unknown>();

/** 注入主世界 hook 并监听回传（幂等；须在 document_start 调用，
 *  早于页面自身请求） */
export function installResponseSniff(): void {
  if (document.querySelector("script[data-dailog-sniff]")) return;
  const s = document.createElement("script");
  s.setAttribute("data-dailog-sniff", "");
  s.textContent = HOOK_SOURCE;
  (document.head ?? document.documentElement).appendChild(s);
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
