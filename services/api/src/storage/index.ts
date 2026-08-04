export interface AudioStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** 删除对象（导入失败补偿/测试清理）；对象不存在不报错 */
  delete(key: string): Promise<void>;
}

export interface StorageOptions {
  driver: "fs" | "r2";
  dir?: string;                 // fs driver 根目录
  r2?: { accountId: string; accessKey: string; secretKey: string; bucket: string };
  /** R2 出口代理（本地大陆网络访问 r2.cloudflarestorage.com 需走 socks5；线上直连留空） */
  r2ProxyUrl?: string;
}

export function createStorage(opts: StorageOptions): AudioStorage {
  if (opts.driver === "r2") {
    if (!opts.r2) throw new Error("r2 storage 缺少配置");
    return createR2Storage(opts.r2, opts.r2ProxyUrl);
  }
  return createFsStorage(opts.dir ?? "./data");
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
    async get(key) {
      checkKey(key);
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      return new Uint8Array(await readFile(join(dir, key)));
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
    async get(key) {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await makeClient();
      const out = await client.send(new GetObjectCommand({ Bucket: r2.bucket, Key: key }));
      return new Uint8Array(await out.Body!.transformToByteArray());
    },
    async delete(key) {
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await makeClient();
      await client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }));
    },
  };
}
