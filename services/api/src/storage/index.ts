export interface AudioStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

export interface StorageOptions {
  driver: "fs" | "r2";
  dir?: string;                 // fs driver 根目录
  r2?: { accountId: string; accessKey: string; secretKey: string; bucket: string };
}

export function createStorage(opts: StorageOptions): AudioStorage {
  if (opts.driver === "r2") {
    if (!opts.r2) throw new Error("r2 storage 缺少配置");
    return createR2Storage(opts.r2);
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
  };
}

function createR2Storage(r2: { accountId: string; accessKey: string; secretKey: string; bucket: string }): AudioStorage {
  // @aws-sdk/client-s3 + endpoint https://{accountId}.r2.cloudflarestorage.com
  // 本地测试不覆盖 R2（部署环境验证）；此处保持轻量实现，部署时联调。
  return {
    async put(key, data) {
      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({
        region: "auto",
        endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: r2.accessKey, secretAccessKey: r2.secretKey },
      });
      await client.send(new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: data }));
    },
    async get(key) {
      const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({
        region: "auto",
        endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: r2.accessKey, secretAccessKey: r2.secretKey },
      });
      const out = await client.send(new GetObjectCommand({ Bucket: r2.bucket, Key: key }));
      return new Uint8Array(await out.Body!.transformToByteArray());
    },
  };
}
