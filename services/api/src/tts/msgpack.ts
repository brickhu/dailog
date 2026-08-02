/**
 * msgpack 最小编码器（覆盖本包所需类型：map/str/bin/array/int/bool/nil）。
 *
 * 从 scripts/spikes/fish-audio.mjs 的 msgpackEncode 原样移植——该实现已对
 * api.fish.audio 实测通过（docs/spikes/fish-audio.md §3-a / §9-3：服务器对 msgpack
 * body 严格校验，编码错误返回 400；此编码器短字符串分支修过丢字节 bug，勿改动）。
 */
export function msgpackEncode(value: unknown): Uint8Array<ArrayBuffer> {
  const out: Buffer[] = [];
  const push = (b: Buffer) => out.push(b);

  const w = (v: unknown): void => {
    if (v === null || v === undefined) {
      push(Buffer.from([0xc0]));
    } else if (typeof v === "boolean") {
      push(Buffer.from([v ? 0xc3 : 0xc2]));
    } else if (typeof v === "string") {
      const b = Buffer.from(v, "utf8");
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
    } else if (typeof v === "number" && Number.isInteger(v)) {
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
    } else if (typeof v === "object") {
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
        w((v as Record<string, unknown>)[k]);
      }
    } else {
      throw new Error(`msgpack: 不支持的类型 ${typeof v}`);
    }
  };

  w(value);
  // Uint8Array.from 生成 ArrayBuffer-backed 副本（BodyInit 需要 Uint8Array<ArrayBuffer>）
  return Uint8Array.from(Buffer.concat(out));
}
