export interface AssetStore {
  get(key: string): Promise<Uint8Array | null>;
}

/** 本地资产目录读取（assets/audio/），文件缺失/读取失败返回 null（资产由 Task 11 生成，之前必须降级） */
export function createLocalAssetStore(dir: string): AssetStore {
  return {
    async get(key) {
      try {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        return new Uint8Array(await readFile(join(dir, key)));
      } catch {
        return null;
      }
    },
  };
}
