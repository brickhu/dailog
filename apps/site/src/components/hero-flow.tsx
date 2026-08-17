import { onCleanup, onMount } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors } from "@dailogues/ui/theme.stylex";

// ===========================================================================
// 首屏渐变流场（WebGL2 flowmap ping-pong，复刻 DeepSeek harness 首页背景技术）
//
// 渲染输出 = 主题色渐变：background 底色上漂移 surface/brand 色斑（多层值噪声
// domain warp），鼠标划过的位置通过 flowmap 扭曲渐变并留下逐渐消散的滞留痕迹，
// 底部渐隐回页面底色，融入页面无硬边。canvas 以 100vw 破格铺满 hero 首屏。
//
// 样式定制：所有视觉/物理参数集中在 CONFIG；色板跟随主题 token（明暗自动适配），
// 探针元素经 StyleX 挂 token，JS 用 getComputedStyle 读取实际颜色。
// 性能策略与 DeepSeek 一致：30fps 钳制、DPR 上限、流场 1/4 分辨率离屏、
// IntersectionObserver 离屏暂停、粗指针设备禁用鼠标交互（保留自动漂移）。
// WebGL2 不可用时静默降级（hero 保持纯页面底色）。
// ===========================================================================

const CONFIG = {
  /** 渐变漂移速度（u_time 乘数，越大流动越快） */
  driftSpeed: 0.06,
  /** 流场衰减（每帧乘数，越小消散越快） */
  decay: 0.94,
  /** 鼠标刷子半径（相对画布宽高归一化） */
  brushRadius: 0.16,
  /** 鼠标刷子强度 */
  brushStrength: 0.6,
  /** 鼠标位置指数平滑系数 */
  mouseSmoothing: 0.4,
  /** 鼠标速度平滑系数 */
  mouseVelocity: 0.5,
  /** 流场对线条的 UV 扰动强度 */
  flowBoost: 0.7,
  /** 波纹圈数（每单位半径的等值线数；配合密度曲线，中心附近最密） */
  lines: 2,
  /** 密度曲线（半径 sqrt 非线性映射系数：近处线密、远处线疏，值越大整体越密） */
  densityScale: 6,
  /** 线条宽度（0-0.5；值越大线条越粗；过渡区加宽 = 边缘模糊柔和） */
  lineWidth: 0.04,
  /** 圈形状不规则度（域扭曲噪声 + 多谐波调制：轮廓手绘般杂乱） */
  shapeWarp: 0.12,
  /** 形状 morph 速度（形态间循环过渡的周期系数；调小 = 形状基本稳定，视觉焦点在外扩） */
  morphSpeed: 2,
  /** 线条强度（foreground 对比已很强，0-1 调淡） */
  lineStrength: 0.7,
  /** 主色融入比例（线条基色向 brand 色混合：0 = 纯 foreground，1 = 纯主色） */
  brandMix: 0.15,
  /** 圈随半径的衰减系数（从中心圈边界起向外指数递减，越大外围透明度越低） */
  falloff: 1.8,
  /** 中心圈半径占视口宽度的比例（直径 = 2× = 视口宽 3%；p 空间按画布动态换算） */
  dotRadiusViewport: 0.015,
  /** 波纹圈中心水平位置（视口宽比例，0.8 = 80vw 处） */
  centerX: 0.7,
  /** 波纹圈中心垂直位置（vUv 空间，0.5 = 画布中心；0.3 ≈ 向下偏移视口 10%） */
  centerY: 0.3,
  /** 声波自动扩散速度（band 相位每秒漂移量：圈持续从中心向外扩展，声波主视觉） */
  ringDrift: 2.0,
  /** 透视水平压缩（喇叭在右侧、波向左扩散的侧视效果：右侧圈密、左侧圈疏） */
  perspK: 0.5,
  /** 透视垂直压缩（上方圈疏、下方圈密：纵向纵深） */
  perspKy: 0.7,
  /** 圈宽高比（横向压缩系数：0.67 ≈ 圈高度为宽度的 1.5 倍，竖长椭圆） */
  widthRatio: 2.0,
  /** 喇叭锥形（圈宽随方向变化：左侧远处更宽张开、右侧喇叭口更窄） */
  hornFlare: 1.0,
  /** 对角密度梯度（左上更疏、右下更密：在对角线方向额外缩放，拉大远近视差） */
  diagDensity: 1.0,
  /** 整体透明度（1 = 不透明；滚动淡出在此基础上叠加） */
  baseOpacity: 0.8,
  /** 线宽随半径变化系数（每 p 单位半径线宽变化的比例：内圈粗、外圈细，渐变平缓） */
  widthGrow: -0.5,
  /** 线宽对角线渐变（左上粗、右下细：正值为左上加粗右下变细） */
  diagGrow: 0.3,
  /** 图案整体旋转（弧度，顺时针；0.349 ≈ 20°） */
  rotate: 0.0,
  /** 模糊方向性（左上远焦模糊、右下近焦清晰：soft 过渡区随对角线方向缩放） */
  softDiag: 0.25,
  /** 左上雾化强度（左上线条峰值对比度降低——远焦雾化模糊感；0 = 关闭） */
  fogDiag: 0.45,
  /** 喇叭口暖色光晕（以中心圈为源的径向渐变，轻微点缀不盖住圈线） */
  edgeGlowAmount: 0.04,
  edgeGlowScale: 8.0,
  /** 锐度随半径降低速度（过渡区随半径放大：外圈逐渐模糊） */
  softGrow: 1.5,
  /** 鼠标涟漪（水波）幅度（p 空间；鼠标轨迹成为涟漪源，所有圈连带变形） */
  rippleAmp: 0.15,
  /** 涟漪径向频率（越大涟漪环越密） */
  rippleFreq: 18,
  /** 涟漪扩散速度（相位随时间的演化速度） */
  rippleSpeed: 2.0,
  /** 涟漪距离衰减（1/(1+d·衰减) 形式，远处保留更多——"整体连带"明显） */
  rippleDecay: 0.6,
  /** 中心圈随鼠标变形的强度（0=始终正圆；鼠标越近朝其方向凸出越明显） */
  shapeAmount: 0.6,
  /** 上下透明渐变区占比（顶部与底部各此比例渐隐到 0，中间不透明） */
  fadeStart: 0.3,
  /** 抗色带颗粒强度（0 关闭） */
  grain: 0.012,
  /** 渲染帧率上限 */
  fps: 30,
  /** 像素比上限 */
  maxDpr: 1.5,
  /** 流场离屏分辨率除数（画布 1/N 分辨率） */
  flowScale: 4,
  /** 滚动淡出距离（视口高度倍数：滚动这么多距离后背景完全透明） */
  scrollFadeViewports: 0.2,
};

