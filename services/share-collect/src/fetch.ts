// 传输层：undici（Node 原生 HTTP 客户端）+ 可选 SOCKS5 代理池。
// 平台规则变化时（IP 被封/CF 收紧），调整代理配置即可，无需动业务逻辑。
// SOCKS_PROXY 支持逗号分隔多代理——按请求轮换（claude/gemini 被 CF 拦时
// 换下一个代理重试，见 platforms/claude.ts）。

import { request, Socks5ProxyAgent, type Dispatcher } from "undici";

// request() 的重载参数：Omit 掉由 url 参数提供的字段
type RequestOptions = Omit<Dispatcher.RequestOptions, "origin" | "method" | "path"> & Partial<Pick<Dispatcher.RequestOptions, "method">>;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** 代理池（SOCKS_PROXY=socks5://a:1080,socks5://b:1080） */
const proxies: string[] = (process.env.SOCKS_PROXY ?? "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

/** 默认通道：配了代理就走第一个代理，没配就直连（服务器无代理环境 = 直连） */
export const defaultProxy: string | undefined = proxies[0];

/** 按序号取代理池中的代理（0 = 默认通道同款，从 1 起是额外通道） */
export function proxyForIndex(i: number): string | undefined {
  if (proxies.length === 0) return undefined;
  return proxies[i % proxies.length];
}

export const hasProxies = proxies.length > 0;

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  url: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public cf: boolean,
  ) {
    super(message);
  }
}

function isCfChallenge(headers: Record<string, string>): boolean {
  const server = headers["server"] ?? "";
  const cfMitigated = headers["cf-mitigated"] ?? "";
  return cfMitigated === "challenge" || server.includes("cloudflare");
}

/** GET（带 UA；referer 可选）。默认 20s 超时。proxy 缺省 = 默认通道 */
export async function httpGet(
  url: string,
  opts: { referer?: string; timeoutMs?: number; proxy?: string } = {},
): Promise<HttpResult> {
  const { referer, timeoutMs = 20000 } = opts;
  const proxy = opts.proxy ?? defaultProxy;
  const options: RequestOptions = {
    method: "GET",
    headers: {
      "user-agent": UA,
      accept: "application/json, text/html, */*",
      ...(referer ? { referer } : {}),
    },
    ...(proxy ? { dispatcher: new Socks5ProxyAgent(proxy) } : {}),
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  };
  return runRequest(url, options, "GET");
}

/** POST form（batchexecute 等需要原始 form body 的接口）。proxy 缺省 = 默认通道 */
export async function httpPostForm(
  url: string,
  formBody: string,
  opts: { timeoutMs?: number; proxy?: string; contentType?: string } = {},
): Promise<HttpResult> {
  const { timeoutMs = 20000, contentType = "application/x-www-form-urlencoded;charset=UTF-8" } = opts;
  const proxy = opts.proxy ?? defaultProxy;
  const options: RequestOptions = {
    method: "POST",
    headers: {
      "user-agent": UA,
      "content-type": contentType,
      accept: "*/*",
    },
    body: formBody,
    ...(proxy ? { dispatcher: new Socks5ProxyAgent(proxy) } : {}),
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  };
  return runRequest(url, options, "POST");
}

async function runRequest(url: string, options: RequestOptions, method: string): Promise<HttpResult> {
  let res;
  try {
    res = await request(url, options);
  } catch (e) {
    throw new Error(`网络错误(${method}): ${e instanceof Error ? e.message : String(e)}`);
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    if (typeof v === "string") headers[k.toLowerCase()] = v;
  }
  const body = await res.body.text().catch(() => "");
  if (res.statusCode >= 400) {
    throw new HttpError(res.statusCode, `HTTP ${res.statusCode}`, isCfChallenge(headers));
  }
  return { status: res.statusCode, headers, body, url };
}
