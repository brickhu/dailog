// R2 对象直取（SigV4 GET）——TTS 本地合成时下载 host/guest 采样音频：
//   凭证 R2_ACCOUNT_ID/R2_ACCESS_KEY/R2_SECRET_KEY/R2_BUCKET 从 .dailog-editor/.env 读取（gitignored）；
//   代理 R2_PROXY_URL（socks5）可选，缺省 socks5://127.0.0.1:1081（本地大陆网络惯例，见 services/api/.env.local）。
//   采样地址 = 对象 key（如 voices/{userId}/zh.webm——detail/voice-samples 返回的 audioUrl/audioKey）。
import net from "node:net";
import tls from "node:tls";
import https from "node:https";
import crypto from "node:crypto";
import type { EditorConfig } from "./lib.js";

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}
function hx(b: Buffer | string): string {
  return crypto.createHash("sha256").update(b).digest("hex");
}

function parseProxy(raw: string): { host: string; port: number } {
  const m = raw.match(/^(?:socks5h?|socks):\/\/([^:/]+)(?::(\d+))?$/);
  if (!m) throw new Error(`无法解析 SOCKS 代理: ${raw}`);
  return { host: m[1], port: m[2] ? Number(m[2]) : 1080 };
}

function socks5Connect(proxyRaw: string, host: string, port: number): Promise<net.Socket> {
  const proxy = parseProxy(proxyRaw);
  return new Promise((resolve, reject) => {
    const sock = net.connect(proxy.port, proxy.host, () => {
      sock.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    let stage = 0;
    let buf = Buffer.alloc(0);
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 0 && buf.length >= 2) {
        if (buf[1] !== 0x00) return reject(new Error(`SOCKS 认证失败 code=${buf[1]}`));
        buf = buf.subarray(2);
        stage = 1;
        const hostBuf = Buffer.from(host, "utf8");
        sock.write(Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
          hostBuf,
          Buffer.from([(port >> 8) & 0xff, port & 0xff]),
        ]));
      } else if (stage === 1 && buf.length >= 4) {
        const atyp = buf[3];
        const headLen = atyp === 0x01 ? 10 : atyp === 0x03 ? 4 + 1 + buf[4] + 2 : atyp === 0x04 ? 22 : 0;
        if (!headLen) return reject(new Error(`SOCKS 不支持 ATYP=${atyp}`));
        if (buf.length < headLen) return;
        if (buf[1] !== 0x00) return reject(new Error(`SOCKS 连接失败 code=${buf[1]}`));
        sock.removeAllListeners("data");
        resolve(sock);
      }
    });
    sock.on("error", reject);
  });
}

/** SigV4 签名并请求 R2（GET/PUT/DELETE 通用）；body 为 PUT 的内容（Buffer/Uint8Array） */
function r2Request(config: EditorConfig, method: "GET" | "PUT" | "DELETE", key: string, body?: Buffer | Uint8Array): Promise<Uint8Array> {
  const s = config.secrets;
  const accountId = s.R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || "";
  const accessKey = s.R2_ACCESS_KEY || process.env.R2_ACCESS_KEY || "";
  const secretKey = s.R2_SECRET_KEY || process.env.R2_SECRET_KEY || "";
  const bucket = s.R2_BUCKET || process.env.R2_BUCKET || "";
  if (!accountId || !accessKey || !secretKey || !bucket) {
    throw new Error("[r2] 缺少 R2 凭证（R2_ACCOUNT_ID/R2_ACCESS_KEY/R2_SECRET_KEY/R2_BUCKET）——在 .dailog-editor/.env 配置");
  }
  const proxyRaw = s.R2_PROXY_URL || process.env.R2_PROXY_URL || "socks5://127.0.0.1:1081";
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = "auto";
  const service = "s3";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const uri = `/${bucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
  const payload = body ? Buffer.from(body) : Buffer.alloc(0);
  const payloadHash = hx(payload);
  const canonicalHeaders = `host:${host}
x-amz-content-sha256:${payloadHash}
x-amz-date:${amzDate}
`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = `${method}
${uri}

${canonicalHeaders}
${signedHeaders}
${payloadHash}`;
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256
${amzDate}
${scope}
${hx(canonicalRequest)}`;
  const kDate = hmac("AWS4" + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        port: 443,
        path: uri,
        method,
        headers: {
          Authorization: authorization,
          "x-amz-date": amzDate,
          "x-amz-content-sha256": payloadHash,
          host,
          ...(method === "PUT" ? { "content-length": payload.length, "content-type": "application/json" } : {}),
        },
        createConnection: (_opts, cb) => {
          socks5Connect(proxyRaw, host, 443)
            .then((raw) => {
              const secure = tls.connect({ socket: raw, servername: host });
              secure.once("secureConnect", () => cb(null, secure));
              secure.once("error", (e) => cb(e));
            })
            .catch((e) => cb(e));
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          if (res.statusCode !== 200 && res.statusCode !== 204) {
            return reject(new Error(`R2 ${method} ${key} → ${res.statusCode}: ${body.toString("utf8").slice(0, 200)}`));
          }
          resolve(new Uint8Array(body));
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(120000, () => req.destroy(new Error("R2 超时")));
    req.on("error", reject);
    if (method === "PUT") req.write(payload);
    req.end();
  });
}

/** SigV4 GET 下载 R2 对象（读采样/对话） */
export function getR2Object(config: EditorConfig, key: string): Promise<Uint8Array> {
  return r2Request(config, "GET", key);
}

/** SigV4 PUT 上传 R2 对象（JSON 内容） */
export function putR2Object(config: EditorConfig, key: string, body: string | Buffer | Uint8Array): Promise<Uint8Array> {
  return r2Request(config, "PUT", key, typeof body === "string" ? Buffer.from(body, "utf8") : body);
}

/** SigV4 DELETE R2 对象（不存在也视为成功——幂等） */
export function deleteR2Object(config: EditorConfig, key: string): Promise<Uint8Array> {
  return r2Request(config, "DELETE", key);
}

/** 对话 R2 key：URL 哈希（确定性 ID，同 URL 多端共享同一份） */
export function dialogueR2Key(url: string): string {
  return "dialogues/" + hx(Buffer.from(url, "utf8")).slice(0, 32) + ".json";
}