type Vec3 = [number, number, number];

interface Palette {
  base: Vec3; // 页面底色（渐变基底 + 底部渐隐目标）
  line: Vec3; // foreground —— 波纹圈线条基色（明暗模式对比都最强）
  brand: Vec3; // brand —— 主色点缀（按 brandMix 比例融入线条）
}

// 探针读取失败的兜底色板（与 theme.stylex.ts 明暗值一致）
const FALLBACK_PALETTE: Record<"light" | "dark", Palette> = {
  light: {
    base: [0.976, 0.976, 0.976],
    line: [0.055, 0.067, 0.086],
    brand: [0.996, 0.91, 0.255],
  },
  dark: {
    base: [0.055, 0.067, 0.086],
    line: [0.902, 0.914, 0.937],
    brand: [0.996, 0.91, 0.255],
  },
};

/** 解析 computed style 颜色字符串为 0-1 的 RGB 分量 */
function parseColor(css: string): Vec3 | null {
  const m = css.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (!m) return null;
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
}

/** 从探针元素读取主题色板（StyleX token 编译为 var，computed style 已解析为实际颜色） */
function readPalette(probe: HTMLDivElement, dark: boolean): Palette {
  const cs = getComputedStyle(probe);
  const base = parseColor(cs.backgroundColor);
  const line = parseColor(cs.textDecorationColor);
  const brand = parseColor(cs.outlineColor);
  if (base && line && brand) return { base, line, brand };
  return FALLBACK_PALETTE[dark ? "dark" : "light"];
}

const probeStyles = stylex.create({
  probe: {
    position: "fixed",
    top: 0,
    left: "-9999px",
    width: 0,
    height: 0,
    overflow: "hidden",
    opacity: 0,
    pointerEvents: "none",
    // 每个属性承载一个主题 token，JS 用 getComputedStyle 一次性读出色板
    backgroundColor: colors.background,
    textDecorationColor: colors.foreground,
    outlineColor: colors.brand,
  },
});

