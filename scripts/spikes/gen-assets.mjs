#!/usr/bin/env node
/**
 * 固定片头/片尾资产生成 —— dailogues 计划 4 Task 11
 *
 * 用 Fish Audio 固定音色（音色库 reference_id，零克隆）合成 4 个固定音频：
 *   assets/audio/intro.zh.mp3 / outro.zh.mp3 / intro.en.mp3 / outro.en.mp3
 *
 * 请求形态与后端 synthesizeMultiSpeaker（services/api/src/tts/client.ts）保持一致：
 *   POST /v1/tts  application/json
 *   { text, reference_id: <固定音色id>, format: "mp3" }
 * 不覆盖 sample_rate / mp3_bitrate —— 用 Fish 默认（44.1kHz 128k 单声道），
 * 与主音频同参数，保证 ffmpeg concat demuxer 拼接兼容（Task 8 review 结论）。
 *
 * 运行（仓库根目录）：
 *   node scripts/spikes/gen-assets.mjs
 *
 * 网络：api.fish.audio 本网络直连超时，必须走本地 SOCKS5（默认 127.0.0.1:1081，
 * 远端 DNS）——复用 scripts/spikes/fish-audio.mjs 实测通过的握手/请求封装。
 * 环境变量（scripts/spikes/.env 的 KEY=VALUE 行 + 进程 env 覆盖）：
 *   FISH_API_KEY   必需
 *   FISH_MODEL     默认 s2.1-pro-free（$0）
 *   FISH_VOICE_ID  固定音色 reference_id（默认取 docs/spikes/fish-audio.md §8 记录的
 *                  音色库 id，7f92f8afb8ec43bf81429cc1c9199cb1「AD学姐」；若该 id 404
 *                  则回退查询音色库 GET /model?language=zh 挑第一个可用 zh 音色）
 *   SOCKS_PROXY    默认 socks5://127.0.0.1:1081（设 none 直连）
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const ASSETS_DIR = path.join(REPO_ROOT, 'assets', 'audio');

const API_HOST = 'api.fish.audio';
const API_PORT = 443;

/** docs/spikes/fish-audio.md §8 实测记录的音色库 id（AD学姐，zh，任务量 372k） */
const RECORDED_VOICE_ID = '7f92f8afb8ec43bf81429cc1c9199cb1';

// 解析 scripts/spikes/.env 的 KEY=VALUE 行（跳过注释/空行）
function loadEnv(file) {
  const env = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  } catch {
    /* .env 缺失 → 仅用进程 env */
  }
  return env;
}

const ENV = loadEnv(path.join(SCRIPT_DIR, '.env'));
const KEY = process.env.FISH_API_KEY || ENV.FISH_API_KEY || '';
const MODEL = process.env.FISH_MODEL || ENV.FISH_MODEL || 's2.1-pro-free';
const PROXY_RAW = process.env.SOCKS_PROXY || ENV.SOCKS_PROXY || 'socks5://127.0.0.1:1081';
const VOICE_ID = (process.env.FISH_VOICE_ID || ENV.FISH_VOICE_ID || '').trim();

const TEXTS = [
  { file: 'intro.zh.mp3', label: 'intro.zh', text: '欢迎收听 dailogues，在这里，你和 AI 的对话，成为你自己的节目。' },
  { file: 'outro.zh.mp3', label: 'outro.zh', text: '感谢收听。下一期，我们继续聊。' },
  { file: 'intro.en.mp3', label: 'intro.en', text: 'Welcome to Dailogues, where your conversations with AI become your own show.' },
  { file: 'outro.en.mp3', label: 'outro.en', text: 'Thanks for listening. See you next episode.' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 网络：SOCKS5（远端 DNS）-> TLS -> https.request（自 fish-audio.mjs 裁剪，实测通过）
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
        sock.setTimeout(0);
        resolve(sock);
      }
    };
    sock.on('data', onData);
    sock.write(Buffer.from([0x05, 0x01, 0x00]));
  });
}

