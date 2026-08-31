// 本地直连 Fish Audio 合成（编辑工作台标准路径——不再绕服务端 /v1/editor/tts）：
//   密钥 FISH_API_KEY 从 .dailog-editor/.env 读取（gitignored，chmod 600）；
//   代理 FISH_PROXY_URL（socks5）可选，缺省 socks5://127.0.0.1:1081（本地大陆网络惯例，见 spikes）。
//   多说话人：text 内嵌 <|speaker:N|> 标签 + references 2D 内联音频（实测两方音色均正确，见 2026-08-29 排障）；
//   纯单说话人：references 1D 内联（实测稳定）。
//   402（免费额度耗尽）→ 自动降级付费模型 s2.1-pro 重试。
import net from "node:net";
import tls from "node:tls";
import https from "node:https";
import { msgpackEncode } from "./msgpack.js";
import type { EditorConfig } from "./lib.js";

const FISH_HOST = "api.fish.audio";
const MODEL_FREE = "s2.1-pro-free";
const MODEL_PAID = "s2.1-pro";
/** 参考音频转录占位文本（无真实转录时用；转录准确度影响克隆质量） */
const REF_TRANSCRIPT = "你好，欢迎收听 dailog。这是参考音频的转录文本，用于声音克隆测试。";

export interface FishSegment {
  /** 0 = host（主持人采样），1 = guest（嘉宾声线） */
  speaker: 0 | 1;
  text: string;
}

interface ReferenceAudio {
  audio: Uint8Array;
  text: string;
}

function parseProxy(raw: string): { host: string; port: number } {
  const m = raw.match(/^(?:socks5h?|socks):\/\/([^:/]+)(?::(\d+))?$/);
  if (!m) throw new Error(`无法解析 SOCKS 代理: ${raw}`);
  return { host: m[1], port: m[2] ? Number(m[2]) : 1080 };
}

/** socks5 连接（无认证）→ 返回已连通的裸 socket（后续 tls 包裹） */
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

function rawRequest(proxyRaw: string | null, options: { method: string; path: string; headers: Record<string, string>; body?: Buffer; timeoutMs: number }): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers };
    const req = https.request(
      {
        host: FISH_HOST,
        port: 443,
        path: options.path,
        method: options.method,
        headers,
        createConnection: proxyRaw
          ? (_opts, cb) => {
              socks5Connect(proxyRaw, FISH_HOST, 443)
                .then((raw) => {
                  const secure = tls.connect({ socket: raw, servername: FISH_HOST });
                  secure.once("secureConnect", () => cb(null, secure));
                  secure.once("error", (e) => cb(e));
                })
                .catch((e) => cb(e));
            }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.setTimeout(options.timeoutMs, () => req.destroy(new Error(`请求超时（${options.timeoutMs}ms）`)));
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

/** 带鉴权的 Fish 请求；402 免费额度不足 → 自动切付费模型重试一次 */
async function fishPost(secrets: Record<string, string>, path: string, body: Buffer, timeoutMs: number): Promise<Buffer> {
  const key = secrets.FISH_API_KEY || process.env.FISH_API_KEY || "";
  if (!key) {
    throw new Error("[tts] 缺少 FISH_API_KEY——在 .dailog-editor/.env 配置（https://fish.audio 控制台创建）");
  }
  const proxyRaw = secrets.FISH_PROXY_URL || process.env.FISH_PROXY_URL || null;
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/msgpack", model: MODEL_FREE };
  const res = await rawRequest(proxyRaw, { method: "POST", path, headers, body, timeoutMs });
  if (res.status === 402) {
    // 免费额度耗尽：降级付费模型重试（不中断生成）
    const res2 = await rawRequest(proxyRaw, { method: "POST", path, headers: { ...headers, model: MODEL_PAID }, body, timeoutMs });
    if (res2.status >= 200 && res2.status < 300) return res2.body;
    throw new Error(`tts http_${res2.status}: ${res2.body.toString("utf8").slice(0, 300)}`);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`tts http_${res.status}: ${res.body.toString("utf8").slice(0, 300)}`);
  }
  return res.body;
}

/**
 * 多说话人合成（两人对谈）：text 内嵌 <|speaker:0|>/<|speaker:1|> 标签，
 * references 2D [[host 采样], [guest 声线]]——官方多说话人接口，实测两方音色均正确。
 */
export async function synthesizeMultiSpeaker(
  config: EditorConfig,
  segments: FishSegment[],
  hostRef: ReferenceAudio,
  guestRef: ReferenceAudio,
  timeoutMs = 600000,
): Promise<Buffer> {
  const text = segments.map((s) => `<|speaker:${s.speaker}|>${s.text}`).join("");
  const body = msgpackEncode({
    text,
    references: [[{ audio: hostRef.audio, text: hostRef.text }], [{ audio: guestRef.audio, text: guestRef.text }]],
    format: "mp3",
    mp3_bitrate: 128,
    // 基于已生成 chunk 条件生成，保证长段内音色/语调连贯
    condition_on_previous_chunks: true,
  });
  return fishPost(config.secrets, "/v1/tts", body as unknown as Buffer, timeoutMs);
}

/** 单说话人合成（纯 host 段，如点题/收尾）：references 1D 内联 host 采样——实测稳定 */
export async function synthesizeSingle(
  config: EditorConfig,
  text: string,
  hostRef: ReferenceAudio,
  timeoutMs = 600000,
): Promise<Buffer> {
  const body = msgpackEncode({
    text,
    references: [{ audio: hostRef.audio, text: hostRef.text ?? REF_TRANSCRIPT }],
    format: "mp3",
    mp3_bitrate: 128,
    // 基于已生成 chunk 条件生成，保证长段内音色/语调连贯
    condition_on_previous_chunks: true,
  });
  return fishPost(config.secrets, "/v1/tts", body as unknown as Buffer, timeoutMs);
}