const styles = stylex.create({
  wrap: {
    // 首页动画背景：fixed 贴视口顶部，高度由 JS 同步为 hero 实际高度，z -1 位于内容之下
    position: "fixed",
    top: 0,
    left: 0,
    width: "100vw",
    pointerEvents: "none",
    zIndex: -1,
  },
  canvas: {
    display: "block",
    width: "100%",
    height: "100%",
  },
});

const VERT = `#version 300 es
in vec2 a_position;
out vec2 vUv;
void main() {
  vUv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

// 流场更新 pass：读上一帧纹理，在鼠标位置画高斯衰减刷子
// r 通道存影响力，gb 通道存速度方向（flowmap 经典编码），每帧衰减
const FLOW_FRAG = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D u_prev;
uniform vec2 u_mouse;
uniform vec2 u_velocity;
uniform float u_brushRadius;
uniform float u_brushStrength;
uniform float u_decay;
out vec4 fragColor;

void main() {
  vec4 prev = texture(u_prev, vUv);

  prev.r *= u_decay;
  prev.gb = mix(vec2(0.5), prev.gb, u_decay);

  float dist = distance(vUv, u_mouse);
  float influence = exp(-dist * dist / (u_brushRadius * u_brushRadius * 0.5));
  influence = max(0.0, influence - 0.01);

  float speed = length(u_velocity);
  float presence = u_brushStrength * 0.3;
  float velBonus = min(speed * 3.0, 0.7) * u_brushStrength;
  float strength = presence + velBonus;

  prev.r = max(prev.r, influence * strength);
  float blend = influence * min(strength, 0.4) * 0.3;
  prev.g = mix(prev.g, clamp(u_velocity.x * 2.0 + 0.5, 0.0, 1.0), blend);
  prev.b = mix(prev.b, clamp(u_velocity.y * 2.0 + 0.5, 0.0, 1.0), blend);

  fragColor = prev;
}`;

