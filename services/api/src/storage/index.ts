import { join } from "node:path";

export interface AudioStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  /** 读取对象；range 可选（R2 原生分片读取——音频流式播放只拉需要的区间）。
   *  返回 { data, total }：total = 对象完整长度（分片请求也能拿到） */
  get(key: string, range?: { start: number; end: number }): Promise<{ data: Uint8Array; total: number }>;
  /** 命中本地缓存时的流式读取（可选能力——只有磁盘缓存层实现）：按 range 直接从磁盘读流，
   *  不把整个对象读进内存。返回 null = 未命中/区间越界，调用方回退 get()。 */
  getStream?(key: string, range?: { start: number; end: number }): Promise<{
    body: ReadableStream<Uint8Array>;
    total: number;
    /** 实际下发区间（已按文件长度裁剪，含首尾） */
    start: number;
    end: number;
  } | null>;
  /** 删除对象（导入失败补偿/测试清理）；对象不存在不报错 */
  delete(key: string): Promise<void>;
}

export interface StorageOptions {
  driver: "fs" | "r2";
  dir?: string;                 // fs driver 根目录
  /** 磁盘缓存目录（默认 ./data/cache；R2 拉过的对象落盘，本地直读） */
  cacheDir?: string;
  r2?: { accountId: string; accessKey: string; secretKey: string; bucket: string };
  /** R2 出口代理（本地大陆网络访问 r2.cloudflarestorage.com 需走 socks5；线上直连留空） */
  r2ProxyUrl?: string;
}

export function createStorage(opts: StorageOptions): AudioStorage {
  const inner = opts.driver === "r2"
    ? createR2Storage(opts.r2!, opts.r2ProxyUrl)
    : createFsStorage(opts.dir ?? "./data");
  // 磁盘缓存层：远端（R2）拉过的对象落盘，后续请求本地直读——本地走代理访问 R2 慢
  // （2-6s/次）的痛点；生产同样受益（首拉落盘，重启不丢）。失效：24h TTL（重发同投稿
  // 覆盖音频的场景低频，TTL 兜底）。缓存目录默认 ./data/cache（gitignore）。
  return createDiskCached(inner, opts.cacheDir ?? "./data/cache");
}

/** 磁盘缓存包装：get 先查本地缓存，未命中从远端拉（分片先快速响应 + 后台「单飞」整文件原子落盘）。
 *
 *  两条曾经把播放打断的坑（修复要点，勿回退）：
 *   1. 整文件下载必须**单飞**：一集音频分片播放会连发 N 个 range 请求，若每个未命中都各自
 *      拉一遍整文件（8MB × N），彼此抢带宽 → 后面的分片请求排队超时 → 浏览器停在分片边界
 *      （症状：进度条显示 5:23、播到 5:05 卡住不动，且不报错）。
 *   2. 落盘必须**原子**（tmp + rename）：writeFile 直写目标路径时，并发读方会 stat 到
 *      "已存在且 mtime 新鲜"的半截文件 → readFile 读到截断内容 → total 缩水 →
 *      206 的 Content-Range 告诉浏览器"文件就这么长"→ 播放器提前停播（同样不报错）。 */
