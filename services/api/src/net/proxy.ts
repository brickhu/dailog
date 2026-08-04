import { ProxyAgent, fetch as undiciFetch } from "undici";
import net from "node:net";
import tls from "node:tls";
import https from "node:https";
import { randomBytes } from "node:crypto";
import type { ClientRequestArgs } from "node:http";
import type { Duplex } from "node:stream";

// 代理 fetch 工厂（FISH_PROXY_URL 本地 socks5）：
// - 未配置 → 原生 fetch（直连）
// - socks5:// → 自实现传输：SOCKS5 握手 → TLS 包装 → https.request
//   （校准自 scripts/spikes/fish-audio.mjs rawRequest，真实 api.fish.audio 上 89ms 建连；
//    此前 undici+SocksProxyAgent 组合在真实 Fish 上挂起 20s 后 "fetch failed"，已弃用）
// - http(s):// → undici 原生 ProxyAgent（CONNECT 隧道 / absolute-form 转发）
//
// 注意：undici 8 的 dispatcher 与 Node 内置 fetch 的 handler 协议不兼容
// （实测 Node 22 报 "invalid onRequestStart method"），http 代理路径必须用 undici 自带的 fetch。

const SOCKS_PROTOCOLS = new Set(["socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"]);
const HANDSHAKE_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 180_000;

export function createProxyFetch(proxyUrl?: string): typeof fetch {
  if (!proxyUrl) return fetch;
  const u = new URL(proxyUrl); // 非法 URL 在构造期抛出
  if (SOCKS_PROTOCOLS.has(u.protocol)) return createSocksFetch(u.hostname, Number(u.port || 1081));
  const agent = new ProxyAgent(proxyUrl);
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    // undici 的 RequestInfo/Response/RequestInit 类型与全局版不同（textStream/duplex/window 等），统一断言
    undiciFetch(input as never, { ...init, dispatcher: agent } as never)) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// SOCKS5 传输（移植自 spike：远端 DNS、免认证、15s 握手防挂起）
// ---------------------------------------------------------------------------

interface SocksTarget {
  host: string;
  port: number;
}

function socks5Connect(proxy: SocksTarget, target: SocksTarget): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: proxy.host, port: proxy.port });
    let buf = Buffer.alloc(0);
    let stage = 0; // 0: greeting, 1: CONNECT reply
    // 握手阶段防挂起：代理接受 TCP 但永不回应时，15s 后销毁并拒绝（请求级 setTimeout 不覆盖此阶段）
    const fail = (e: Error) => {
      sock.setTimeout(0);
      sock.destroy();
      reject(e);
    };
    sock.once("error", fail);
    sock.setTimeout(HANDSHAKE_TIMEOUT_MS, () => fail(new Error(`SOCKS5 握手超时（${proxy.host}:${proxy.port}）`)));
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 0) {
        if (buf.length < 2) return;
        if (buf[1] !== 0x00) return fail(new Error(`SOCKS5 代理不接受免认证连接（code ${buf[1]}）`));
        buf = buf.subarray(2);
        stage = 1;
        const hb = Buffer.from(target.host, "utf8");
        const p = Buffer.alloc(2);
        p.writeUInt16BE(target.port, 0);
        sock.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hb.length]), hb, p]));
      } else {
        if (buf.length < 10) return;
        if (buf[1] !== 0x00) return fail(new Error(`SOCKS5 CONNECT 失败（code ${buf[1]}）`));
        sock.removeListener("data", onData);
        sock.removeListener("error", fail);
        sock.setTimeout(0); // 握手完成，交回 TLS/请求阶段，解除防挂起超时
        resolve(sock);
      }
    };
    sock.on("data", onData);
    sock.write(Buffer.from([0x05, 0x01, 0x00]));
  });
}

/** 最小 Response shim：消费方只用到 ok/status/text/arrayBuffer/json */
class SocksResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Buffer;

  constructor(status: number, headers: Record<string, string | string[] | undefined>, body: Buffer) {
    this.status = status;
    this.headers = new Headers();
    for (const [k, v] of Object.entries(headers)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x) => this.headers.append(k, x));
      else this.headers.set(k, v);
    }
    this.body = body;
  }

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  async text(): Promise<string> {
    return this.body.toString("utf8");
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.body.buffer.slice(
      this.body.byteOffset,
      this.body.byteOffset + this.body.byteLength
    ) as ArrayBuffer;
  }

  async json(): Promise<unknown> {
    return JSON.parse(this.body.toString("utf8"));
  }
}

/** FormData → multipart（undici 迭代给 Blob 附加 .name 即 filename，见 tts/client createVoiceModel） */
async function encodeMultipart(form: FormData): Promise<{ body: Buffer; contentType: string }> {
  const boundary = "----dailog" + randomBytes(8).toString("hex");
  const parts: Buffer[] = [];
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") {
      parts.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
      );
    } else {
      const blob = value as Blob & { name?: string };
      const fileBuf = Buffer.from(await blob.arrayBuffer());
      const filename = blob.name ?? "file";
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\n` +
            `Content-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`
        )
      );
      parts.push(fileBuf, Buffer.from("\r\n"));
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

function createSocksFetch(proxyHost: string, proxyPort: number): typeof fetch {
  const proxy = { host: proxyHost, port: proxyPort };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of new Headers(init.headers).entries()) headers[k] = v;
    }
    let body: Buffer = Buffer.alloc(0);
    if (init?.body != null) {
      if (typeof init.body === "string") body = Buffer.from(init.body);
      else if (init.body instanceof Uint8Array) body = Buffer.from(init.body);
      else if (init.body instanceof ArrayBuffer) body = Buffer.from(init.body);
      else if (typeof FormData !== "undefined" && init.body instanceof FormData) {
        const mp = await encodeMultipart(init.body);
        body = mp.body;
        headers["Content-Type"] = mp.contentType;
      } else {
        throw new Error(`socks fetch: 不支持的 body 类型 ${typeof init.body}`);
      }
    }

    const { status, headers: respHeaders, body: respBody } = await rawRequest(proxy, {
      host: u.hostname,
      port: Number(u.port || (u.protocol === "https:" ? 443 : 80)),
      path: u.pathname + u.search,
      method,
      headers,
      body,
    });
    return new SocksResponse(status, respHeaders, respBody) as unknown as Response;
  }) as unknown as typeof fetch;
}

function rawRequest(
  proxy: SocksTarget,
  opts: {
    host: string;
    port: number;
    path: string;
    method: string;
    headers: Record<string, string>;
    body: Buffer;
  }
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    // 异步建连经 oncreate 回调交回 socket；Node 类型要求返回 Duplex|null|undefined，运行时返回 null 安全
    const createConnection = (
      _options: ClientRequestArgs,
      cb: (err: Error | null, socket?: Duplex) => void
    ): null => {
      socks5Connect(proxy, { host: opts.host, port: opts.port })
        .then((raw) => {
          const secure = tls.connect({ socket: raw, servername: opts.host });
          secure.once("secureConnect", () => cb(null, secure));
          secure.once("error", (e) => cb(e));
        })
        .catch((e) => cb(e));
      return null;
    };
    const req = https.request(
      {
        host: opts.host,
        port: opts.port,
        path: opts.path,
        method: opts.method,
        headers: opts.headers,
        createConnection: createConnection as unknown as https.RequestOptions["createConnection"],
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })
        );
        res.on("error", reject);
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error(`请求超时（${REQUEST_TIMEOUT_MS}ms）`)));
    req.on("error", reject);
    if (opts.body.length > 0) req.write(opts.body);
    req.end();
  });
}
