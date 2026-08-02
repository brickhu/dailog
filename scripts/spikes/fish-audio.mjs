#!/usr/bin/env node
/**
 * Fish Audio TTS 集成 spike —— dailogues 计划 2 Task 2
 *
 * 验证点：
 *   1. 多说话人请求结构（reference_id 数组 + <|speaker:N|> 标签，S2-Pro 系模型）
 *   2. 参考音频传法：零样本按需（msgpack inline references）vs 先上传建音色（POST /model -> reference_id）
 *   3. 响应形态（原始音频字节流）、单请求字符上限、克隆一致性、计费口径
 *
 * 运行（在 scripts/spikes/ 下）：
 *   npm run fish              # 主流程（多说话人 + 零样本 + 分段）
 *   npm run fish:limits       # 单请求字符上限测试（3000/6000/12000）
 *
 * 环境变量（.env 读取）：
 *   FISH_API_KEY      必需
 *   FISH_MODEL        默认 s2.1-pro-free（$0/M UTF-8 字节）；付费模型 s2-pro / s2.1-pro 为 $15/M
 *   REFERENCE_FILE    默认 ../../sample-voice.wav（相对脚本目录）
 *   GUEST_REFERENCE_ID  嘉宾固定音色 id（可为空 -> 自动从音色库挑选并打印）
 *   HOST_MODEL_ID     已建好的主持人音色 id（可选，复用避免重复创建）
 *   HOST_TRANSCRIPT   参考音频转录文本（默认占位文本，见 findings）
 *   SOCKS_PROXY       默认 socks5://127.0.0.1:1081（本网络 api.fish.audio 直连超时，必须走本地 SOCKS）
 *
 * 说明：脚本不依赖任何 npm 包（Node >= 20.6：`node --env-file` 自 20.6 起可用，网络仅用内置 net/tls/https）；SOCKS5 握手与 msgpack 编码为内置最小实现。
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = process.cwd();

const API_HOST = 'api.fish.audio';
const API_PORT = 443;

const KEY = process.env.FISH_API_KEY || '';
const MODEL = process.env.FISH_MODEL || 's2.1-pro-free';
const PROXY_RAW = process.env.SOCKS_PROXY ?? 'socks5://127.0.0.1:1081';
const GUEST_REFERENCE_ID = (process.env.GUEST_REFERENCE_ID || '').trim();
const HOST_MODEL_ID = (process.env.HOST_MODEL_ID || '').trim();
const HOST_TRANSCRIPT = (process.env.HOST_TRANSCRIPT || '').trim();
// 参考音频转录文本：ASR（/v1/asr）在 0 额度下返回 402，暂用占位文本（见 docs/spikes/fish-audio.md）
const REF_TEXT = HOST_TRANSCRIPT || '你好，欢迎收听 dailogues。这是参考音频的转录文本，用于声音克隆测试。';

const REFERENCE_FILE = process.env.REFERENCE_FILE
  ? path.resolve(CWD, process.env.REFERENCE_FILE)
  : path.resolve(SCRIPT_DIR, '../../sample-voice.wav');

const OUT_DIR = CWD; // 输出到运行目录（scripts/spikes/）

// 6 段测试文本：主持人（克隆音色，sample-voice.wav）/ 嘉宾（固定音色 reference_id）
const SEGMENTS = [
  { speaker: 'host', text: '欢迎收听 dailogues，今天我们聊聊如何把 AI 对话变成播客。' },
  { speaker: 'guest', text: '这个想法很有意思，核心就是把真实的对话变成可订阅的内容。' },
  { speaker: 'host', text: '那第一件事，你是怎么想到把对话变成节目的？' },
  { speaker: 'guest', text: '第一是导入，第二是声音，第三是分发，缺一不可。' },
  { speaker: 'host', text: '听起来很酷，普通人现在能做播客了吗？' },
  { speaker: 'guest', text: '当然可以，现在技术门槛已经降到了零。' },
];

const SUMMARY = []; // { label, status, contentType, ms, bytes, file }

// ---------------------------------------------------------------------------
// 网络：SOCKS5（远端 DNS）-> TLS -> https.request（createConnection 返回 TLS socket）
// ---------------------------------------------------------------------------
function parseProxy(raw) {
  if (!raw || raw === 'none' || raw === 'direct') return null;
  const m = raw.match(/^(?:socks5h?|socks):\/\/([^:/]+)(?::(\d+))?$/);
  if (m) return { host: m[1], port: m[2] ? parseInt(m[2], 10) : 1081 };
  const m2 = raw.match(/^([^:/]+):(\d+)$/);
  if (m2) return { host: m2[1], port: parseInt(m2[2], 10) };
  throw new Error(`无法解析 SOCKS_PROXY: ${raw}`);
}

const PROXY = parseProxy(PROXY_RAW);

function socks5Connect({ host, port }) {
  if (!PROXY) return net.connect({ host, port });
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: PROXY.host, port: PROXY.port });
    let buf = Buffer.alloc(0);
    let stage = 0; // 0: greeting, 1: CONNECT reply
    // 握手阶段防挂起：代理接受 TCP 但永不回应时，15s 后销毁并拒绝（请求级 setTimeout 不覆盖此阶段）
    const fail = (e) => { sock.setTimeout(0); sock.destroy(); reject(e); };
    sock.once('error', fail);
    sock.setTimeout(15000, () => fail(new Error(`SOCKS5 握手超时（${PROXY.host}:${PROXY.port}）`)));
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 0) {
        if (buf.length < 2) return;
        if (buf[1] !== 0x00) return fail(new Error(`SOCKS5 代理不接受免认证连接（code ${buf[1]}）`));
        buf = buf.subarray(2);
        stage = 1;
        const hb = Buffer.from(host, 'utf8');
        const p = Buffer.alloc(2);
        p.writeUInt16BE(port, 0);
        sock.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hb.length]), hb, p]));
      } else {
        if (buf.length < 10) return;
        if (buf[1] !== 0x00) return fail(new Error(`SOCKS5 CONNECT 失败（code ${buf[1]}）`));
        sock.removeListener('data', onData);
        sock.removeListener('error', fail);
        sock.setTimeout(0); // 握手完成，交回后续 TLS/请求阶段，解除防挂起超时
        resolve(sock);
      }
    };
    sock.on('data', onData);
    sock.write(Buffer.from([0x05, 0x01, 0x00]));
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
// msgpack（最小编码器：覆盖本脚本所需类型 map/str/bin/array/int/bool/nil）
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
// multipart（POST /model 上传参考音频建音色）
// ---------------------------------------------------------------------------
function multipartBody(fields, fileField, filePath) {
  const boundary = '----dailogues' + crypto.randomBytes(8).toString('hex');
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${path.basename(filePath)}"\r\nContent-Type: audio/wav\r\n\r\n`
    )
  );
  parts.push(fs.readFileSync(filePath));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

// ---------------------------------------------------------------------------
// API 封装
// ---------------------------------------------------------------------------
function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${KEY}`, ...extra };
}

function errorText(res) {
  let txt = res.body.toString('utf8');
  try {
    const j = JSON.parse(txt);
    if (Array.isArray(j)) {
      txt = j
        .map((e) => `${(e.loc || []).join('.') || '?'}: ${e.msg || e.type || ''}`)
        .join(' | ');
    } else if (j && typeof j === 'object') {
      txt = JSON.stringify(j);
    }
  } catch {
    /* 保持原文 */
  }
  return txt.length > 1200 ? txt.slice(0, 1200) + '…' : txt;
}