export function createDiskCached(inner: AudioStorage, cacheDir: string): AudioStorage {
  const fileOf = (key: string) => {
    // key 形如 voices/{userId}/{lang}.webm / episodes/{userId}/{id}.mp3——路径安全（无 ..）
    return join(cacheDir, key);
  };
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  // 冷缓存首个分片的取数上限：未命中时若按调用方的大区间（一路到文件尾）向远端要，
  // 得等整集下完才有第一个字节（本地走代理实测 12s 才出声）。先取够开播的一段（≈87s 的
  // 192kbps 音频），后台单飞落盘完成后，后续请求直接走本地缓存一次回完——既快又不碎片化。
  const MISS_FIRST_SPAN = 2 * 1024 * 1024;
  // 整文件下载单飞表：key → 进行中的下载 Promise（并发分片请求共享同一次下载）
  const inflight = new Map<string, Promise<void>>();

  /** 原子落盘：先写临时文件再 rename（同目录 rename 原子）——读方要么看不到文件、
   *  要么看到完整文件，绝不会读到"写了一半"的缓存 */
  const persist = async (key: string, data: Uint8Array) => {
    const { mkdir, writeFile, rename, unlink } = await import("node:fs/promises");
    const file = fileOf(key);
    const tmp = `${file}.${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`;
    await mkdir(join(file, ".."), { recursive: true });
    try {
      await writeFile(tmp, data);
      await rename(tmp, file);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
  };

  /** 后台整文件落盘（单飞 + 失败静默）：同一 key 并发只下载一次 */
  const fillCache = (key: string): Promise<void> => {
    const running = inflight.get(key);
    if (running) return running;
    const task = (async () => {
      const full = await inner.get(key);
      await persist(key, full.data);
    })()
      .catch(() => { /* 缓存失败静默：不影响本次响应 */ })
      .finally(() => { inflight.delete(key); });
    inflight.set(key, task);
    return task;
  };

  /** 缓存命中检查：TTL 内返回 stat（含 size），否则 null */
  const freshStat = async (key: string) => {
    const { stat } = await import("node:fs/promises");
    try {
      const st = await stat(fileOf(key));
      return Date.now() - st.mtimeMs < CACHE_TTL_MS ? st : null;
    } catch {
      return null; // 未命中
    }
  };

  return {
    async put(key, data) {
      await inner.put(key, data);
      // 写回时同步清缓存（避免旧内容）
      const { unlink } = await import("node:fs/promises");
      await unlink(fileOf(key)).catch(() => {});
    },
    async getStream(key, range) {
      const st = await freshStat(key);
      if (!st) return null; // 未命中 → 调用方回退 get()（远端拉取 + 后台落盘）
      const total = st.size;
      const start = range ? Math.max(0, range.start) : 0;
      const end = range ? Math.min(range.end, total - 1) : total - 1;
      // 空文件/区间越界：交回 get() 走 416 分支（那里有权威 total）
      if (total === 0 || start > end || start >= total) return null;
      const { createReadStream } = await import("node:fs");
      const { Readable } = await import("node:stream");
      const body = Readable.toWeb(
        createReadStream(fileOf(key), { start, end }),
      ) as unknown as ReadableStream<Uint8Array>;
      return { body, total, start, end };
    },
    async get(key, range) {
      const { readFile } = await import("node:fs/promises");
      // 缓存命中（TTL 内）：本地磁盘直读（毫秒）——原子落盘保证读到的一定是完整文件
      if (await freshStat(key)) {
        try {
          const full = new Uint8Array(await readFile(fileOf(key)));
          if (!range) return { data: full, total: full.length };
          const end = Math.min(range.end, full.length - 1);
          return { data: full.subarray(range.start, end + 1), total: full.length };
        } catch { /* 读失败（被清理/损坏）→ 落到远端 */ }
      }
      // 未命中：分片请求先用远端 Range 快速响应（只取够开播的一段），同时后台单飞整文件落盘
      if (range) {
        const end = Math.min(range.end, range.start + MISS_FIRST_SPAN - 1);
        const r = await inner.get(key, { start: range.start, end });
        void fillCache(key);
        return r;
      }
      const full = await inner.get(key);
      void persist(key, full.data).catch(() => { /* 缓存失败静默 */ });
      return full;
    },
    async delete(key) {
      await inner.delete(key);
      const { unlink } = await import("node:fs/promises");
      await unlink(fileOf(key)).catch(() => {});
    },
  };
}


function createFsStorage(dir: string): AudioStorage {
  // 路径穿越防护：key 含 ".." 一律拒绝（防止 ../x.mp3 逃逸根目录）
  const checkKey = (key: string) => {
    if (key.includes("..")) throw new Error(`invalid storage key: ${key}`);
  };
  return {
    async put(key, data) {
      checkKey(key);
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const p = join(dir, key);
      await mkdir(join(p, ".."), { recursive: true });
      await writeFile(p, data);
    },
    async get(key, range) {
      checkKey(key);
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const full = new Uint8Array(await readFile(join(dir, key)));
      if (!range) return { data: full, total: full.length };
      const end = Math.min(range.end, full.length - 1);
      return { data: full.subarray(range.start, end + 1), total: full.length };
    },
    async delete(key) {
      checkKey(key);
      const { unlink } = await import("node:fs/promises");
      const { join } = await import("node:path");
      await unlink(join(dir, key)).catch(() => {});
    },
  };
}

function createR2Storage(
  r2: { accountId: string; accessKey: string; secretKey: string; bucket: string },
  proxyUrl?: string,
): AudioStorage {
  // 启动即校验：R2 凭据缺失时立刻报错（而不是请求时炸）——本地 fs 开发不受影响
  for (const [k, v] of Object.entries(r2)) {
    if (!v) throw new Error(`r2 storage 缺少配置: ${k}`);
  }
  const endpoint = `https://${r2.accountId}.r2.cloudflarestorage.com`;
  const credentials = { accessKeyId: r2.accessKey, secretAccessKey: r2.secretKey };
  // 音频 Content-Type（按 key 后缀；R2 对象直链/播放需要）
  const contentType = (key: string): string | undefined => {
    if (key.endsWith(".mp3")) return "audio/mpeg";
    if (key.endsWith(".m4a")) return "audio/mp4";
    if (key.endsWith(".webm")) return "audio/webm";
    if (key.endsWith(".wav")) return "audio/wav";
    return undefined;
  };
  // 大陆网络直连 R2 握手失败（EPROTO）——配置 socks 代理后经代理访问；线上直连不设
  const makeClient = async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    if (!proxyUrl) return new S3Client({ region: "auto", endpoint, credentials });
    const [{ SocksProxyAgent }, { NodeHttpHandler }] = await Promise.all([
      import("socks-proxy-agent"),
      import("@smithy/node-http-handler"),
    ]);
    const agent = new SocksProxyAgent(proxyUrl);
    return new S3Client({
      region: "auto",
      endpoint,
      credentials,
      requestHandler: new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent }),
    });
  };
  return {
    async put(key, data) {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await makeClient();
      await client.send(
        new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: data, ContentType: contentType(key) }),
      );
    },
    async get(key, range) {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await makeClient();
      const out = await client.send(new GetObjectCommand({
        Bucket: r2.bucket,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }));
      const data = new Uint8Array(await out.Body!.transformToByteArray());
      // 总长度：ContentRange（"bytes 0-1023/7774710"）或 ContentLength
      const cr = out.ContentRange;
      const total = cr ? Number(cr.split("/")[1]) : data.length;
      return { data, total };
    },
    async delete(key) {
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await makeClient();
      await client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }));
    },
  };
}
