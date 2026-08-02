import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";
import { SocksProxyAgent } from "socks-proxy-agent";
import type { ClientRequest } from "node:http";

// 代理 fetch 工厂（FISH_PROXY_URL 本地 socks5）：
// - 未配置 → 原生 fetch（直连）
// - socks5://（本地代理）→ undici Agent 自定义 connect：SocksProxyAgent 建穿隧 socket
// - http(s):// → undici 原生 ProxyAgent（CONNECT 隧道 / absolute-form 转发）
//
// 注意：undici 8 的 dispatcher 与 Node 内置 fetch 的 handler 协议不兼容
// （实测 Node 22 报 "invalid onRequestStart method"），代理路径必须用 undici 自带的 fetch。
// 该 socks 组合已在本地真实 socks5 代理 + http/https 目标服务器上验证通过
// （服务端生产环境直连无需代理；真实 Fish 经本地代理的 E2E 见 Task 12）。

const SOCKS_PROTOCOLS = new Set(["socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"]);

/** socks-proxy-agent 的 connect 只用到 req 的 emit/destroy（错误清理时），传空桩即可 */
function noopReq(): ClientRequest {
  return { emit() {}, destroy() {} } as unknown as ClientRequest;
}

export function createProxyFetch(proxyUrl?: string): typeof fetch {
  if (!proxyUrl) return fetch;
  const protocol = new URL(proxyUrl).protocol;
  if (SOCKS_PROTOCOLS.has(protocol)) {
    const socks = new SocksProxyAgent(proxyUrl);
    const req = noopReq();
    const agent = new Agent({
      // 替换 undici 默认 TCP/TLS connector：socket 经 socks 代理建立（https 时 socks 自行 TLS）
      connect(options, callback) {
        socks
          .connect(req, {
            host: options.hostname,
            port: Number(options.port),
            secureEndpoint: options.protocol === "https:",
          })
          .then((socket) => callback(null, socket), (err) => callback(err, null));
      },
    });
    return ((input, init) =>
      // undici 的 RequestInfo/Response/RequestInit 类型与全局版不同（textStream/duplex/window 等），统一断言
      undiciFetch(input as never, { ...init, dispatcher: agent } as never)) as typeof fetch;
  }
  const agent = new ProxyAgent(proxyUrl);
  return ((input, init) =>
    undiciFetch(input as never, { ...init, dispatcher: agent } as never)) as typeof fetch;
}