async function tts(text, { outFile, label, referenceId, references, timeoutMs = 240000, extra = {} } = {}) {
  const body = {
    text,
    format: 'mp3',
    mp3_bitrate: 128,
    ...(referenceId !== undefined ? { reference_id: referenceId } : {}),
    ...(references !== undefined ? { references } : {}),
    ...extra,
  };
  const isMsgpack = references !== undefined;
  const payload = isMsgpack ? msgpackEncode(body) : Buffer.from(JSON.stringify(body), 'utf8');
  const t0 = Date.now();
  let res;
  try {
    res = await rawRequest({
      method: 'POST',
      urlPath: '/v1/tts',
      headers: authHeaders({
        'Content-Type': isMsgpack ? 'application/msgpack' : 'application/json',
        model: MODEL,
      }),
      body: payload,
      timeoutMs,
    });
  } catch (e) {
    console.log(`[${label}] 网络错误: ${e.message}`);
    SUMMARY.push({ label, status: 'ERR', contentType: '', ms: Date.now() - t0, bytes: 0, file: outFile });
    return null;
  }
  const ok = res.status >= 200 && res.status < 300;
  const file = outFile ? path.join(OUT_DIR, outFile) : null;
  if (ok && file) fs.writeFileSync(file, res.body);
  const size = ok && file ? fs.statSync(file).size : res.body.length;
  console.log(
    `[${label}] HTTP ${res.status} | ${res.contentType}${res.transferEncoding ? ` | TE: ${res.transferEncoding}` : ''} | ${res.ms}ms | ${size} bytes${file ? ` -> ${outFile}` : ''}`
  );
  if (!ok) console.log(`[${label}]   body: ${errorText(res)}`);
  SUMMARY.push({ label, status: res.status, contentType: res.contentType, ms: res.ms, bytes: size, file: outFile });
  return { ...res, ok, size };
}

