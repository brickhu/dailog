function msgpackEncode(value) {
  const out = [];
  const push = (b) => out.push(b);
  const w = (v) => {
    if (v === null || v === void 0) {
      push(Buffer.from([192]));
    } else if (typeof v === "boolean") {
      push(Buffer.from([v ? 195 : 194]));
    } else if (typeof v === "string") {
      const b = Buffer.from(v, "utf8");
      const n = b.length;
      if (n < 32) push(Buffer.concat([Buffer.from([160 | n]), b]));
      else if (n < 256) push(Buffer.concat([Buffer.from([217, n]), b]));
      else if (n < 65536) {
        const h = Buffer.alloc(3);
        h[0] = 218;
        h.writeUInt16BE(n, 1);
        push(Buffer.concat([h, b]));
      } else {
        const h = Buffer.alloc(5);
        h[0] = 219;
        h.writeUInt32BE(n, 1);
        push(Buffer.concat([h, b]));
      }
    } else if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
      const b = Buffer.from(v);
      const n = b.length;
      if (n < 256) push(Buffer.concat([Buffer.from([196, n]), b]));
      else if (n < 65536) {
        const h = Buffer.alloc(3);
        h[0] = 197;
        h.writeUInt16BE(n, 1);
        push(Buffer.concat([h, b]));
      } else {
        const h = Buffer.alloc(5);
        h[0] = 198;
        h.writeUInt32BE(n, 1);
        push(Buffer.concat([h, b]));
      }
    } else if (typeof v === "number" && Number.isInteger(v)) {
      if (v >= 0 && v < 128) push(Buffer.from([v]));
      else {
        const h = Buffer.alloc(9);
        h[0] = 211;
        h.writeBigInt64BE(BigInt(v), 1);
        push(h);
      }
    } else if (Array.isArray(v)) {
      const n = v.length;
      if (n < 16) push(Buffer.from([144 | n]));
      else if (n < 65536) {
        const h = Buffer.alloc(3);
        h[0] = 220;
        h.writeUInt16BE(n, 1);
        push(h);
      } else {
        const h = Buffer.alloc(5);
        h[0] = 221;
        h.writeUInt32BE(n, 1);
        push(h);
      }
      for (const item of v) w(item);
    } else if (typeof v === "object") {
      const keys = Object.keys(v);
      const n = keys.length;
      if (n < 16) push(Buffer.from([128 | n]));
      else if (n < 65536) {
        const h = Buffer.alloc(3);
        h[0] = 222;
        h.writeUInt16BE(n, 1);
        push(h);
      } else {
        const h = Buffer.alloc(5);
        h[0] = 223;
        h.writeUInt32BE(n, 1);
        push(h);
      }
      for (const k of keys) {
        w(k);
        w(v[k]);
      }
    } else {
      throw new Error(`msgpack: \u4E0D\u652F\u6301\u7684\u7C7B\u578B ${typeof v}`);
    }
  };
  w(value);
  return Uint8Array.from(Buffer.concat(out));
}
export {
  msgpackEncode
};
