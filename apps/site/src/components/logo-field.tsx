import { onCleanup, onMount } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors } from "@dailogues/ui/theme.stylex";

// ===========================================================================
// 图案粒子场（Canvas 2D，复刻 DeepSeek harness 首页 2D 粒子层）
//
// 粒子静止位按 SVG path 字形采样排列（离屏 canvas 填充 path → 网格取点）；
// 鼠标靠近产生斥力把图案"冲散"，移开后弹簧回位复原；网格相邻粒子之间连线，
// 靠近鼠标的粒子变大变亮。样式定制：CONFIG 集中物理参数，props 可换图案/颜色。
// 性能：30fps 钳制、DPR 上限、IntersectionObserver 离屏暂停、静止自动停帧、
// 粗指针设备（触摸）不挂交互监听（展示静态点阵）。
// ===========================================================================

/** favicon.svg 的绿色字形（104×104 viewBox，单个 path 含 4 个子路径） */
export const FAVICON_PATH =
  "M66 80L74 72H82V80H78L70 88H62L54 80H22V72H58L66 80ZM30 40H54V24H62V64H54V48H30V64H22V24H30V40ZM82 64H74V16H82V64ZM54 24H30V16H54V24Z";

/** 9 圆点网格图案（256×256 viewBox，Phosphor dots-nine 风格）——默认图案 */
export const DOTS_NINE_PATH =
  "M136 16v32a8 8 0 0 1-16 0V16a8 8 0 0 1 16 0m40 40a8 8 0 0 0-8 8v32a8 8 0 0 0 16 0V64a8 8 0 0 0-8-8m-48 144a8 8 0 0 0-8 8v32a8 8 0 0 0 16 0v-32a8 8 0 0 0-8-8m0-120a8 8 0 0 0-8 8v80a8 8 0 0 0 16 0V88a8 8 0 0 0-8-8M80 56a8 8 0 0 0-8 8v56a8 8 0 0 0 16 0V64a8 8 0 0 0-8-8m96 72a8 8 0 0 0-8 8v56a8 8 0 0 0 16 0v-56a8 8 0 0 0-8-8M32 104a8 8 0 0 0-8 8v32a8 8 0 0 0 16 0v-32a8 8 0 0 0-8-8m48 48a8 8 0 0 0-8 8v32a8 8 0 0 0 16 0v-32a8 8 0 0 0-8-8m144-48a8 8 0 0 0-8 8v32a8 8 0 0 0 16 0v-32a8 8 0 0 0-8-8";

const CONFIG = {
  /** 采样网格间距（图案 viewBox 坐标系下的像素，越小粒子越密） */
  gridSpacing: 7,
  /** 采样 alpha 阈值（0-255，低于此值的格子不布点） */
  sampleThreshold: 96,
  /** 图案占面板短边的比例 */
  fitRatio: 0.85,
  /** 鼠标斥力半径（显示像素） */
  mouseRadius: 140,
  /** 斥力强度 */
  pushStrength: 30,
  /** 弹簧回位系数 */
  spring: 0.05,
  /** 阻尼（每帧速度乘数） */
  damping: 0.85,
  /** 相邻点连线两端内缩（显示像素） */
  lineInset: 10,
  /** 连线最小长度（过短不画，避免静止时网格线过密） */
  minLine: 20,
  /** 静止粒子半宽（fillRect 半径） */
  dotSize: 1.8,
  /** 靠近鼠标的最大粒子半宽 */
  dotSizeMax: 3.8,
  /** 帧率上限 */
  fps: 30,
  /** 像素比上限 */
  maxDpr: 2,
};

export interface LogoFieldProps {
  /** 图案 SVG path 数组（默认 9 圆点网格；favicon 字形传 [FAVICON_PATH] + viewSize 104） */
  paths?: string[];
  /** 图案 viewBox 尺寸（path 坐标系边长；默认 256） */
  viewSize?: number;
  /** 粒子颜色（默认读取主题 foreground token，明暗自适应） */
  dotColor?: string;
  /** 连线颜色（默认同粒子色） */
  lineColor?: string;
  /** 粒子不透明度（默认 0.5） */
  dotAlpha?: number;
  /** 连线不透明度（默认 0.5） */
  lineAlpha?: number;
  /** 连线宽度 */
  lineWidth?: number;
}

interface FieldOptions {
  paths: string[];
  viewSize: number;
  /** 缺省 = 读取面板 computed foreground（主题 token，明暗自适应） */
  dotColor?: string;
  lineColor?: string;
  dotAlpha: number;
  lineAlpha: number;
  lineWidth: number;
}