async function walletCredit() {
  try {
    const res = await rawRequest({
      urlPath: '/wallet/self/api-credit?check_free_credit=true',
      headers: authHeaders(),
    });
    if (res.status !== 200) return `HTTP ${res.status}`;
    const j = JSON.parse(res.body.toString('utf8'));
    return `credit=${j.credit} free_credit=${j.has_free_credit} topup=${j.cumulative_top_up}`;
  } catch (e) {
    return `读取失败: ${e.message}`;
  }
}

// 创建主持人音色（POST /model，fast 训练，multipart 上传参考音频）-> 返回 _id
async function createHostModel(wavPath) {
  const { body, contentType } = multipartBody(
    { type: 'tts', train_mode: 'fast', title: 'dailogues-spike-host', visibility: 'private', tags: 'zh' },
    'voices',
    wavPath
  );
  const res = await rawRequest({
    method: 'POST',
    urlPath: '/model',
    headers: authHeaders({ 'Content-Type': contentType }),
    body,
    timeoutMs: 180000,
  });
  if (res.status !== 201) {
    console.log(`[create-model] HTTP ${res.status} | ${res.ms}ms | body: ${errorText(res)}`);
    return null;
  }
  const j = JSON.parse(res.body.toString('utf8'));
  console.log(
    `[create-model] HTTP 201 | ${res.ms}ms | _id=${j._id} state=${j.state} title=${j.title} visibility=${j.visibility}`
  );
  return j._id;
}

