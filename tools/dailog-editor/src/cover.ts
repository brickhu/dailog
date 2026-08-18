// 封面生成（本地方案——随机纹理 + 随机配色；不满意贴图 URL 裁剪；无 Pexels 依赖）：
//   pnpm editor cover <submissionId> [--texture squares|crosses|hexagons|woven|diagonal|zigzag] [--colors "#hex,#hex"] [--image-url <url>]
//   · 默认：纹理随机 + 配色随机（配色组随机；可 --texture/--colors 固定复现）
//   · 纹理库：直线几何平铺（参照 riccardoscalco.it/textures 手法，全部直角——无圆形/圆角/文字）
//   · 渲染：渐变底色 + SVG pattern 纹理 + 噪点 → resvg → 1400×1400 标准 JPEG
//   · --image-url：编辑不满意时贴图片 URL → 下载 → ffmpeg 裁 1400×1400
//   · 产物：drafts/{submissionId}/cover.jpg
import { writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { Resvg } from "@resvg/resvg-js";
// color-hash 是 CJS（__esModule + default）：Node ESM 下 default import 拿到 module.exports
// （{default: 构造器}）——取 .default 兜底，兼容 tsc 类型与 node 运行时
import colorHashModule from "color-hash";
type ColorHashCtor = new (options?: unknown) => { hex(str: string): string };
const ColorHash = (colorHashModule as { default?: ColorHashCtor }).default ?? (colorHashModule as ColorHashCtor);
import type { EditorConfig } from "./lib.js";
import { draftDir, writeProgress } from "./lib.js";

const COVER_SIZE = 1400;

// ---------- 配色模型（先定底色 → 纹理色按色相差选，鲜明对比） ----------
/** 底色 = color-hash(投稿 id)：确定性（同投稿每次同底色，可复现）；配置深色调（低亮度、中饱和） */
const hashColor = new ColorHash({ saturation: [0.4, 0.7], lightness: [0.18, 0.38] });
/** 纹理色候选池（高饱和色相全覆盖）；选与底色色相差 ≥120° 的随机一个 */
const TEXTURE_STROKES = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#d946ef", "#ec4899",
];

/** hex → HSL */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s, l };
}

/** HSL → hex */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** 色相差（0-180） */
function hueDiff(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

/** 底色 → 暗化版（同色相渐变底） */
function darken(hex: string, factor = 0.82): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, s, l * factor);
}

