// 图标生成：无依赖手写 PNG（zlib deflate + CRC32）。
// 设计：深色圆角方块 + 中心圆点（彩 #34d399 / 灰 #94a3b8），与 FAB 风格一致。
// 4x 超采样 + 盒式下采样实现抗锯齿。输出 icons/{color,gray}/icon{16,32,48,128}.png
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // scanlines: filter byte 0 + RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0;
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (1 + size * 4) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- 绘制 ----------
function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** 圆角方块 + 圆点的距离场渲染（返回 size² 的 RGBA） */
function render(size, bg, dot) {
  const ss = 4; // 超采样倍数
  const S = size * ss;
  const px = new Float64Array(S * S * 4);
  const bgRgb = hexToRgb(bg);
  const dotRgb = hexToRgb(dot);
  const half = S / 2;
  const corner = S * 0.22;   // 圆角半径
  const dotR = S * 0.16;     // 中心圆点半径
  const inset = S * 0.07;    // 方块与边缘留白

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // 圆角方块覆盖
      const qx = Math.max(Math.abs(x + 0.5 - half) - (half - corner - inset), 0);
      const qy = Math.max(Math.abs(y + 0.5 - half) - (half - corner - inset), 0);
      const sq = Math.hypot(qx, qy);
      const rect = clamp01(0.5 + (corner - sq)); // 0=外 1=内（软边 1px@SS）
      // 中心圆点覆盖
      const d = Math.hypot(x + 0.5 - half, y + 0.5 - half);
      const circ = clamp01(0.5 + (dotR - d));
      const i = (y * S + x) * 4;
      // 合成：底=方块色，上=圆点色
      const base = rect;
      const over = rect * circ;
      px[i] = bgRgb[0] * (base - over) + dotRgb[0] * over;
      px[i + 1] = bgRgb[1] * (base - over) + dotRgb[1] * over;
      px[i + 2] = bgRgb[2] * (base - over) + dotRgb[2] * over;
      px[i + 3] = base * 255;
    }
  }
  // 盒式下采样回目标尺寸
  const out = new Uint8Array(size * size * 4);
  const f = ss * ss;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * S + x * ss + sx) * 4;
          r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3];
        }
      }
      const i = (y * size + x) * 4;
      out[i] = Math.round(r / f);
      out[i + 1] = Math.round(g / f);
      out[i + 2] = Math.round(b / f);
      out[i + 3] = Math.round(a / f);
    }
  }
  return out;
}

const SIZES = [16, 32, 48, 128];
const VARIANTS = { color: "#34d399", gray: "#94a3b8" };
const BG = "#0f172a";

export function generateIcons() {
  for (const [variant, dot] of Object.entries(VARIANTS)) {
    for (const size of SIZES) {
      const file = join(ROOT, "icons", variant, `icon${size}.png`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, encodePng(size, render(size, BG, dot)));
    }
  }
  console.log(`icons generated → icons/{color,gray}/icon{${SIZES.join(",")}}.png`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  generateIcons();
}
