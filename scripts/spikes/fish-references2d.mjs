#!/usr/bin/env node
/**
 * Spike：多说话人零样本（references 2D 内联音频）——Fish Audio 官方文档形态，spike 未实测
 * 验证点：
 *   1. references 二维数组 [[speaker0 样本], [speaker1 样本]] + <|speaker:N|> 标签
 *      → 一次请求合成双人音频（不做音色训练）
 *   2. 主持人样本是 WebM（MediaRecorder 输出）——零样本是否接受非 WAV 格式
 *   3. 与"全模型 id 多说话人"（旧主路径）的效果/耗时对比
 *
 * 运行（FISH_API_KEY 从 services/api/.env.local 注入；代理必须已启动）：
 *   cd scripts/spikes && node --env-file=../../services/api/.env.local fish-references2d.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_HOST = 'api.fish.audio';
const API_PORT = 443;

const KEY = process.env.FISH_API_KEY || '';
const MODEL = process.env.FISH_MODEL || 's2.1-pro-free';
const PROXY_RAW = process.env.SOCKS_PROXY ?? 'socks5://127.0.0.1:1081';
const HOST_FILE = process.env.HOST_FILE || path.resolve(SCRIPT_DIR, '../../services/api/data/audio/voices/ygG4SqSmMDHamGwiNRwWQiYQek9rNegj.wav');
const GUEST_FILE = process.env.GUEST_FILE || '/tmp/guest.wav';
const OUT_DIR = SCRIPT_DIR;

// 转录文本占位（ASR 0 额度 402，见 fish-audio.md §6）
const REF_TEXT = '你好，欢迎收听 dailogues。这是参考音频的转录文本，用于声音克隆测试。';

// ---------------------------------------------------------------------------
// SOCKS5 最小实现（复制自 fish-audio.mjs，零依赖）
// ---------------------------------------------------------------------------
function parseProxy(raw) {
  const m = raw.match(/^(?:socks5h?|socks):\/\/([^:/]+)(?::(\d+))?$/);
  if (!m) throw new Error(`无法解析 SOCKS 代理: ${raw}`);
  return { host: m[1], port: m[2] ? Number(m[2]) : 1080 };
}

function socks5Connect({ host, port }) {
  const proxy = parseProxy(PROXY_RAW);
  return new Promise((resolve, reject) => {
    const sock = net.connect(proxy.port, proxy.host, () => {
      // 握手：无需认证
      sock.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    let stage = 0;
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 0 && buf.length >= 2) {
        if (buf[1] !== 0x00) return reject(new Error(`SOCKS 认证失败 code=${buf[1]}`));
        buf = buf.subarray(2);
        stage = 1;
        const hostBuf = Buffer.from(host, 'utf8');
        const req = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
          hostBuf,
          Buffer.from([(port >> 8) & 0xff, port & 0xff]),
        ]);
        sock.write(req);
      } else if (stage === 1 && buf.length >= 4) {
        const atyp = buf[3];
        let headLen;
        if (atyp === 0x01) headLen = 4 + 4 + 2;
        else if (atyp === 0x03) headLen = 4 + 1 + buf[4] + 2;
        else if (atyp === 0x04) headLen = 4 + 16 + 2;
        else return reject(new Error(`SOCKS 不支持 ATYP=${atyp}`));
        if (buf.length < headLen) return;
        if (buf[1] !== 0x00) return reject(new Error(`SOCKS 连接失败 code=${buf[1]}`));
        sock.removeAllListeners('data');
        resolve(sock);
      }
    });
    sock.on('error', reject);
  });
}

function rawRequest({ method = 'GET', urlPath = '/', headers = {}, body, timeoutMs = 180000 }) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = https.request(
      {
        host: API_HOST,
        port: API_PORT,
        path: urlPath,
        method,
        headers,
        createConnection: (_opts, cb) => {
          socks5Connect({ host: API_HOST, port: API_PORT })
            .then((raw) => {
              const secure = tls.connect({ socket: raw, servername: API_HOST });
              secure.once('secureConnect', () => cb(null, secure));
              secure.once('error', (e) => cb(e));
            })
            .catch((e) => cb(e));
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            contentType: res.headers['content-type'] || '',
            transferEncoding: res.headers['transfer-encoding'] || '',
            headers: res.headers,
            body: Buffer.concat(chunks),
            ms: Date.now() - t0,
          });
        });
        res.on('error', reject);
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`请求超时（${timeoutMs}ms）`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
// ---------------------------------------------------------------------------
// msgpack 最小编码器（复制自 fish-audio.mjs：map/str/bin/array/int/bool/nil）
// ---------------------------------------------------------------------------
function msgpackEncode(value) {
  const out = [];
  const push = (b) => out.push(b);
  const w = (v) => {
    if (v === null || v === undefined) push(Buffer.from([0xc0]));
    else if (typeof v === 'boolean') push(Buffer.from([v ? 0xc3 : 0xc2]));
    else if (typeof v === 'string') {
      const b = Buffer.from(v, 'utf8');
      const n = b.length;
      if (n < 32) push(Buffer.concat([Buffer.from([0xa0 | n]), b]));
      else if (n < 256) push(Buffer.concat([Buffer.from([0xd9, n]), b]));
      else if (n < 65536) {
        const h = Buffer.alloc(3);
        h[0] = 0xda;
        h.writeUInt16BE(n, 1);
        push(Buffer.concat([h, b]));
      } else {
        const h = Buffer.alloc(5);
        h[0] = 0xdb;
        h.writeUInt32BE(n, 1);
        push(Buffer.concat([h, b]));
      }
    } else if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
      const b = Buffer.from(v);
      const n = b.length;
      if (n < 256) push(Buffer.concat([Buffer.from([0xc4, n]), b]));
      else if (n < 65536) {
        const h = Buffer.alloc(3);
        h[0] = 0xc5;
        h.writeUInt16BE(n, 1);
        push(Buffer.concat([h, b]));
      } else {
        const h = Buffer.alloc(5);
        h[0] = 0xc6;
        h.writeUInt32BE(n, 1);
        push(Buffer.concat([h, b]));
      }
    } else if (Number.isInteger(v)) {
      if (v >= 0 && v < 128) push(Buffer.from([v]));
      else {
        const h = Buffer.alloc(9);
        h[0] = 0xd3;
        h.writeBigInt64BE(BigInt(v), 1);
        push(h);
      }
    } else if (Array.isArray(v)) {
      const n = v.length;
      if (n < 16) push(Buffer.from([0x90 | n]));
      else if (n < 65536) {
        const h = Buffer.alloc(3);
        h[0] = 0xdc;
        h.writeUInt16BE(n, 1);
        push(h);
      } else {
        const h = Buffer.alloc(5);
        h[0] = 0xdd;
        h.writeUInt32BE(n, 1);
        push(h);
      }
      for (const item of v) w(item);
    } else if (typeof v === 'object') {
      const keys = Object.keys(v);
      const n = keys.length;
      if (n < 16) push(Buffer.from([0x80 | n]));
      else if (n < 65536) {
        const h = Buffer.alloc(3);
        h[0] = 0xde;
        h.writeUInt16BE(n, 1);
        push(h);
      } else {
        const h = Buffer.alloc(5);
        h[0] = 0xdf;
        h.writeUInt32BE(n, 1);
        push(h);
      }
      for (const k of keys) {
        w(k);
        w(v[k]);
      }
    } else {
      throw new Error(`msgpack: 不支持的类型 ${typeof v}`);
    }
  };
  w(value);
  return Buffer.concat(out);
}
// ---------------------------------------------------------------------------
// 验证请求：多说话人零样本（references 2D）
// ---------------------------------------------------------------------------
async function tts2d({ text, hostBuf, guestBuf, referenceIds, outFile, label }) {
  const body = {
    text,
    format: 'mp3',
    mp3_bitrate: 128,
  };
  if (referenceIds && referenceIds[0] === 'EMBED') {
    // 变体：references 2D 内嵌 id——[[{audio,text}], [{id}]]（ClientSideReferenceId 枚举探索）
    body.references = [[{ audio: hostBuf, text: REF_TEXT }], [{ id: referenceIds[1] }]];
  } else if (referenceIds) {
    // 混合模式验证：host 内联 + guest 用 reference_id
    if (hostBuf) body.references = [[{ audio: hostBuf, text: REF_TEXT }]];
    body.reference_id = referenceIds;
  } else {
    body.references = [
      [{ audio: hostBuf, text: REF_TEXT }],
      [{ audio: guestBuf, text: REF_TEXT }],
    ];
  }
  const payload = msgpackEncode(body);
  const t0 = Date.now();
  const res = await rawRequest({
    method: 'POST',
    urlPath: '/v1/tts',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/msgpack', model: MODEL },
    body: payload,
  });
  const ok = res.status >= 200 && res.status < 300;
  if (ok) fs.writeFileSync(path.join(OUT_DIR, outFile), res.body);
  console.log(`[${label}] HTTP ${res.status} | ${res.contentType} | ${res.ms}ms | ${res.body.length} bytes${ok ? ` -> ${outFile}` : ''}`);
  if (!ok) console.log(`   body: ${res.body.toString('utf8').slice(0, 500)}`);
  return ok;
}

async function main() {
  if (!KEY) {
    console.error('缺少 FISH_API_KEY（用 node --env-file 注入）');
    process.exit(1);
  }
  const hostBuf = fs.readFileSync(HOST_FILE);
  const guestBuf = fs.readFileSync(GUEST_FILE);
  console.log(`主持人样本: ${HOST_FILE} (${hostBuf.length} bytes, ${path.extname(HOST_FILE)})`);
  console.log(`嘉宾样本:   ${GUEST_FILE} (${guestBuf.length} bytes, ${path.extname(GUEST_FILE)})`);
  console.log(`代理: ${PROXY_RAW} | 模型: ${MODEL}\n`);

  const text =
    '<|speaker:0|>欢迎收听 dailogues，今天我们聊聊如何把 AI 对话变成播客。<|speaker:1|>这个想法很有意思，核心就是把真实的对话变成可订阅的内容。<|speaker:0|>没错，而且每一步都能自动化。<|speaker:1|>那我们开始吧。';

  const ok = await tts2d({ text, hostBuf, guestBuf, outFile: 'out-refs2d.mp3', label: 'references-2D 多说话人' });
  console.log(`\n${ok ? '✓ 2D 全内联验证通过' : '✗ 2D 全内联失败'}（输出: scripts/spikes/out-refs2d.mp3）`);

  // ---- 混合模式复现/探索（fish-audio.md §9 坑 6：内联 + reference_id 混排） ----
  const guestId = (process.env.FISH_GUEST_REFERENCE_ID || '').trim();
  console.log(`\n[混合] guest 音色 ID: ${guestId ? guestId.slice(0, 8) + '…' : '（未配置）'}`);
  if (guestId) {
    for (const variant of [
      { referenceIds: [null, guestId], label: '混-1: references=[[host]], reference_id=[null,guest]' },
      { referenceIds: ['', guestId], label: '混-2: references=[[host]], reference_id=["",guest]' },
    ]) {
      await tts2d({ text: '<|speaker:0|>你好。<|speaker:1|>你好！', hostBuf, referenceIds: variant.referenceIds, label: variant.label });
    }
    // 变体 3：references 2D 内嵌 id
    await tts2d({
      text: '<|speaker:0|>你好。<|speaker:1|>你好！',
      hostBuf,
      referenceIds: ['EMBED', guestId],
      outFile: 'out-mixed-embed.mp3',
      label: '混-3: references=[[{audio}],[{id}]]',
    });
  }
}

main().catch((e) => {
  console.error('✗ 失败:', e.message);
  process.exit(1);
});