/** 选纹理色：与底色色相差 ≥120° 的候选池随机一个（鲜明对比）；无满足 → 白色 */
function pickTextureColor(base: string): string {
  const { h } = hexToHsl(base);
  const candidates = TEXTURE_STROKES.filter((c) => hueDiff(h, hexToHsl(c).h) >= 120);
  const pool = candidates.length > 0 ? candidates : TEXTURE_STROKES;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------- 纹理库（SVG pattern 平铺，全部直线几何/直角） ----------
type TextureFn = (stroke: string, size: number, w: number) => string; // w = strokeWidth（thicker/thinner）

const TEXTURES: Record<string, TextureFn> = {
  /** 方块平铺（大框 + 内嵌小方块） */
  squares: (s, size, w) => `<pattern id="pat" width="${size * 2}" height="${size * 2}" patternUnits="userSpaceOnUse">
    <rect width="${size * 2}" height="${size * 2}" fill="none"/>
    <rect x="${size / 4}" y="${size / 4}" width="${size * 1.5}" height="${size * 1.5}" fill="none" stroke="${s}" stroke-width="${w}"/>
    <rect x="${size / 4}" y="${size / 4}" width="${size / 2}" height="${size / 2}" fill="${s}" opacity="0.5"/>
  </pattern>`,
  /** 十字 */
  crosses: (s, size, w) => `<pattern id="pat" width="${size}" height="${size}" patternUnits="userSpaceOnUse">
    <rect width="${size}" height="${size}" fill="none"/>
    <path d="M${size / 2 - size / 8} 0 L${size / 2 + size / 8} 0 L${size / 2 + size / 8} ${size / 2 - size / 8} L${size} ${size / 2 - size / 8} L${size} ${size / 2 + size / 8} L${size / 2 + size / 8} ${size / 2 + size / 8} L${size / 2 + size / 8} ${size} L${size / 2 - size / 8} ${size} L${size / 2 - size / 8} ${size / 2 + size / 8} L0 ${size / 2 + size / 8} L0 ${size / 2 - size / 8} L${size / 2 - size / 8} ${size / 2 - size / 8} Z" fill="none" stroke="${s}" stroke-width="${w}"/>
  </pattern>`,
  /** 六边形 */
  hexagons: (s, size, w) => `<pattern id="pat" width="${size * 1.5}" height="${size * 1.732}" patternUnits="userSpaceOnUse">
    <rect width="${size * 1.5}" height="${size * 1.732}" fill="none"/>
    <path d="M${size * 0.75} 0 L${size * 1.5} ${size * 0.433} L${size * 1.5} ${size * 1.299} L${size * 0.75} ${size * 1.732} L0 ${size * 1.299} L0 ${size * 0.433} Z" fill="none" stroke="${s}" stroke-width="${w}"/>
    <path d="M${size * 0.75} ${size * 0.866} L${size * 1.5} ${size * 1.299} L${size * 1.5} ${size * 1.732} L${size * 0.75} ${size * 1.732} L0 ${size * 1.732} L0 ${size * 1.299} Z" fill="none" stroke="${s}" stroke-width="${w}"/>
  </pattern>`,
  /** 编织斜线 */
  woven: (s, size, w) => `<pattern id="pat" width="${size}" height="${size}" patternUnits="userSpaceOnUse">
    <rect width="${size}" height="${size}" fill="none"/>
    <line x1="0" y1="${size}" x2="${size}" y2="0" stroke="${s}" stroke-width="${w}"/>
    <line x1="${size / 2}" y1="${size}" x2="${size}" y2="${size / 2}" stroke="${s}" stroke-width="${w}" opacity="0.5"/>
  </pattern>`,
  /** 对角斜线 */
  diagonal: (s, size, w) => `<pattern id="pat" width="${size}" height="${size}" patternUnits="userSpaceOnUse">
    <rect width="${size}" height="${size}" fill="none"/>
    <line x1="0" y1="0" x2="${size}" y2="${size}" stroke="${s}" stroke-width="${w}"/>
    <line x1="${size / 2}" y1="0" x2="${size}" y2="${size / 2}" stroke="${s}" stroke-width="${w}" opacity="0.4"/>
  </pattern>`,
  /** 锯齿折线 */
  zigzag: (s, size, w) => `<pattern id="pat" width="${size}" height="${size * 2}" patternUnits="userSpaceOnUse">
    <rect width="${size}" height="${size * 2}" fill="none"/>
    <path d="M0 ${size} L${size / 2} 0 L${size} ${size}" fill="none" stroke="${s}" stroke-width="${w}"/>
    <path d="M0 ${size * 2} L${size / 2} ${size} L${size} ${size * 2}" fill="none" stroke="${s}" stroke-width="${w}"/>
  </pattern>`,
  /** 竖线 */
  vertical: (s, size, w) => `<pattern id="pat" width="${size}" height="${size}" patternUnits="userSpaceOnUse">
    <rect width="${size}" height="${size}" fill="none"/>
    <line x1="${size / 2}" y1="0" x2="${size / 2}" y2="${size}" stroke="${s}" stroke-width="${w}"/>
    <line x1="${size / 6}" y1="0" x2="${size / 6}" y2="${size}" stroke="${s}" stroke-width="${w}" opacity="0.4"/>
    <line x1="${size * 5 / 6}" y1="0" x2="${size * 5 / 6}" y2="${size}" stroke="${s}" stroke-width="${w}" opacity="0.4"/>
  </pattern>`,
  /** 横线 */
  horizontal: (s, size, w) => `<pattern id="pat" width="${size}" height="${size}" patternUnits="userSpaceOnUse">
    <rect width="${size}" height="${size}" fill="none"/>
    <line x1="0" y1="${size / 2}" x2="${size}" y2="${size / 2}" stroke="${s}" stroke-width="${w}"/>
    <line x1="0" y1="${size / 6}" x2="${size}" y2="${size / 6}" stroke="${s}" stroke-width="${w}" opacity="0.4"/>
    <line x1="0" y1="${size * 5 / 6}" x2="${size}" y2="${size * 5 / 6}" stroke="${s}" stroke-width="${w}" opacity="0.4"/>
  </pattern>`,
  /** 3/8 阶梯斜线 */
  slash3: (s, size, w) => `<pattern id="pat" width="${size}" height="${size}" patternUnits="userSpaceOnUse">
    <rect width="${size}" height="${size}" fill="none"/>
    <path d="M0 ${size} L${size * 3 / 8} 0 L${size * 3 / 8 + size / 3} ${size} Z" fill="none" stroke="${s}" stroke-width="${w}"/>
  </pattern>`,
  /** 7/8 陡斜线 */
  slash7: (s, size, w) => `<pattern id="pat" width="${size}" height="${size}" patternUnits="userSpaceOnUse">
    <rect width="${size}" height="${size}" fill="none"/>
    <path d="M0 ${size} L${size * 7 / 8} 0 L${size * 7 / 8 + size / 5} ${size} Z" fill="none" stroke="${s}" stroke-width="${w}"/>
  </pattern>`,
  /** 圆点（对齐排列） */
  dots: (s, size, w) => `<pattern id="pat" width="${size}" height="${size}" patternUnits="userSpaceOnUse">
    <rect width="${size}" height="${size}" fill="none"/>
    <rect x="${size / 4}" y="${size / 4}" width="${size / 2}" height="${size / 2}" rx="${size / 4}" fill="${s}"/>
  </pattern>`,
  /** 圆点（错位互补排列） */
  dotsComplement: (s, size, w) => `<pattern id="pat" width="${size}" height="${size * 2}" patternUnits="userSpaceOnUse">
    <rect width="${size}" height="${size * 2}" fill="none"/>
    <rect x="${size / 4}" y="${size / 4}" width="${size / 2}" height="${size / 2}" rx="${size / 4}" fill="${s}"/>
    <rect x="${size * 3 / 4}" y="${size * 5 / 4}" width="${size / 2}" height="${size / 2}" rx="${size / 4}" fill="${s}"/>
  </pattern>`,
  /** 波浪 */
  waves: (s, size, w) => `<pattern id="pat" width="${size}" height="${size / 2}" patternUnits="userSpaceOnUse">
    <rect width="${size}" height="${size / 2}" fill="none"/>
    <path d="M0 ${size / 4} Q${size / 4} 0 ${size / 2} ${size / 4} T${size} ${size / 4}" fill="none" stroke="${s}" stroke-width="${w}"/>
  </pattern>`,
  /** 尼龙编织（曲线交叉） */
  nylon: (s, size, w) => `<pattern id="pat" width="${size}" height="${size}" patternUnits="userSpaceOnUse">
    <rect width="${size}" height="${size}" fill="none"/>
    <path d="M0 ${size} Q${size / 2} ${size * 3 / 4} ${size} ${size}" fill="none" stroke="${s}" stroke-width="${w}"/>
    <path d="M0 0 Q${size / 2} ${size / 4} ${size} 0" fill="none" stroke="${s}" stroke-width="${w}"/>
  </pattern>`,
  /** 圆头短线（caps） */
  caps: (s, size, w) => `<pattern id="pat" width="${size}" height="${size / 2}" patternUnits="userSpaceOnUse">
    <rect width="${size}" height="${size / 2}" fill="none"/>
    <rect x="0" y="${size / 8}" width="${size / 4}" height="${size / 4}" rx="${size / 8}" fill="${s}"/>
    <rect x="${size / 2}" y="${size / 8}" width="${size / 4}" height="${size / 4}" rx="${size / 8}" fill="${s}"/>
  </pattern>`,
};

const TEXTURE_NAMES = Object.keys(TEXTURES);

// ---------- 指令预置库（riccardoscalco.it/textures 页面展示的完整指令——随机选 1 条执行） ----------
interface Preset {
  name: string;          // 指令名（日志/固定复现用）
  texture: string;       // 本地纹理
  cells?: number;        // 每边块数（密度：heavier 更密 / lighter 更疏 / size 控制）
  strokeWidth?: number;  // thicker/thinner/strokeWidth
  stroke?: string;       // 指令指定纹理色（darkorange/firebrick…）；缺省 → 对比逻辑随机
  background?: string;   // 指令指定底色；缺省 → 深色池随机
}
const DARK_ORANGE = "#ff8c00";
const FIREBRICK = "#b22222";

const PRESETS: Preset[] = [
  // ---- lines（13） ----
  { name: "lines()", texture: "vertical" },
  { name: "lines().heavier()", texture: "vertical", cells: 12 },
  { name: "lines().lighter()", texture: "vertical", cells: 6 },
  { name: "lines().thicker()", texture: "vertical", strokeWidth: 4 },
  { name: "lines().thinner()", texture: "vertical", strokeWidth: 1 },
  { name: "lines().heavier(10).thinner(1.5)", texture: "vertical", cells: 12, strokeWidth: 1.5 },
  { name: "lines().size(4).strokeWidth(1)", texture: "vertical", cells: 14, strokeWidth: 1 },
  { name: "lines().size(8).strokeWidth(2)", texture: "vertical", cells: 10, strokeWidth: 2 },
  { name: "lines().orientation(vertical).strokeWidth(1)", texture: "vertical", strokeWidth: 1 },
  { name: "lines().orientation(3/8).stroke(darkorange)", texture: "slash3", stroke: DARK_ORANGE },
  { name: "lines().orientation(3/8,7/8).stroke(darkorange)", texture: "slash3", stroke: DARK_ORANGE },
  { name: "lines().orientation(vertical,horizontal).size(4).strokeWidth(1)", texture: "crosses", cells: 14, strokeWidth: 1, stroke: DARK_ORANGE },
  { name: "lines().orientation(diagonal).size(40).strokeWidth(26)", texture: "diagonal", cells: 4, strokeWidth: 26, stroke: DARK_ORANGE, background: FIREBRICK },
  // ---- circles（10） ----
  { name: "circles()", texture: "dots" },
  { name: "circles().heavier()", texture: "dots", cells: 12 },
  { name: "circles().lighter()", texture: "dots", cells: 6 },
  { name: "circles().thicker()", texture: "dots", cells: 10 },
  { name: "circles().thinner()", texture: "dots", cells: 10, strokeWidth: 1 },
  { name: "circles().complement()", texture: "dotsComplement" },
  { name: "circles().size(5)", texture: "dots", cells: 12 },
  { name: "circles().radius(4)", texture: "dots", cells: 10 },
  { name: "circles().radius(4).fill(transparent).strokeWidth(2)", texture: "dots", cells: 10 },
  { name: "circles().radius(4).fill(darkorange).stroke(firebrick).complement()", texture: "dotsComplement", stroke: FIREBRICK, background: DARK_ORANGE },
  // ---- paths（8） ----
  { name: "paths().d(hexagons).size(8).strokeWidth(2)", texture: "hexagons", cells: 10, strokeWidth: 2, stroke: DARK_ORANGE },
  { name: "paths().d(crosses).lighter().thicker()", texture: "crosses", cells: 6, strokeWidth: 4 },
  { name: "paths().d(caps).lighter().thicker().stroke(darkorange)", texture: "caps", cells: 6, strokeWidth: 4, stroke: DARK_ORANGE },
  { name: "paths().d(woven).lighter().thicker()", texture: "woven", cells: 6, strokeWidth: 4 },
  { name: "paths().d(waves).thicker().stroke(firebrick)", texture: "waves", strokeWidth: 4, stroke: FIREBRICK },
  { name: "paths().d(nylon).lighter()", texture: "nylon", cells: 6 },
  { name: "paths().d(squares).stroke(darkorange)", texture: "squares", stroke: DARK_ORANGE },
  { name: "paths().d(自定义).size(20).strokeWidth(1)", texture: "zigzag", cells: 10, strokeWidth: 1, stroke: DARK_ORANGE },
];

function parseArgs(args: string[]): { submissionId: string; texture: string | null; colors: [string, string] | null; imageUrl: string | null; strokeWidth: number } {
  const submissionId = args[0];
  const take = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
  };
  if (!submissionId) {
    console.error(`用法：pnpm editor cover <submissionId> [--texture ${TEXTURE_NAMES.join("|")}] [--colors "#hex,#hex"] [--image-url <URL>]`);
    process.exit(1);
  }
  const texture = take("--texture") ?? take("--theme") ?? null; // --theme 兼容旧参数
  if (texture && !(texture in TEXTURES)) {
    console.error(`[cover] 未知纹理：${texture}（可用：${TEXTURE_NAMES.join(" / ")}）`);
    process.exit(1);
  }
  const colorsRaw = take("--colors");
  let colors: [string, string] | null = null;
  if (colorsRaw) {
    const parts = colorsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 2 && parts.every((p) => /^#[0-9a-fA-F]{6}$/.test(p))) {
      colors = [parts[0], parts[1]]; // [底色, 纹理色]
    } else {
      console.error("[cover] --colors 格式：[底色,纹理色] 两个 hex（如 #0f172a,#ef4444）");
      process.exit(1);
    }
  }
  return { submissionId, texture, colors, imageUrl: take("--image-url") ?? null, strokeWidth: args.includes("--thicker") ? 4 : 2 };
}