interface Pt {
  restX: number;
  restY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  col: number;
  row: number;
}

/** 解析颜色字符串（computed style 的 rgb(...) 或 #hex）为 [r,g,b] */
function parseRgbColor(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = css.replace("#", "");
  if (h.length === 3 || h.length === 6) {
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const n = parseInt(full, 16);
    if (!Number.isNaN(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return null;
}

function initLogoField(canvas: HTMLCanvasElement, panel: HTMLDivElement, opts: FieldOptions): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  // —— 图案采样：离屏 viewSize×viewSize 填充 path → 网格取点（记录行列用于相邻连线） ——
  const PATTERN = opts.viewSize;
  const probe = document.createElement("canvas");
  probe.width = PATTERN;
  probe.height = PATTERN;
  const pctx = probe.getContext("2d");
  if (!pctx) return () => {};
  pctx.fillStyle = "#fff";
  for (const d of opts.paths) pctx.fill(new Path2D(d));
  const img = pctx.getImageData(0, 0, PATTERN, PATTERN);

  const spacing = CONFIG.gridSpacing;
  const sampled: { x: number; y: number; col: number; row: number }[] = [];
  let row = 0;
  for (let y = spacing / 2; y < PATTERN; y += spacing, row++) {
    let col = 0;
    for (let x = spacing / 2; x < PATTERN; x += spacing, col++) {
      const a = img.data[(Math.round(y) * PATTERN + Math.round(x)) * 4 + 3];
      if (a > CONFIG.sampleThreshold) sampled.push({ x, y, col, row });
    }
  }

  let points: Pt[] = [];
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  const layout = () => {
    cssW = canvas.clientWidth;
    cssH = canvas.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDpr);
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = (Math.min(cssW, cssH) * CONFIG.fitRatio) / PATTERN;
    const ox = (cssW - PATTERN * scale) / 2;
    const oy = (cssH - PATTERN * scale) / 2;
    points = sampled.map((p) => ({
      restX: ox + p.x * scale,
      restY: oy + p.y * scale,
      x: ox + p.x * scale,
      y: oy + p.y * scale,
      vx: 0,
      vy: 0,
      col: p.col,
      row: p.row,
    }));
  };

  // 粒子/连线颜色：默认读面板 computed color（StyleX 挂 colors.foreground，明暗自适应）；
  // 主题切换时重读并重绘一帧
  let dotRgb: [number, number, number] | null = null;
  let lineRgb: [number, number, number] | null = null;
  const resolveColors = () => {
    const cs = getComputedStyle(panel);
    dotRgb = opts.dotColor ? parseRgbColor(opts.dotColor) : parseRgbColor(cs.color);
    lineRgb = opts.lineColor ? parseRgbColor(opts.lineColor) : dotRgb;
  };
  resolveColors();
  const themeMQ = window.matchMedia("(prefers-color-scheme: dark)");
  const onTheme = () => {
    resolveColors();
    if (!running) {
      running = true;
      raf = requestAnimationFrame(frame);
    }
  };
  themeMQ.addEventListener("change", onTheme);

  // 鼠标（画布 CSS 像素坐标；触摸设备不挂监听 → 静态点阵）
  const mouse = { x: NaN, y: NaN };
  const coarse = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  let running = true;
  const onMove = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    if (!running) {
      running = true;
      raf = requestAnimationFrame(frame);
    }
  };
  if (!coarse) window.addEventListener("mousemove", onMove);

  let visible = true;
  const io = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
  });
  io.observe(canvas);

  const draw = () => {
    if (cssW !== canvas.clientWidth || cssH !== canvas.clientHeight) layout();
    ctx.clearRect(0, 0, cssW, cssH);

    // 斥力 + 弹簧回位（DeepSeek 同款物理：斥力 ∝ 1-d/r，阻尼 0.85）
    let maxSpeed = 0;
    for (const p of points) {
      if (!isNaN(mouse.x) && !isNaN(mouse.y)) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < CONFIG.mouseRadius && d > 0.1) {
          const f = (1 - d / CONFIG.mouseRadius) * CONFIG.pushStrength;
          p.vx += (dx / d) * f * 0.1;
          p.vy += (dy / d) * f * 0.1;
        }
      }
      p.vx += CONFIG.spring * (p.restX - p.x);
      p.vy += CONFIG.spring * (p.restY - p.y);
      p.vx *= CONFIG.damping;
      p.vy *= CONFIG.damping;
      p.x += p.vx;
      p.y += p.vy;
      const speed = Math.abs(p.vx) + Math.abs(p.vy);
      if (speed > maxSpeed) maxSpeed = speed;
    }

    // 网格相邻点连线（行列相邻，随粒子位移拉伸变形）
    const byKey = new Map<string, Pt>();
    for (const p of points) byKey.set(`${p.row},${p.col}`, p);
    const lineTriplet = lineRgb ?? [14, 17, 22];
    ctx.strokeStyle = `rgba(${lineTriplet.join(",")}, ${opts.lineAlpha})`;
    ctx.lineWidth = opts.lineWidth;
    const drawLine = (a: Pt, b: Pt) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < CONFIG.minLine) return;
      ctx.beginPath();
      ctx.moveTo(a.x + (dx / d) * CONFIG.lineInset, a.y + (dy / d) * CONFIG.lineInset);
      ctx.lineTo(b.x - (dx / d) * CONFIG.lineInset, b.y - (dy / d) * CONFIG.lineInset);
      ctx.stroke();
    };
    for (const p of points) {
      const right = byKey.get(`${p.row},${p.col + 1}`);
      if (right) drawLine(p, right);
      const below = byKey.get(`${p.row + 1},${p.col}`);
      if (below) drawLine(p, below);
    }

    // 粒子（靠近鼠标的变大变亮；透明度走 globalAlpha，fillStyle 保持不透明避免双重 alpha）
    const dotTriplet = dotRgb ?? [14, 17, 22];
    ctx.fillStyle = `rgb(${dotTriplet.join(",")})`;
    for (const p of points) {
      let size = CONFIG.dotSize;
      let alpha = opts.dotAlpha;
      if (!isNaN(mouse.x) && !isNaN(mouse.y)) {
        const d = Math.hypot(p.x - mouse.x, p.y - mouse.y);
        const near = Math.max(0, 1 - d / CONFIG.mouseRadius);
        size = CONFIG.dotSize + (CONFIG.dotSizeMax - CONFIG.dotSize) * near;
        alpha = Math.min(1, opts.dotAlpha + 0.4 * near);
      }
      ctx.globalAlpha = alpha;
      ctx.fillRect(p.x - size, p.y - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1;

    if (maxSpeed < 0.01) running = false; // 静止停帧，鼠标移动时重启
  };

  let raf = 0;
  let last = 0;
  const STEP = 1000 / CONFIG.fps;
  const frame = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (now - last < STEP) return;
    last = now - ((now - last) % STEP);
    if (!visible || !canvas.isConnected) return;
    draw();
  };
  layout();
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("mousemove", onMove);
    themeMQ.removeEventListener("change", onTheme);
    io.disconnect();
  };
}

