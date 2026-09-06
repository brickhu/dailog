import net from "node:net";
import tls from "node:tls";
import https from "node:https";
import { msgpackEncode } from "./msgpack.mjs";
const FISH_HOST = "api.fish.audio";
const MODEL_FREE = "s2.1-pro-free";
const MODEL_PAID = "s2.1-pro";
const REF_TRANSCRIPT = "\u4F60\u597D\uFF0C\u6B22\u8FCE\u6536\u542C dailog\u3002\u8FD9\u662F\u53C2\u8003\u97F3\u9891\u7684\u8F6C\u5F55\u6587\u672C\uFF0C\u7528\u4E8E\u58F0\u97F3\u514B\u9686\u6D4B\u8BD5\u3002";
function parseProxy(raw) {
  const m = raw.match(/^(?:socks5h?|socks):\/\/([^:/]+)(?::(\d+))?$/);
  if (!m) throw new Error(`\u65E0\u6CD5\u89E3\u6790 SOCKS \u4EE3\u7406: ${raw}`);
  return { host: m[1], port: m[2] ? Number(m[2]) : 1080 };
}
function socks5Connect(proxyRaw, host, port) {
  const proxy = parseProxy(proxyRaw);
  return new Promise((resolve, reject) => {
    const sock = net.connect(proxy.port, proxy.host, () => {
      sock.write(Buffer.from([5, 1, 0]));
    });
    let stage = 0;
    let buf = Buffer.alloc(0);
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 0 && buf.length >= 2) {
        if (buf[1] !== 0) return reject(new Error(`SOCKS \u8BA4\u8BC1\u5931\u8D25 code=${buf[1]}`));
        buf = buf.subarray(2);
        stage = 1;
        const hostBuf = Buffer.from(host, "utf8");
        sock.write(Buffer.concat([
          Buffer.from([5, 1, 0, 3, hostBuf.length]),
          hostBuf,
          Buffer.from([port >> 8 & 255, port & 255])
        ]));
      } else if (stage === 1 && buf.length >= 4) {
        const atyp = buf[3];
        const headLen = atyp === 1 ? 10 : atyp === 3 ? 4 + 1 + buf[4] + 2 : atyp === 4 ? 22 : 0;
        if (!headLen) return reject(new Error(`SOCKS \u4E0D\u652F\u6301 ATYP=${atyp}`));
        if (buf.length < headLen) return;
        if (buf[1] !== 0) return reject(new Error(`SOCKS \u8FDE\u63A5\u5931\u8D25 code=${buf[1]}`));
        sock.removeAllListeners("data");
        resolve(sock);
      }
    });
    sock.on("error", reject);
  });
}
function rawRequest(proxyRaw, options) {
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers };
    const req = https.request(
      {
        host: FISH_HOST,
        port: 443,
        path: options.path,
        method: options.method,
        headers,
        createConnection: proxyRaw ? (_opts, cb) => {
          socks5Connect(proxyRaw, FISH_HOST, 443).then((raw) => {
            const secure = tls.connect({ socket: raw, servername: FISH_HOST });
            secure.once("secureConnect", () => cb(null, secure));
            secure.once("error", (e) => cb(e));
          }).catch((e) => cb(e));
        } : void 0
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      }
    );
    req.setTimeout(options.timeoutMs, () => req.destroy(new Error(`\u8BF7\u6C42\u8D85\u65F6\uFF08${options.timeoutMs}ms\uFF09`)));
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
async function fishPost(secrets, path, body, timeoutMs) {
  const key = secrets.FISH_API_KEY || process.env.FISH_API_KEY || "";
  if (!key) {
    throw new Error("[tts] \u7F3A\u5C11 FISH_API_KEY\u2014\u2014\u5728 .dailog-editor/.env \u914D\u7F6E\uFF08https://fish.audio \u63A7\u5236\u53F0\u521B\u5EFA\uFF09");
  }
  const proxyRaw = secrets.FISH_PROXY_URL || process.env.FISH_PROXY_URL || null;
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/msgpack", model: MODEL_FREE };
  const res = await rawRequest(proxyRaw, { method: "POST", path, headers, body, timeoutMs });
  if (res.status === 402) {
    const res2 = await rawRequest(proxyRaw, { method: "POST", path, headers: { ...headers, model: MODEL_PAID }, body, timeoutMs });
    if (res2.status >= 200 && res2.status < 300) return res2.body;
    throw new Error(`tts http_${res2.status}: ${res2.body.toString("utf8").slice(0, 300)}`);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`tts http_${res.status}: ${res.body.toString("utf8").slice(0, 300)}`);
  }
  return res.body;
}
async function synthesizeMultiSpeaker(config, segments, hostRef, guestRef, timeoutMs = 6e5) {
  const text = segments.map((s) => `<|speaker:${s.speaker}|>${s.text}`).join("");
  const body = msgpackEncode({
    text,
    references: [[{ audio: hostRef.audio, text: hostRef.text }], [{ audio: guestRef.audio, text: guestRef.text }]],
    format: "mp3",
    mp3_bitrate: 128,
    // 基于已生成 chunk 条件生成，保证长段内音色/语调连贯
    condition_on_previous_chunks: true
  });
  return fishPost(config.secrets, "/v1/tts", body, timeoutMs);
}
async function synthesizeSingle(config, text, hostRef, opts = {}) {
  const { timeoutMs = 6e5, normalize } = opts;
  const body = msgpackEncode({
    text,
    references: [{ audio: hostRef.audio, text: hostRef.text ?? REF_TRANSCRIPT }],
    format: "mp3",
    mp3_bitrate: 128,
    // 基于已生成 chunk 条件生成，保证长段内音色/语调连贯
    condition_on_previous_chunks: true,
    // normalize=false：关引擎文本规范化（数字/日期/URL 改写）——2026 这类年份按原文语境读
    //   （2026-09 A/B 实测：normalize=false + 原文 → 「二零二六」正确；不传走默认 true 会读错年份）
    ...normalize === void 0 ? {} : { normalize }
  });
  return fishPost(config.secrets, "/v1/tts", body, timeoutMs);
}
export {
  synthesizeMultiSpeaker,
  synthesizeSingle
};
