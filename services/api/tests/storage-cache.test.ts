import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDiskCached, type AudioStorage } from "../src/storage";

// 磁盘缓存回归：分片播放时的两个致命坑
//  1. 整文件下载必须单飞（否则 N 个分片各拉一遍整文件，抢带宽 → 分片请求超时 → 播放卡死）
//  2. 落盘必须原子（否则并发读到半截缓存 → total 缩水 → 播放器提前停播）

const KEY = "episodes/u/1.mp3";
const DATA = new Uint8Array(512 * 1024).map((_, i) => i % 251);
const dirs: string[] = [];

async function tmpCacheDir() {
  const d = await mkdtemp(join(tmpdir(), "dailog-cache-"));
  dirs.push(d);
  return d;
}

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

/** 计数用的远端 storage（模拟 R2）：整文件下载故意慢，放大并发窗口 */
function countingInner(delayMs = 50) {
  const calls = { full: 0, range: 0, lastRange: null as null | { start: number; end: number } };
  const inner: AudioStorage = {
    put: async () => {},
    delete: async () => {},
    get: async (_key, range) => {
      if (range) {
        calls.range += 1;
        calls.lastRange = { ...range };
        const end = Math.min(range.end, DATA.length - 1);
        return { data: DATA.subarray(range.start, end + 1), total: DATA.length };
      }
      calls.full += 1;
      await new Promise((r) => setTimeout(r, delayMs));
      return { data: DATA, total: DATA.length };
    },
  };
  return { inner, calls };
}

async function settle(ms = 250) {
  await new Promise((r) => setTimeout(r, ms));
}

describe("磁盘缓存层（createDiskCached）", () => {
  it("并发分片未命中时，整文件只下载一次（单飞）", async () => {
    const cacheDir = await tmpCacheDir();
    const { inner, calls } = countingInner(80);
    const s = createDiskCached(inner, cacheDir);

    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        s.get(KEY, { start: i * 1024, end: i * 1024 + 1023 }),
      ),
    );
    await settle();

    expect(calls.range).toBe(6); // 每个分片各自快速响应
    expect(calls.full).toBe(1); // 但整文件落盘只跑一次
  });

  it("冷缓存首个分片只向远端取一小段（先出声），落盘后本地一次回完", async () => {
    const cacheDir = await tmpCacheDir();
    const { inner, calls } = countingInner(10);
    const s = createDiskCached(inner, cacheDir);

    // 调用方按"一路到文件尾"的大区间请求：未命中时不能真的等整集下完才回
    await s.get(KEY, { start: 0, end: 32 * 1024 * 1024 - 1 });
    expect(calls.lastRange!.end - calls.lastRange!.start + 1).toBeLessThanOrEqual(2 * 1024 * 1024);
    await settle();

    // 落盘后同样的大区间：本地缓存一次回到文件尾（不再有分片往返）
    const hit = await s.get(KEY, { start: 0, end: 32 * 1024 * 1024 - 1 });
    expect(hit.total).toBe(DATA.length);
    expect(hit.data.length).toBe(DATA.length);
    expect(calls.range).toBe(1); // 第二次没再打远端
  });

  it("落盘是原子的：不留临时文件，缓存内容完整", async () => {
    const cacheDir = await tmpCacheDir();
    const { inner } = countingInner(10);
    const s = createDiskCached(inner, cacheDir);

    await s.get(KEY, { start: 0, end: 1023 });
    await settle();

    const cached = new Uint8Array(await readFile(join(cacheDir, KEY)));
    expect(cached.length).toBe(DATA.length);
    expect(cached[DATA.length - 1]).toBe(DATA[DATA.length - 1]);
    const left = await readdir(join(cacheDir, "episodes", "u"));
    expect(left.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("命中缓存后 total 永远是完整长度，尾部分片可读", async () => {
    const cacheDir = await tmpCacheDir();
    const { inner } = countingInner(10);
    const s = createDiskCached(inner, cacheDir);
    await s.get(KEY, { start: 0, end: 1023 });
    await settle();

    const tail = await s.get(KEY, { start: DATA.length - 100, end: DATA.length + 999999 });
    expect(tail.total).toBe(DATA.length); // total 不会因半截文件缩水
    expect(tail.data.length).toBe(100);
    expect(tail.data[99]).toBe(DATA[DATA.length - 1]);
  });

  it("getStream 命中缓存时按区间流式读取；未命中返回 null", async () => {
    const cacheDir = await tmpCacheDir();
    const { inner } = countingInner(10);
    const s = createDiskCached(inner, cacheDir);

    expect(await s.getStream?.(KEY, { start: 0, end: 99 })).toBeNull(); // 冷缓存

    await s.get(KEY);
    await settle();

    const streamed = await s.getStream?.(KEY, { start: 10, end: 10 + 4095 });
    expect(streamed).not.toBeNull();
    expect(streamed!.total).toBe(DATA.length);
    expect(streamed!.start).toBe(10);
    expect(streamed!.end).toBe(10 + 4095);
    const chunks: Uint8Array[] = [];
    const reader = streamed!.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Uint8Array);
    }
    const got = chunks.reduce<number[]>((acc, c) => acc.concat(Array.from(c)), []);
    expect(got.length).toBe(4096);
    expect(got[0]).toBe(DATA[10]);

    // 区间越界 → null（交回 get() 走 416 分支）
    expect(await s.getStream?.(KEY, { start: DATA.length + 5, end: DATA.length + 100 })).toBeNull();
  });

  it("put 后缓存失效（不会再吐旧内容）", async () => {
    const cacheDir = await tmpCacheDir();
    const { inner } = countingInner(10);
    const s = createDiskCached(inner, cacheDir);
    await s.get(KEY);
    await settle();
    await s.put(KEY, new Uint8Array([1, 2, 3]));
    await expect(readFile(join(cacheDir, KEY))).rejects.toThrow();
  });
});