function rawRequest({ method = 'GET', urlPath = '/', headers = {}, body, timeoutMs = 240000 }) {
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
// 工具
// ---------------------------------------------------------------------------
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

/** afinfo（macOS 自带）探测时长秒；不可用/解析失败返回 null */
function probeDuration(file) {
  return new Promise((resolve) => {
    execFile('afinfo', [file], { timeout: 10000 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = stdout.match(/estimated duration:\s*([0-9.]+)/);
      resolve(m ? Number(m[1]) : null);
    });
  });
}

async function tts(text, referenceId) {
  const body = JSON.stringify({ text, reference_id: referenceId, format: 'mp3' });
  return rawRequest({
    method: 'POST',
    urlPath: '/v1/tts',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      model: MODEL,
    },
    body,
    timeoutMs: 240000,
  });
}

/** 音色库回退：GET /model?language=zh，取第一个 public + trained 的 zh 音色 */
async function resolveVoiceFromLibrary() {
  const res = await rawRequest({
    urlPath: '/model?language=zh&page_size=20&sort_by=task_count',
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (res.status !== 200) {
    throw new Error(`音色库查询失败 HTTP ${res.status}: ${errorText(res)}`);
  }
  const j = JSON.parse(res.body.toString('utf8'));
  const items = (j.items || []).filter((it) => it.visibility === 'public' && it.state === 'trained');
  if (items.length === 0) throw new Error('音色库无可用候选（public + trained 为空）');
  const pick = items[0];
  console.log(`[voice] 记录 id 404，从音色库回退挑选: _id=${pick._id} title=${pick.title}`);
  return pick._id;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  if (!KEY) {
    console.error('缺少 FISH_API_KEY（scripts/spikes/.env 或进程环境变量）');
    process.exit(2);
  }
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  console.log('==== dailogues 固定片头/片尾资产生成 ====');
  console.log(`model=${MODEL} | 代理=${PROXY ? `${PROXY.host}:${PROXY.port} (SOCKS5)` : '直连'} | 输出=${ASSETS_DIR}`);

  // 固定音色 id：env 覆盖 > docs 记录 id > 音色库回退（仅当记录 id 404 时）
  let voiceId = VOICE_ID || RECORDED_VOICE_ID;
  let voiceSource = VOICE_ID ? 'env FISH_VOICE_ID' : `docs/spikes/fish-audio.md §8 记录（${RECORDED_VOICE_ID}）`;

  for (const t of TEXTS) {
    const t0 = Date.now();
    let res = await tts(t.text, voiceId);
    // 记录 id 失效（404）且未显式指定：回退音色库挑第一个 zh 音色重试
    if (res.status === 404 && !VOICE_ID && voiceSource.startsWith('docs')) {
      voiceId = await resolveVoiceFromLibrary();
      voiceSource = 'voice library (zh, first public/trained)';
      console.log(`[${t.label}] 记录 id 404，改用 ${voiceId} 重试`);
      res = await tts(t.text, voiceId);
    }
    const outFile = path.join(ASSETS_DIR, t.file);
    if (res.status < 200 || res.status >= 300) {
      console.error(`[${t.label}] 失败 HTTP ${res.status} | ${res.ms}ms | body: ${errorText(res)}`);
      process.exit(1);
    }
    fs.writeFileSync(outFile, res.body);
    const bytes = fs.statSync(outFile).size;
    const dur = await probeDuration(outFile);
    console.log(
      `[${t.label}] HTTP ${res.status} | ${res.ms}ms | ${bytes} bytes | ${dur !== null ? dur.toFixed(2) + 's' : '时长未知'} -> ${path.relative(REPO_ROOT, outFile)}`
    );
    await sleep(500);
  }

  console.log(`\n固定音色 reference_id=${voiceId}（${voiceSource}）`);
  console.log('==== 完成 ====');
}

await main();