/** 纹理区域边长（1400 - 10%×2 边距）与每边平铺块数：
 *  单块尺寸 = 区域边长 ÷ 块数（整除）——平铺后边缘与容器刚好吻合，无半块裁切 */
const PATTERN_AREA = 1120;
const PATTERN_CELLS = 8;

/** SVG 模板：底色渐变（同色相暗化）+ 对比纹理平铺 + 噪点（纯图形无文字无圆角） */
function svgTemplate(textureName: string, base: string, textureColor: string, strokeWidth: number, cells: number): string {
  // 单块尺寸基于容器计算：1120 ÷ cells（整除 → 完整排列，边缘吻合）
  const size = PATTERN_AREA / cells;
  const pattern = TEXTURES[textureName](`${textureColor}99`, size, strokeWidth); // 纹理色 60% 不透明度
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${COVER_SIZE}" height="${COVER_SIZE}" viewBox="0 0 1400 1400">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${base}"/><stop offset="100%" stop-color="${darken(base)}"/>
    </linearGradient>
    <filter id="noise"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0"/>
    </filter>
    ${pattern}
  </defs>
  <rect width="1400" height="1400" fill="url(#bg)"/>
  <!-- 纹理仅中间区域（四周 10% 留白）：1400 × 10% = 140 -->
  <rect x="140" y="140" width="1120" height="1120" fill="url(#pat)" opacity="0.9"/>
  <rect width="1400" height="1400" filter="url(#noise)" opacity="0.5"/>
</svg>`;
}

/** 封面渲染元信息（日志/固定复现提示用） */
export interface CoverRenderMeta {
  presetName: string;
  textureName: string;
  base: string;
  textureColor: string;
  strokeWidth: number;
  cells: number;
  /** 外部图片裁剪（--image-url）时 true */
  fromImage: boolean;
}

/** 生成封面 JPEG 字节（纹理 SVG+resvg 或外部图片裁剪）——不落盘，调用方决定写哪里。
 *  seed = 确定性底色哈希源（投稿 id / 播放列表 id）。
 *  供 cover（写草稿目录）与 playlist cover（直接上传）复用。 */
export async function renderCoverImage(opts: {
  seed: string;
  texture?: string | null;
  colors?: [string, string] | null;
  imageUrl?: string | null;
  strokeWidth?: number;
}): Promise<{ bytes: Uint8Array; meta: CoverRenderMeta }> {
  const { seed, texture, colors, imageUrl } = opts;
  let strokeWidth = opts.strokeWidth ?? 2;
  let textureName = texture ?? TEXTURE_NAMES[Math.floor(Math.random() * TEXTURE_NAMES.length)];

  if (imageUrl) {
    // 编辑不满意 → 贴图片 URL：下载 → ffmpeg 裁 1400×1400（临时目录，不污染草稿）
    console.log(`[cover] 下载外部图片：${imageUrl}`);
    let res: Response;
    try {
      res = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
    } catch {
      console.error("[cover] 图片下载失败（网络/超时）");
      process.exit(1);
    }
    if (!res.ok) {
      console.error(`[cover] 图片下载失败（HTTP ${res.status}）`);
      process.exit(1);
    }
    const src = new Uint8Array(await res.arrayBuffer());
    const tmp = join(tmpdir(), `dailog-cover-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`);
    const out = tmp.replace(/\.bin$/, ".jpg");
    writeFileSync(tmp, src);
    execFileSync("ffmpeg", [
      "-y", "-i", tmp,
      "-vf", "scale=1400:1400:force_original_aspect_ratio=increase,crop=1400:1400",
      "-q:v", "2", out,
    ], { stdio: "ignore" });
    rmSync(tmp, { force: true });
    const bytes = new Uint8Array(readFileSync(out));
    rmSync(out, { force: true });
    return { bytes, meta: { presetName: "外部图片", textureName, base: "", textureColor: "", strokeWidth, cells: 0, fromImage: true } };
  }

  // 默认：从页面指令预置库随机选 1 条完整执行（纹理+密度+线宽+颜色一起随机）
  let cells = PATTERN_CELLS;
  let base: string;
  let textureColor: string;
  let presetName = "（自定义）";
  if (!texture && !colors) {
    const preset = PRESETS[Math.floor(Math.random() * PRESETS.length)];
    textureName = preset.texture;
    cells = preset.cells ?? PATTERN_CELLS;
    strokeWidth = preset.strokeWidth ?? strokeWidth;
    base = preset.background ?? hashColor.hex(seed); // 底色 = 指令指定 或 seed 哈希
    textureColor = preset.stroke ?? pickTextureColor(base);
    presetName = preset.name;
  } else {
    // 手动指定（--texture/--colors）→ 底色 = 指定 或 seed 哈希；纹理色 = 指定 或 对比选
    base = colors ? colors[0] : hashColor.hex(seed);
    textureColor = colors ? colors[1] : pickTextureColor(base);
  }

  const svg = svgTemplate(textureName, base, textureColor, strokeWidth, cells);
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: COVER_SIZE } });
  const png = resvg.render().asPng();
  const pngPath = join(tmpdir(), `dailog-cover-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
  const jpgPath = pngPath.replace(/\.png$/, ".jpg");
  writeFileSync(pngPath, png);
  execFileSync("ffmpeg", ["-y", "-i", pngPath, "-q:v", "2", jpgPath], { stdio: "ignore" });
  rmSync(pngPath, { force: true });
  const bytes = new Uint8Array(readFileSync(jpgPath));
  rmSync(jpgPath, { force: true });
  return { bytes, meta: { presetName, textureName, base, textureColor, strokeWidth, cells, fromImage: false } };
}

export async function cover(config: EditorConfig, args: string[]): Promise<void> {
  const { submissionId, texture, colors, imageUrl, strokeWidth: strokeWidthArg } = parseArgs(args);
  const dir = draftDir(submissionId);
  const outPath = join(dir, "cover.jpg");
  const { bytes, meta } = await renderCoverImage({ seed: submissionId, texture, colors, imageUrl, strokeWidth: strokeWidthArg });
  writeFileSync(outPath, bytes);
  writeProgress(submissionId, "covered");
  if (meta.fromImage) {
    console.log(`[cover] ✅ 外部图片已裁剪 → ${outPath}`);
    return;
  }
  console.log(`[cover] ✅ 封面已生成（指令 ${meta.presetName} → ${meta.textureName} / 底色 ${meta.base} / 纹理色 ${meta.textureColor} / 线宽 ${meta.strokeWidth}px / ${meta.cells}×${meta.cells}）`);
  console.log(`[cover]   → ${outPath}`);
  console.log(`[cover]   固定复现：--texture ${meta.textureName} --colors "${meta.base},${meta.textureColor}"`);
  console.log(`[cover]   不满意？贴图重做：--image-url <URL>`);
}

