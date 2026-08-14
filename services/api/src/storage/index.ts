import { join } from "node:path";

export interface AudioStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  /** 读取对象；range 可选（R2 原生分片读取——音频流式播放只拉需要的区间）。
   *  返回 { data, total }：total = 对象完整长度（分片请求也能拿到） */
  get(key: string, range?: { start: number; end: number }): Promise<{ data: Uint8Array; total: number }>;
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

/** 磁盘缓存包装：get 先查本地缓存，未命中从远端拉（小分片先快速响应 + 后台全量落盘） */
function createDiskCached(inner: AudioStorage, cacheDir: string): AudioStorage {
  const fileOf = (key: string) => {
    // key 形如 voices/{userId}/{lang}.webm / episodes/{userId}/{id}.mp3——路径安全（无 ..）
    return join(cacheDir, key);
  };
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  return {
    async put(key, data) {
      await inner.put(key, data);
      // 写回时同步清缓存（避免旧内容）
      const { unlink } = await import("node:fs/promises");
      await unlink(fileOf(key)).catch(() => {});
    },
    async get(key, range) {
      const { readFile, stat, writeFile, mkdir } = await import("node:fs/promises");
      const file = fileOf(key);
      // 缓存命中（TTL 内）：本地磁盘直读（毫秒）
      try {
        const st = await stat(file);
        if (Date.now() - st.mtimeMs < CACHE_TTL_MS) {
          const full = new Uint8Array(await readFile(file));
          if (!range) return { data: full, total: full.length };
          const end = Math.min(range.end, full.length - 1);
          return { data: full.subarray(range.start, end + 1), total: full.length };
        }
      } catch { /* 未命中 */ }
      // 未命中：小分片先用远端 Range 快速响应，同时后台全量落盘；无 range 直接全量落盘
      if (range) {
        const r = await inner.get(key, range);
        void inner.get(key).then(async (full) => {
          try {
            await mkdir(join(file, ".."), { recursive: true });
            await writeFile(file, full.data);
          } catch { /* 缓存失败静默 */ }
        }).catch(() => {});
        return r;
      }
      const full = await inner.get(key);
      try {
        await mkdir(join(file, ".."), { recursive: true });
        await writeFile(file, full.data);
      } catch { /* 缓存失败静默 */ }
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