// 嘉宾固定音色：优先 GUEST_REFERENCE_ID，否则从音色库（GET /model?language=zh）挑选
async function resolveGuestVoice() {
  if (GUEST_REFERENCE_ID) return { id: GUEST_REFERENCE_ID, source: 'env GUEST_REFERENCE_ID' };
  const res = await rawRequest({
    urlPath: '/model?language=zh&page_size=20&sort_by=task_count',
    headers: authHeaders(),
  });
  if (res.status !== 200) {
    console.log(`[guest-voice] 音色库查询失败 HTTP ${res.status}: ${errorText(res)}`);
    return null;
  }
  const j = JSON.parse(res.body.toString('utf8'));
  const denylist = ['蒋介石', '麦当劳', '丁真', '奥巴马', '特朗普', '泽连斯基', '普京'];
  const items = (j.items || []).filter(
    (it) => it.visibility === 'public' && it.state === 'trained' && !denylist.some((d) => (it.title || '').includes(d))
  );
  if (items.length === 0) {
    console.log('[guest-voice] 音色库无可用候选（全部被过滤或为空）');
    return null;
  }
  const pick = items[0];
  console.log(
    `[guest-voice] 从音色库挑选: _id=${pick._id} title=${pick.title} tasks=${pick.task_count}（可用 GUEST_REFERENCE_ID 覆盖）`
  );
  return { id: pick._id, source: `voice library: ${pick.title}` };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  if (!KEY) {
    console.error('缺少 FISH_API_KEY（通过 node --env-file=.env 加载）');
    process.exit(2);
  }
  if (!fs.existsSync(REFERENCE_FILE)) {
    console.error(`参考音频不存在: ${REFERENCE_FILE}（可用 REFERENCE_FILE 覆盖）`);
    process.exit(2);
  }
  const wav = fs.readFileSync(REFERENCE_FILE);
  console.log('==== Fish Audio TTS spike ====');
  console.log(`model=${MODEL} | 代理=${PROXY ? `${PROXY.host}:${PROXY.port} (SOCKS5)` : '直连'} | 参考音频=${path.basename(REFERENCE_FILE)} (${wav.length} bytes)`);
  console.log(`参考转录文本=${JSON.stringify(REF_TEXT)}`);

  const creditBefore = await walletCredit();
  console.log(`钱包（调用前）: ${creditBefore}`);

  // ---------- Attempt 1: 多说话人单次调用 ----------
  let hostModelId = HOST_MODEL_ID;
  if (!hostModelId) {
    try {
      hostModelId = await createHostModel(REFERENCE_FILE);
    } catch (e) {
      // 网络错误不中断整个运行：跳过 Attempt 1 与后续依赖，逐段零样本路径不受影响
      console.log(`[create-model] 网络错误: ${e.message}`);
      hostModelId = null;
    }
  } else {
    console.log(`[host-model] 复用 HOST_MODEL_ID=${hostModelId}`);
  }
  let guest = null;
  try {
    guest = await resolveGuestVoice();
  } catch (e) {
    console.log(`[guest-voice] 网络错误: ${e.message}`);
    guest = null;
  }

  if (hostModelId && guest) {
    const multiText = SEGMENTS.map((s, i) => {
      const tag = s.speaker === 'host' ? '<|speaker:0|>' : '<|speaker:1|>';
      return `${tag}${s.text}`;
    }).join('');
    console.log(`\n[Attempt 1] 多说话人单次调用: reference_id=[${hostModelId}, ${guest.id}]（主持人=克隆音色模型，嘉宾=固定音色）`);
    await tts(multiText, {
      outFile: 'out-multi.mp3',
      label: 'multi',
      referenceId: [hostModelId, guest.id],
      timeoutMs: 300000,
    });
  } else {
    console.log(`\n[Attempt 1] 跳过：${!hostModelId ? '主持人音色模型创建失败' : '无嘉宾固定音色'}`);
  }

  // ---------- 零样本按需（msgpack inline references，主持人） ----------
  console.log('\n[Zero-shot] 单说话人零样本按需克隆（msgpack inline references，不建音色模型）');
  await tts(SEGMENTS[0].text, {
    outFile: 'out-host-zeroshot.mp3',
    label: 'host-zeroshot',
    references: [{ audio: wav, text: REF_TEXT }],
  });

  // ---------- Attempt 2: 逐段单说话人调用 ----------
  console.log('\n[Attempt 2] 逐段单说话人调用（主持人=零样本按需，嘉宾=固定音色 reference_id，间隔 500ms）');
  const hostResults = [];
  const counters = { host: 0, guest: 0 };
  for (let i = 0; i < SEGMENTS.length; i++) {
    const seg = SEGMENTS[i];
    const n = ++counters[seg.speaker];
    if (seg.speaker === 'host') {
      const r = await tts(seg.text, {
        outFile: `out-host-${n}.mp3`,
        label: `host-${n}`,
        references: [{ audio: wav, text: REF_TEXT }],
      });
      if (r && r.ok) hostResults.push(n);
    } else {
      if (guest) {
        await tts(seg.text, {
          outFile: `out-guest-${n}.mp3`,
          label: `guest-${n}`,
          referenceId: guest.id,
        });
      } else {
        console.log(`[guest-${n}] 跳过（无固定音色可用，GUEST_REFERENCE_ID 为空且音色库不可用）`);
      }
    }
    if (i < SEGMENTS.length - 1) await sleep(500);
  }

  // ---------- 一致性：同一主持人文本重复合成一次 ----------
  if (hostResults.length > 0) {
    console.log('\n[Consistency] 重复合成主持人第 1 段（与 out-host-1.mp3 对比时长/大小/听感）');
    await tts(SEGMENTS[0].text, {
      outFile: 'out-host-1-repeat.mp3',
      label: 'host-1-repeat',
      references: [{ audio: wav, text: REF_TEXT }],
    });
  }

  // ---------- 汇总 ----------
  const creditAfter = await walletCredit();
  console.log(`\n钱包（调用后）: ${creditAfter}`);
  console.log('\n==== 汇总 ====');
  console.log('label | status | content-type | ms | bytes | file');
  for (const s of SUMMARY) {
    console.log(`${s.label} | ${s.status} | ${s.contentType || '-'} | ${s.ms} | ${s.bytes} | ${s.file || '-'}`);
  }
  console.log(`\n主持人音色模型 _id=${hostModelId || '（未创建）'}（如需可复用: HOST_MODEL_ID=${hostModelId}）`);
  console.log(`嘉宾固定音色 _id=${guest ? guest.id : '（不可用）'}（${guest ? guest.source : '-'}）`);
  const anyHostOk = SUMMARY.some((s) => s.label.startsWith('host-') && s.status === 200);
  console.log(anyHostOk ? '\n结论: 主持人克隆音色可用 ✅' : '\n结论: 主持人克隆音色未产出 ❌');
  process.exitCode = anyHostOk ? 0 : 1;
}

