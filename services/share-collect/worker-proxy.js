// dailog 分享采集转发代理（Cloudflare Worker）
// 用途：share-collect 服务被目标站点 Cloudflare 拦截时，经此转发——
// Worker 出口是 Cloudflare 网络，访问 CF 保护的域名（claude.ai）通常放行。
//
// 部署：Cloudflare Dashboard → Workers & Pages → Create Worker → 粘贴本脚本
//   → Settings → Variables 配 TOKEN（随机长字符串）
// 调用：GET https://<worker>.workers.dev/?token=<TOKEN>&url=<目标URL>
//
// 防滥用（这是公开可达的开放代理，必须收紧）：
//   1) token 校验（与 share-collect 的 CF_WORKER_URL 共享）
//   2) 目标域名白名单——只允许采集所需的域名

const ALLOWED_DOMAINS = [
  "claude.ai",
  "chatgpt.com",
  "chat.deepseek.com",
  "doubao.com",
  "kimi.com",
  "share.gemini.google",
];

export default {
  async fetch(request, env) {
    if (request.method !== "GET") {
      return new Response("method not allowed", { status: 405 });
    }
    const url = new URL(request.url);
    if (url.searchParams.get("token") !== env.TOKEN) {
      return new Response("unauthorized", { status: 401 });
    }
    const target = url.searchParams.get("url");
    if (!target) {
      return new Response("missing url", { status: 400 });
    }
    let t;
    try {
      t = new URL(target);
    } catch {
      return new Response("invalid url", { status: 400 });
    }
    if (!ALLOWED_DOMAINS.some((d) => t.hostname === d || t.hostname.endsWith("." + d))) {
      return new Response("domain not allowed", { status: 403 });
    }
    const res = await fetch(target, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
      redirect: "follow",
    });
    // 只透传必要响应头（content-type 必须；大小受 Workers 免费层限制
    // 100KB——claude chat_snapshots ~57KB 在限制内）
    return new Response(res.body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      },
    });
  },
};