// 渲染 pass：以 logo-field 面板为中心的波纹圈——每圈独立不规则（按圈号伪随机化
// warp 幅度/频率）；中心圈内圆点填充，圆点随鼠标偏移（幅度 ≤ 中心圈半径 50%）
const RENDER_FRAG = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform float u_time;
uniform vec2 u_resolution;
uniform sampler2D u_flowmap;
uniform float u_flowBoost;
uniform float u_lines;
uniform float u_densityScale;
uniform float u_ringDrift;
uniform float u_perspK;
uniform float u_perspKy;
uniform float u_widthRatio;
uniform float u_hornFlare;
uniform float u_diagDensity;
uniform float u_widthGrow;
uniform float u_diagGrow;
uniform float u_rotate;
uniform float u_softDiag;
uniform float u_fogDiag;
uniform float u_edgeGlowAmount;
uniform float u_edgeGlowScale;
uniform vec2 u_glowCenter;
uniform float u_softGrow;
uniform float u_lineWidth;
uniform float u_shapeWarp;
uniform float u_morphSpeed;
uniform float u_lineStrength;
uniform float u_falloff;
uniform float u_fadeStart;
uniform float u_grain;
uniform vec2 u_center;
uniform vec2 u_mouse;
uniform float u_dotRadius;
uniform float u_shapeAmount;
uniform float u_rippleAmp;
uniform float u_rippleFreq;
uniform float u_rippleSpeed;
uniform float u_rippleDecay;
uniform vec3 u_base;
uniform vec3 u_line;
uniform vec3 u_brand;
uniform float u_brandMix;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.0 + 7.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  float t = u_time * 0.06;
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 p = (vUv - 0.5) * 2.0 * aspect; // 居中 + 宽高比校正

  // 波纹圈中心 = logo-field 面板中心；鼠标位置（p 空间）
  vec2 centerP = (u_center - 0.5) * 2.0 * aspect;
  vec2 mouseP = (u_mouse - 0.5) * 2.0 * aspect;

  // 鼠标流场（r=影响力，gb=方向）
  vec4 flow = texture(u_flowmap, vUv);
  float influence = flow.r;
  vec2 flowDir = (flow.gb - 0.5) * 2.0;

  // 空间扭曲场：时间演化 + 鼠标扰动 → 波纹圈变形
  vec2 q = vec2(
    fbm(p * 1.2 + vec2(t, t * 0.7)),
    fbm(p * 1.2 - vec2(t * 0.6, t))
  );
  q += flowDir * influence * u_flowBoost * 1.2;

  float r = length(p - centerP);

  // —— 中心圈（半径 ≈ 面板尺寸）：树心空白区（不画年轮线），随鼠标方向变形 ——
  vec2 toMouse = mouseP - centerP;
  float ang = atan(p.y - centerP.y, p.x - centerP.x);
  float mouseAng = atan(toMouse.y, toMouse.x);
  float shape = 1.0 + u_shapeAmount * influence * 0.5 * (1.0 + cos(ang - mouseAng));
  float fill = 1.0 - smoothstep(u_dotRadius * 0.85, u_dotRadius * 1.05, r / shape);

  // —— 外圈：等值线波纹圈（喇叭在右侧、波向左扩散的透视同心圆）——
  // 透视：右侧（喇叭近处）圈密、左侧疏、下方密、上方疏（二维纵深）；
  // 图案整体顺时针旋转 u_rotate 弧度；屏幕方向（diag）用于线宽/模糊的
  // 左上-右下渐变（不随旋转）
  vec2 dPraw = p - centerP;
  float r0raw = length(dPraw);
  float diag = -(dPraw.x + dPraw.y) / max(0.001, r0raw);
  float rotA = u_rotate;
  vec2 dP = mat2(cos(rotA), sin(rotA), -sin(rotA), cos(rotA)) * dPraw;
  float r0 = length(dP);
  float ang2 = atan(dP.y, dP.x);
  float dirX = dP.x / max(0.001, r0);
  float dirY = dP.y / max(0.001, r0);
  float kx = mix(u_perspK, 1.0 / u_perspK, smoothstep(-0.08, 0.08, dirX));
  float ky = mix(u_perspKy, 1.0 / u_perspKy, smoothstep(-0.08, 0.08, dirY));
  // 喇叭锥形：左侧（远离喇叭）圈更宽张开、右侧（喇叭口）更窄——锥形展开感
  float wRatio = u_widthRatio * mix(u_hornFlare, 1.0 / u_hornFlare, smoothstep(-0.08, 0.08, dirX));
  // 对角密度梯度：左上（远）更疏、右下（近）更密——叠加在透视之上拉大远近视差
  float diagK = mix(1.0 / u_diagDensity, u_diagDensity, smoothstep(-0.2, 0.2, (dirX + dirY) * 0.707));
  float rad = length(vec2(dP.x * kx * wRatio * diagK, dP.y * ky * diagK));
  // 极坐标参数化噪声：角向低频（轮廓平滑不碎）+ 径向高频（相邻圈经过
  // 不同的噪声区，形状各异不雷同），且场连续无断裂
  // 形状 morph（参考 animejs 首屏 path morph：形状在多个形态间循环过渡）——
  // 两个形态各由独立空间噪声场 + 整数瓣谐波构成（角度连续、圈闭合无断裂），
  // 时间三角波权重在形态间插值：圈随时间从形态 A 平滑过渡到形态 B 再回来
  float shapeA = fbm(vec2(cos(ang2) * 1.5, rad * 8.0) + vec2(3.7, 1.3))
               + fbm(vec2(sin(ang2) * 1.5, rad * 8.0) + vec2(9.1, 5.3));
  float shapeB = fbm(vec2(cos(ang2) * 1.5, rad * 8.0) + vec2(5.3, 8.7))
               + fbm(vec2(sin(ang2) * 1.5, rad * 8.0) + vec2(1.9, 4.6));
  float phA = fbm(vec2(cos(ang2) * 1.2, rad * 6.0) + vec2(8.1, 2.2));
  float phB = fbm(vec2(cos(ang2) * 1.2, rad * 6.0) + vec2(3.4, 7.9));
  float fqA = 2.0 + floor(fbm(vec2(sin(ang2) * 1.0, rad * 5.0) + vec2(5.2, 9.4)) * 3.0);
  float fqB = 2.0 + floor(fbm(vec2(sin(ang2) * 1.0, rad * 5.0) + vec2(8.9, 4.1)) * 3.0);
  float morphA = shapeA * 0.5 + cos(fqA * ang2 + phA * 6.2831) * 0.5;
  float morphB = shapeB * 0.5 + cos(fqB * ang2 + phB * 6.2831) * 0.5;
  float cycle = 0.5 - 0.5 * cos(t * u_morphSpeed); // 0→1→0 循环
  float shapeField = mix(morphA, morphB, cycle);
  float rad2 = rad * (1.0 + u_shapeWarp * shapeField);

  // 鼠标涟漪（水波）：以鼠标位置为源（强度取鼠标处的流场影响力），
  // 径向 sin 波叠加进距离场——涟漪向四周扩散，远处圈也连带变形；
  // 随流场衰减平息（鼠标停住后 influence 消散，涟漪渐渐消失）
  vec2 toSrc = p - mouseP;
  float dSrc = length(toSrc);
  float mouseInf = texture(u_flowmap, u_mouse).r;
  float ripple = sin(dSrc * u_rippleFreq - t * u_rippleSpeed) * mouseInf * u_rippleAmp / (1.0 + dSrc * u_rippleDecay);

  float field = rad2 + ripple;
  // 密度从中心圈往外逐渐降低：半径 sqrt 非线性映射——
  // 近处场梯度大（线密）、远处梯度小（线疏），树轮的真实疏密特征
  float rn = sqrt(max(0.0, field) * u_densityScale);
  float band = fract(rn * u_lines - t * u_ringDrift);
  float d = min(band, 1.0 - band);
  // 线宽与锐度随半径渐变：内圈粗而清晰，外圈细而微柔（外圈不过度模糊）；
  // 线宽叠加对角线渐变（左上粗、右下细）；模糊叠加方向性（左上远焦模糊、右下近焦清晰）
  float radial = max(0.0, r - u_dotRadius);
  float lw = u_lineWidth * max(0.2, 1.0 + radial * u_widthGrow) * (1.0 + u_diagGrow * diag);
  float soft = (1.0 + radial * u_softGrow) * (1.0 + u_softDiag * diag);
  float line = (1.0 - smoothstep(lw * 0.5, lw * 3.0 * soft, d)) * (1.0 - fill);

  // 透明度从中心圈边界起向外指数递减（圈内无线的区域 fall > 1 无影响）
  float fall = exp(-(r - u_dotRadius) * u_falloff);

  // 线条基色 = foreground 按 brandMix 比例融入主色（适当的主色点缀）；
  // 左上远焦雾化：峰值混合量按对角线方向降低（线变淡变糊，视觉模糊感）
  float fog = 1.0 - u_fogDiag * diag;
  vec3 lineColor = mix(u_line, u_brand, u_brandMix);
  vec3 col = u_base;
  col = mix(col, lineColor, line * u_lineStrength * fall * fog);
  // 喇叭口暖色光晕：以中心圈（喇叭口）为源的径向渐变——
  // 右侧近喇叭处带色，右上/左上等远离喇叭口的区域不叠加
  float dGlow = length(vUv - u_glowCenter);
  float edgeGlow = exp(-dGlow * u_edgeGlowScale);
  col = mix(col, u_brand, edgeGlow * u_edgeGlowAmount);

  // 上下对称透明渐变：GL 坐标 vUv.y 0=底 1=顶——
  // 顶部与底部各 fadeStart 占比区渐隐到 0，中间不透明（整体上下逐渐透明）
  float fadeBottom = smoothstep(0.0, u_fadeStart, vUv.y);
  float fadeTop = 1.0 - smoothstep(1.0 - u_fadeStart, 1.0, vUv.y);
  float fade = fadeBottom * fadeTop;
  col += (hash(vUv * u_resolution) - 0.5) * u_grain;

  fragColor = vec4(col, fade);
}`;

interface FlowTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

function initHeroFlow(canvas: HTMLCanvasElement, probe: HTMLDivElement): () => void {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: false,
    powerPreference: "low-power",
  });
  if (!gl) return () => {};

  const compile = (type: number, src: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("[hero-flow] shader:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const link = (vs: string, fs: string): WebGLProgram | null => {
    const prog = gl.createProgram();
    if (!prog) return null;
    const v = compile(gl.VERTEX_SHADER, vs);
    const f = compile(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    gl.attachShader(prog, v);
    gl.attachShader(prog, f);
    gl.bindAttribLocation(prog, 0, "a_position"); // 两个 program 统一 attribute 槽位
    gl.linkProgram(prog);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("[hero-flow] link:", gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return null;
    }
    return prog;
  };

  const flowProg = link(VERT, FLOW_FRAG);
  const renderProg = link(VERT, RENDER_FRAG);
  if (!flowProg || !renderProg) return () => {};

  // 全屏四边形（TRIANGLE_STRIP 4 顶点）
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  if (!vao || !buf) return () => {};
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const uni = (prog: WebGLProgram, name: string) => gl.getUniformLocation(prog, name);
  const uFlow = {
    prev: uni(flowProg, "u_prev"),
    mouse: uni(flowProg, "u_mouse"),
    velocity: uni(flowProg, "u_velocity"),
    radius: uni(flowProg, "u_brushRadius"),
    strength: uni(flowProg, "u_brushStrength"),
    decay: uni(flowProg, "u_decay"),
  };
  const uRender = {
    time: uni(renderProg, "u_time"),
    resolution: uni(renderProg, "u_resolution"),
    flowmap: uni(renderProg, "u_flowmap"),
    flowBoost: uni(renderProg, "u_flowBoost"),
    lines: uni(renderProg, "u_lines"),
    densityScale: uni(renderProg, "u_densityScale"),
    ringDrift: uni(renderProg, "u_ringDrift"),
    perspK: uni(renderProg, "u_perspK"),
    perspKy: uni(renderProg, "u_perspKy"),
    widthRatio: uni(renderProg, "u_widthRatio"),
    hornFlare: uni(renderProg, "u_hornFlare"),
    diagDensity: uni(renderProg, "u_diagDensity"),
    widthGrow: uni(renderProg, "u_widthGrow"),
    softGrow: uni(renderProg, "u_softGrow"),
    lineWidth: uni(renderProg, "u_lineWidth"),
    diagGrow: uni(renderProg, "u_diagGrow"),
    rotate: uni(renderProg, "u_rotate"),
    softDiag: uni(renderProg, "u_softDiag"),
    fogDiag: uni(renderProg, "u_fogDiag"),
    edgeGlowAmount: uni(renderProg, "u_edgeGlowAmount"),
    edgeGlowScale: uni(renderProg, "u_edgeGlowScale"),
    glowCenter: uni(renderProg, "u_glowCenter"),
    shapeWarp: uni(renderProg, "u_shapeWarp"),
    morphSpeed: uni(renderProg, "u_morphSpeed"),
    lineStrength: uni(renderProg, "u_lineStrength"),
    falloff: uni(renderProg, "u_falloff"),
    fadeStart: uni(renderProg, "u_fadeStart"),
    grain: uni(renderProg, "u_grain"),
    center: uni(renderProg, "u_center"),
    mouse: uni(renderProg, "u_mouse"),
    dotRadius: uni(renderProg, "u_dotRadius"),
    shapeAmount: uni(renderProg, "u_shapeAmount"),
    rippleAmp: uni(renderProg, "u_rippleAmp"),
    rippleFreq: uni(renderProg, "u_rippleFreq"),
    rippleSpeed: uni(renderProg, "u_rippleSpeed"),
    rippleDecay: uni(renderProg, "u_rippleDecay"),
    base: uni(renderProg, "u_base"),
    line: uni(renderProg, "u_line"),
    brand: uni(renderProg, "u_brand"),
    brandMix: uni(renderProg, "u_brandMix"),
  };

  // 流场离屏 target（ping-pong 双缓冲，1/4 分辨率）
  const makeTarget = (): FlowTarget => {
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new Error("alloc");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fbo, tex };
  };
  const targets: FlowTarget[] = [makeTarget(), makeTarget()];
  let fw = 0;
  let fh = 0;
  const ensureFlowSize = (w: number, h: number) => {
    if (fw === w && fh === h) return;
    fw = w;
    fh = h;
    for (const t of targets) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.clearColor(0, 0.5, 0.5, 1); // 中性流场：r=0 无影响，gb=0.5 无方向
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  };

  // 鼠标状态（归一化坐标，y 翻转——flowmap 与 GL 坐标系一致）
  const mouse = { x: 0.5, y: 0.5, sx: 0.5, sy: 0.5, vx: 0, vy: 0, svx: 0, svy: 0 };
  const coarse = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  const onMove = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0) return;
    mouse.x = (e.clientX - r.left) / r.width;
    mouse.y = 1 - (e.clientY - r.top) / r.height;
  };
  if (!coarse) window.addEventListener("mousemove", onMove);

  // 主题色板：初始读取 + 明暗切换时重读（probe 的 StyleX token 自动跟随）
  const themeMQ = window.matchMedia("(prefers-color-scheme: dark)");
  let palette = readPalette(probe, themeMQ.matches);
  const onTheme = () => {
    palette = readPalette(probe, themeMQ.matches);
  };
  themeMQ.addEventListener("change", onTheme);

  let visible = true;
  const io = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
  });
  io.observe(canvas);

  // 滚动淡出：页面滚动时背景 opacity 1 → 0（滚动 scrollFadeViewports 个视口高度后完全透明）。
  // 滚动容器 = 最近的 overflow-y 可滚祖先（应用壳 shellRoot 内部滚动，非 window）
  // hero 高度同步：背景（fixed 于视口顶部）高度 = hero 实际高度 × 1.5——
  // HeroFlow 在 hero 外，CSS 无法引用其高度，用 ResizeObserver 监听 hero 尺寸变化
  const heroEl = canvas.parentElement!.nextElementSibling as HTMLElement | null;
  const heroSync = () => {
    if (heroEl && heroEl.offsetHeight > 0) {
      canvas.parentElement!.style.height = heroEl.offsetHeight * 1.1 + "px";
    }
  };
  const heroRO = heroEl ? new ResizeObserver(heroSync) : null;
  if (heroRO && heroEl) heroRO.observe(heroEl);
  heroSync();

  let scroller: HTMLElement | null = null;
  {
    let node = canvas.parentElement;
    while (node) {
      const s = getComputedStyle(node);
      if (/(auto|scroll)/.test(s.overflowY)) {
        scroller = node;
        break;
      }
      node = node.parentElement;
    }
  }
  const onScroll = () => {
    if (!scroller) return;
    const distance = scroller.clientHeight * CONFIG.scrollFadeViewports;
    const t = Math.min(1, scroller.scrollTop / Math.max(1, distance));
    canvas.parentElement!.style.opacity = String(CONFIG.baseOpacity * (1 - t));
  };
  if (scroller) scroller.addEventListener("scroll", onScroll, { passive: true });
  canvas.parentElement!.style.opacity = String(CONFIG.baseOpacity);

  // 波纹圈中心：优先 logo-field 面板位置（存在时）；缺省 = centerX 视口比例处
  const attract = { x: CONFIG.centerX, y: CONFIG.centerY };
  const updateAttractor = () => {
    const el = document.querySelector("[data-hero-attractor]");
    const cr = canvas.getBoundingClientRect();
    if (!el || cr.width === 0 || cr.height === 0) return;
    const pr = el.getBoundingClientRect();
    // 面板中心（vUv 空间，y 翻转对齐 GL 坐标）
    attract.x = (pr.left + pr.width / 2 - cr.left) / cr.width;
    attract.y = 1 - (pr.top + pr.height / 2 - cr.top) / cr.height;
  };
  updateAttractor();

  let dbW = 0;
  let dbH = 0;
  let pong = 0;
  const STEP = 1000 / CONFIG.fps;
  const t0 = performance.now();

  const step = (now: number) => {
    // 尺寸变化 → 重建绘制缓冲 + 流场离屏
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDpr);
    const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (cw !== dbW || ch !== dbH) {
      dbW = cw;
      dbH = ch;
      canvas.width = cw;
      canvas.height = ch;
      ensureFlowSize(Math.max(1, Math.round(cw / CONFIG.flowScale)), Math.max(1, Math.round(ch / CONFIG.flowScale)));
      updateAttractor(); // 布局/断点变化后刷新汇聚中心
    }

    // 鼠标位置 + 速度双指数平滑
    mouse.sx += (mouse.x - mouse.sx) * CONFIG.mouseSmoothing;
    mouse.sy += (mouse.y - mouse.sy) * CONFIG.mouseSmoothing;
    mouse.svx += ((mouse.x - mouse.sx) * 0.5 - mouse.svx) * CONFIG.mouseVelocity;
    mouse.svy += ((mouse.y - mouse.sy) * 0.5 - mouse.svy) * CONFIG.mouseVelocity;

    // pass 1：流场更新（读上一帧 target，写入另一个）
    const cur = targets[pong];
    const next = targets[pong ^ 1];
    pong ^= 1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.viewport(0, 0, fw, fh);
    gl.useProgram(flowProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cur.tex);
    gl.uniform1i(uFlow.prev, 0);
    gl.uniform2f(uFlow.mouse, mouse.sx, mouse.sy);
    gl.uniform2f(uFlow.velocity, mouse.svx, mouse.svy);
    gl.uniform1f(uFlow.radius, CONFIG.brushRadius);
    gl.uniform1f(uFlow.strength, CONFIG.brushStrength);
    gl.uniform1f(uFlow.decay, CONFIG.decay);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // pass 2：渐变渲染到屏幕
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, dbW, dbH);
    gl.useProgram(renderProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, next.tex);
    gl.uniform1i(uRender.flowmap, 0);
    gl.uniform1f(uRender.time, (now - t0) / 1000);
    gl.uniform2f(uRender.resolution, dbW, dbH);
    gl.uniform1f(uRender.flowBoost, CONFIG.flowBoost);
    gl.uniform1f(uRender.lines, CONFIG.lines);
    gl.uniform1f(uRender.densityScale, CONFIG.densityScale);
    gl.uniform1f(uRender.ringDrift, CONFIG.ringDrift);
    gl.uniform1f(uRender.perspK, CONFIG.perspK);
    gl.uniform1f(uRender.perspKy, CONFIG.perspKy);
    gl.uniform1f(uRender.widthRatio, CONFIG.widthRatio);
    gl.uniform1f(uRender.hornFlare, CONFIG.hornFlare);
    gl.uniform1f(uRender.diagDensity, CONFIG.diagDensity);
    gl.uniform1f(uRender.widthGrow, CONFIG.widthGrow);
    gl.uniform1f(uRender.softGrow, CONFIG.softGrow);
    gl.uniform1f(uRender.lineWidth, CONFIG.lineWidth);
    gl.uniform1f(uRender.diagGrow, CONFIG.diagGrow);
    gl.uniform1f(uRender.rotate, CONFIG.rotate);
    gl.uniform1f(uRender.softDiag, CONFIG.softDiag);
    gl.uniform1f(uRender.fogDiag, CONFIG.fogDiag);
    gl.uniform1f(uRender.edgeGlowAmount, CONFIG.edgeGlowAmount);
    gl.uniform1f(uRender.edgeGlowScale, CONFIG.edgeGlowScale);
    gl.uniform2f(uRender.glowCenter, CONFIG.centerX, CONFIG.centerY);
    gl.uniform2f(uRender.glowCenter, CONFIG.centerX, CONFIG.centerY);
    gl.uniform1f(uRender.shapeWarp, CONFIG.shapeWarp);
    gl.uniform1f(uRender.morphSpeed, CONFIG.morphSpeed);
    gl.uniform1f(uRender.lineStrength, CONFIG.lineStrength);
    gl.uniform1f(uRender.falloff, CONFIG.falloff);
    gl.uniform1f(uRender.fadeStart, CONFIG.fadeStart);
    gl.uniform1f(uRender.grain, CONFIG.grain);
    gl.uniform2f(uRender.center, attract.x, attract.y);
    gl.uniform2f(uRender.mouse, mouse.sx, mouse.sy);
    // 中心圈半径：直径 = 视口宽 10%（半径 = 5% 宽）；p 空间每单位 = 画布高/2 像素
    gl.uniform1f(uRender.dotRadius, (2 * CONFIG.dotRadiusViewport * dbW) / dbH);
    gl.uniform1f(uRender.shapeAmount, CONFIG.shapeAmount);
    gl.uniform1f(uRender.rippleAmp, CONFIG.rippleAmp);
    gl.uniform1f(uRender.rippleFreq, CONFIG.rippleFreq);
    gl.uniform1f(uRender.rippleSpeed, CONFIG.rippleSpeed);
    gl.uniform1f(uRender.rippleDecay, CONFIG.rippleDecay);
    gl.uniform3f(uRender.base, ...palette.base);
    gl.uniform3f(uRender.line, ...palette.line);
    gl.uniform3f(uRender.brand, ...palette.brand);
    gl.uniform1f(uRender.brandMix, CONFIG.brandMix);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  let raf = 0;
  let last = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (now - last < STEP) return;
    last = now - ((now - last) % STEP);
    if (!visible || !canvas.isConnected) return;
    step(now);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("mousemove", onMove);
    themeMQ.removeEventListener("change", onTheme);
    io.disconnect();
    heroRO?.disconnect();
    scroller?.removeEventListener("scroll", onScroll);
    for (const t of targets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    gl.deleteVertexArray(vao);
    gl.deleteBuffer(buf);
    gl.deleteProgram(flowProg);
    gl.deleteProgram(renderProg);
  };
}

/** 首屏渐变流场背景：绝对定位铺满 hero（100vw 破格全幅），内容之下。 */
export function HeroFlow() {
  let probeRef: HTMLDivElement | undefined;
  let canvasRef: HTMLCanvasElement | undefined;
  let cleanup: (() => void) | undefined;

  onMount(() => {
    if (canvasRef && probeRef) cleanup = initHeroFlow(canvasRef, probeRef);
  });
  onCleanup(() => cleanup?.());

  return (
    <>
      <div ref={probeRef} {...stylex.props(probeStyles.probe)} aria-hidden="true" />
      <div {...stylex.props(styles.wrap)}>
        <canvas ref={canvasRef} {...stylex.props(styles.canvas)} />
      </div>
    </>
  );
}