// ---------------------------------------------------------------------------
// 边界测试：单请求字符上限（3000 / 6000 / 12000 中文字符，各一次）
// ---------------------------------------------------------------------------
async function boundary() {
  if (!KEY) {
    console.error('缺少 FISH_API_KEY（通过 node --env-file=.env 加载）');
    process.exit(2);
  }
  let hostModelId = HOST_MODEL_ID;
  if (!hostModelId) {
    try {
      hostModelId = await createHostModel(REFERENCE_FILE);
    } catch (e) {
      console.log(`[create-model] 网络错误: ${e.message}`);
      hostModelId = null;
    }
  }
  if (!hostModelId) {
    console.error('无法创建主持人音色模型，边界测试需要 reference_id');
    process.exit(1);
  }
  console.log(`\n==== 字符上限测试（model=${MODEL}, reference_id=${hostModelId}）====`);
  const filler = '今天天气不错，我们一起去公园散步，顺便聊聊最近发生的趣事和想法。';
  const sizes = [3000, 6000, 12000];
  const wins = [];
  fs.mkdirSync(path.join(OUT_DIR, 'out-limits'), { recursive: true });
  for (const size of sizes) {
    const text = filler.repeat(Math.ceil(size / filler.length)).slice(0, size);
    console.log(`\n--- 测试 ${size} 字符（UTF-8 ${Buffer.byteLength(text, 'utf8')} bytes）---`);
    const r = await tts(text, {
      outFile: `out-limits/limit-${size}.mp3`,
      label: `limit-${size}`,
      referenceId: hostModelId,
      timeoutMs: 600000,
    });
    if (r && r.ok) wins.push(size);
  }
  console.log('\n==== 上限结论 ====');
  console.log(wins.length ? `最大成功请求: ${Math.max(...wins)} 字符（未继续上探，见 findings）` : '全部失败（见上）');
  const after = await walletCredit();
  console.log(`钱包（测试后）: ${after}`);
}

// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.includes('--boundary') || args.includes('--limits')) {
  await boundary();
} else {
  await main();
}