// 断点标签（与 theme.stylex.ts 的 DESKTOP/TABLET 同值——stylex babel 插件不支持
// 跨文件常量解析，本地定义保持一致；改断点请同步 theme.stylex.ts）
const DESKTOP = "@media (width >= 1024px)";
const TABLET = "@media (640px <= width < 1024px)";

const styles = stylex.create({
  panel: {
    position: "relative",
    width: "100%",
    maxWidth: "400px",
    aspectRatio: "4 / 3", // 移动优先
    flexShrink: 0,
    // 粒子颜色来源：JS 读 computed color（明暗自适应）
    color: colors.foreground,
    [TABLET]: {
      aspectRatio: "1 / 1",
    },
    [DESKTOP]: {
      aspectRatio: "1 / 1",
    },
  },
  canvas: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
  },
});

/** 图案粒子场：粒子排成 SVG 图案点阵（无底，直接浮在渐变背景上），鼠标靠近散开弹回。 */
export function LogoField(props: LogoFieldProps) {
  let panelRef: HTMLDivElement | undefined;
  let canvasRef: HTMLCanvasElement | undefined;
  let cleanup: (() => void) | undefined;

  onMount(() => {
    if (!canvasRef || !panelRef) return;
    cleanup = initLogoField(canvasRef, panelRef, {
      paths: props.paths ?? [DOTS_NINE_PATH],
      viewSize: props.viewSize ?? 256,
      dotColor: props.dotColor,
      lineColor: props.lineColor,
      dotAlpha: props.dotAlpha ?? 0.5,
      lineAlpha: props.lineAlpha ?? 0.5,
      lineWidth: props.lineWidth ?? 0.6,
    });
  });
  onCleanup(() => cleanup?.());

  return (
    <div ref={panelRef} {...stylex.props(styles.panel)} data-hero-attractor="true">
      <canvas ref={canvasRef} {...stylex.props(styles.canvas)} aria-hidden="true" />
    </div>
  );
}
