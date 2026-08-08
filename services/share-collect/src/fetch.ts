// 传输层：undici（Node 原生 HTTP 客户端）+ 可选 SOCKS5 代理池。
// 平台规则变化时（IP 被封/CF 收紧），调整代理配置即可，无需动业务逻辑。
// SOCKS_PROXY 支持逗号分隔多代理——按请求轮换（claude/gemini 被 CF 拦时
// 换下一个代理重试，见 platforms/claude.ts）。

import { request, Socks5ProxyAgent, ProxyAgent, type Dispatcher } from "undici";

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

/** 经 Bright Data Web Unlocker HTTP 代理抓取（专治 CF 挑战）。
 *  BRIGHTDATA_PROXY 形如 http://<zone-user>:<zone-pass>@brd.superproxy.io:22225
 *  ——zone 凭据（username:password）连接代理端点，无需 API token */
export async function httpGetViaBrightdataProxy(targetUrl: string): Promise<HttpResult> {
  const proxyUrl = process.env.BRIGHTDATA_PROXY;
  if (!proxyUrl) throw new Error("BRIGHTDATA_PROXY 未配置");
  const options: RequestOptions = {
    method: "GET",
    headers: { "user-agent": UA, accept: "application/json, text/html, */*" },
    ...{ dispatcher: new ProxyAgent(proxyUrl) },
    headersTimeout: 60000,
    bodyTimeout: 60000,
  };
  return runRequest(targetUrl, options, "GET");
}

/** 经 ScraperAPI 抓取（免费 1000 次/月，IP 池含住宅，能过 CF 挑战）。
 *  一个 GET 请求：api.scraperapi.com/?api_key=<key>&url=<目标>，响应体即目标内容 */
export async function httpGetViaScraperApi(targetUrl: string): Promise<HttpResult> {
  const apiKey = process.env.SCRAPERAPI_KEY;
  if (!apiKey) throw new Error("SCRAPERAPI_KEY 未配置");
  const apiUrl = `https://api.scraperapi.com/?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(targetUrl)}`;
  const options: RequestOptions = {
    method: "GET",
    headers: { accept: "application/json, text/html, */*" },
    headersTimeout: 60000,
    bodyTimeout: 60000,
  };
  return runRequest(apiUrl, options, "GET");
}

/** 经 Cloudflare Worker 转发（出口 = CF 网络，访问 CF 保护的域名通常放行）。
 *  CF_WORKER_URL 形如 https://<worker>.workers.dev/?token=<TOKEN> */
export async function httpGetViaWorker(targetUrl: string): Promise<HttpResult> {
  const workerUrl = process.env.CF_WORKER_URL;
  if (!workerUrl) throw new Error("CF_WORKER_URL 未配置");
  const sep = workerUrl.includes("?") ? "&" : "?";
  return httpGet(`${workerUrl}${sep}url=${encodeURIComponent(targetUrl)}`);
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
