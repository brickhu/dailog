#!/usr/bin/env node
/**
 * 从 packages/ui/src/theme.stylex.ts 生成可直接导入 Figma 的设计令牌 JSON。
 *
 * 用法:node docs/figma/generate.mjs
 * 输出(docs/figma/):
 *   figma-light.json — 浅色模式全量令牌(付费计划:与 dark 一起拖入 → Light 模式)
 *   figma-dark.json  — 暗色模式全量令牌(付费计划:与 light 一起拖入 → Dark 模式)
 *   figma-free.json  — 免费版单文件(浅色 + Dark/ 前缀的暗色副本,导入后仅 1 个模式)
 *
 * 格式:W3C Design Tokens Community Group (DTCG) 格式,这是 Figma 原生导入接受的格式。
 * 官方说明(help.figma.com "Modes for variables" → Import modes):
 * - 导入方式:新建集合后,把 JSON 文件拖进 Variables 视图,每个文件生成一个模式
 * - 支持类型:color / dimension(单位必须 px)/ number / string / fontFamily / duration(单位必须 s)
 * - 不支持:easing;shadow 用 string 保存 CSS 参考值
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "packages/ui/src/theme.stylex.ts");
const HERE = dirname(fileURLToPath(import.meta.url));

const src = readFileSync(SRC, "utf8");

// ---------- 解析 theme.stylex.ts ----------

function extractBlock(exportName) {
  const start = src.indexOf(`export const ${exportName} = stylex.defineVars({`);
  if (start === -1) throw new Error(`未找到 export const ${exportName}`);
  const open = src.indexOf("{", start);
  const close = src.indexOf("})", open);
  return src.slice(open + 1, close);
}

const COLOR_LINE = /^\s*(\w+):\s*\{default:\s*"(#[0-9a-fA-F]{6})",\s*\[DARK\]:\s*"(#[0-9a-fA-F]{6})"\},?\s*$/;
const PLAIN_LINE = /^\s*(\w+):\s*"([^"]*)",?\s*(?:\/\/.*)?$/;

function parseColorBlock() {
  const vars = {};
  for (const line of extractBlock("colors").split("\n")) {
    const m = line.match(COLOR_LINE);
    if (m) vars[m[1]] = { light: m[2], dark: m[3] };
  }
  return vars;
}

function parsePlainBlock(exportName) {
  const vars = {};
  for (const line of extractBlock(exportName).split("\n")) {
    const m = line.match(PLAIN_LINE);
    if (m) vars[m[1]] = m[2].trim();
  }
  return vars;
}

const colors = parseColorBlock();
const dimensions = parsePlainBlock("dimensions");
const durations = parsePlainBlock("durations");
const fontfamilies = parsePlainBlock("fontfamilies");
const shadows = parsePlainBlock("shadows");

// 排版样式(stylex.create 块,字段引用同名 defineVars 变量)
const TYPO_RE = /(\w+):\s*\{\s*fontFamily: fontfamilies\.(\w+),\s*fontSize: dimensions\.(\w+),\s*fontWeight: dimensions\.(\w+),\s*lineHeight: "([^"]+)",?\s*\}/g;
function parseTypographyBlock() {
  const start = src.indexOf("export const typography = stylex.create({");
  const open = src.indexOf("{", start);
  const close = src.indexOf("})", open);
  const block = src.slice(open + 1, close);
  const out = {};
  let m;
  TYPO_RE.lastIndex = 0;
  while ((m = TYPO_RE.exec(block))) out[m[1]] = { font: m[2], size: m[3], weight: m[4], lineHeight: m[5] };
  return out;
}
const typography = parseTypographyBlock();

// ---------- 值转换(DTCG) ----------

// 颜色:Figma 官方示例格式(srgb 组件 + hex)
const colorValue = (hex) => ({
  colorSpace: "srgb",
  components: [
    Math.round((parseInt(hex.slice(1, 3), 16) / 255) * 10000) / 10000,
    Math.round((parseInt(hex.slice(3, 5), 16) / 255) * 10000) / 10000,
    Math.round((parseInt(hex.slice(5, 7), 16) / 255) * 10000) / 10000,
  ],
  alpha: 1,
  hex: hex.toUpperCase(),
});

// rem → px(16px 基准;Figma dimension 单位只支持 px)
const remToPx = (rem) => Math.round(parseFloat(rem) * 16);

// "onPrimaryWeak" → 基础名 "primary"
const familyOf = (name) => {
  const base = name.replace(/^on/, "").replace(/Weak$|Strong$/, "");
  return base.charAt(0).toLowerCase() + base.slice(1);
};

// ---------- 描述 ----------

const FAMILY_LABEL = {
  primary: "主色", secondary: "次色", brand: "品牌色", neutral: "中性色",
  surface: "表面", popover: "浮层", background: "背景", foreground: "前景",
  danger: "危险", warning: "警告", success: "成功", ink: "水墨色(阴影/分割线/边框)",
};

function colorDescription(name) {
  const strength = name.endsWith("Weak") ? "弱化版" : name.endsWith("Strong") ? "强化版" : "";
  const on = name.startsWith("on");
  const baseLabel = FAMILY_LABEL[familyOf(name)] || familyOf(name);
  if (on) return strength ? `${baseLabel}${strength}上的前景色` : `${baseLabel}上的前景色`;
  return `${baseLabel}${strength}`;
}

const SIZE_LABEL = { xs: "XS", sm: "SM", md: "MD", lg: "LG", xl: "XL", "2xl": "2XL" };

function dimensionDescription(name, value) {
  if (name.startsWith("spacing")) return `间距 ${parseFloat(value)}px`;
  if (name.startsWith("size")) {
    const key = name.slice(4);
    return key === "0" ? "区块尺寸 0px" : `区块尺寸 ${SIZE_LABEL[key] || key}(${parseFloat(value)}px)`;
  }
  if (name.startsWith("radius")) {
    return name === "radiusFull" ? "圆角 全圆(9999px)" : `圆角 ${parseFloat(value)}px`;
  }
  if (name.startsWith("fontSize")) {
    return value.endsWith("rem")
      ? `字号 ${remToPx(value)}px(源 token: ${value})`
      : `字号 ${parseFloat(value)}px`;
  }
  if (name.startsWith("fontWeight")) return `字重 ${parseFloat(value)}`;
  if (name.startsWith("borderWidth")) return `描边宽度 ${parseFloat(value)}px`;
  return value;
}

// ---------- 组装 DTCG ----------

const COLOR_GROUPS = {
  primary: "Primary", secondary: "Secondary", brand: "Brand",
  neutral: "Neutral", surface: "Surface", popover: "Popover",
  background: "Background", foreground: "Foreground",
  danger: "Danger", warning: "Warning", success: "Success", ink: "Ink",
};

// 颜色:{"Primary": {"primary": {...}, ...}, ...}
function colorGroups(hexMap) {
  const groups = {};
  for (const [name, hex] of Object.entries(hexMap)) {
    const group = COLOR_GROUPS[familyOf(name)];
    (groups[group] ??= {})[name] = { $type: "color", $value: colorValue(hex), $description: colorDescription(name) };
  }
  return groups;
}

// 非颜色令牌(light/dark/free 三个文件共用,值相同)
function commonGroups() {
  // 尺寸:dimension,单位 px
  const dim = {};
  const dimGroups = [
    { prefix: "spacing", group: "Spacing" },
    { prefix: "size", group: "Size" },
    { prefix: "radius", group: "Radius" },
    { prefix: "fontSize", group: "Font Size" },
    { prefix: "borderWidth", group: "Border Width" },
  ];
  for (const { prefix, group } of dimGroups) {
    dim[group] = {};
    for (const [name, value] of Object.entries(dimensions)) {
      if (!name.startsWith(prefix)) continue;
      dim[group][name] = {
        $type: "dimension",
        $value: { value: value.endsWith("rem") ? remToPx(value) : parseFloat(value), unit: "px" },
        $description: dimensionDescription(name, value),
      };
    }
  }
  // 字重:number
  dim["Font Weight"] = {};
  for (const [name, value] of Object.entries(dimensions)) {
    if (!name.startsWith("fontWeight")) continue;
    dim["Font Weight"][name] = { $type: "number", $value: parseFloat(value), $description: dimensionDescription(name, value) };
  }

  // 字体族:fontFamily,只保留首选字体
  const FONT_LABEL = { body: "正文/UI 字体", heading: "标题字体", code: "代码字体" };
  const font = {};
  for (const [name, stack] of Object.entries(fontfamilies)) {
    font[name] = {
      $type: "fontFamily",
      $value: stack.split(",")[0].trim().replace(/^'|'$/g, ""),
      $description: `${FONT_LABEL[name] || name}。完整字体栈:${stack}`,
    };
  }

  // 时长:duration,单位 s(Figma 只支持 s)
  const dur = {};
  for (const [name, value] of Object.entries(durations)) {
    dur[name] = { $type: "duration", $value: { value: parseFloat(value) / 1000, unit: "s" }, $description: `动效时长 ${parseFloat(value)}ms` };
  }

  // 阴影:Figma 无阴影类型,用 string 存 CSS 参考值
  const shadow = {};
  for (const [name, value] of Object.entries(shadows)) {
    shadow[name] = { $type: "string", $value: value, $description: "CSS box-shadow 值,仅作参考;实际效果请用 Effect style 实现" };
  }

  return { Dimension: dim, "Font Family": font, Duration: dur, Shadow: shadow };
}

// ---------- 样式文件(供插件导入生成 Effect/Text styles) ----------

// 阴影 CSS → DTCG boxShadow 值(Figma 插件可据此生成 Drop Shadow Effect style)
const SHADOW_RE = /^0 (\d+)px (\d+)px rgba\(0, 0, 0, (0(?:\.\d+)?)\)$/;
function boxShadowValue(css) {
  const m = css.match(SHADOW_RE);
  if (!m) throw new Error(`无法解析阴影: ${css}`);
  const alpha = Math.round(parseFloat(m[3]) * 255);
  return [{
    x: "0px",
    y: `${m[1]}px`,
    blur: `${m[2]}px`,
    spread: "0px",
    color: `#000000${alpha.toString(16).padStart(2, "0").toUpperCase()}`,
    type: "dropShadow",
  }];
}

// 排版样式 → DTCG typography 值(Figma 插件可据此生成 Text style)
const TYPO_LABEL = { display: "展示", heading: "标题", body: "正文", label: "标签", caption: "辅助文字", code: "代码" };
function typographyGroup() {
  const out = {};
  for (const [name, t] of Object.entries(typography)) {
    const sizeVal = dimensions[t.size];
    const px = sizeVal.endsWith("rem") ? remToPx(sizeVal) : parseFloat(sizeVal);
    const family = fontfamilies[t.font].split(",")[0].trim().replace(/^'|'$/g, "");
    const label = Object.entries(TYPO_LABEL).find(([k]) => name.startsWith(k))?.[1] || name;
    out[name] = {
      $type: "typography",
      $value: {
        fontFamily: family,
        fontSize: `${px}px`,
        fontWeight: parseFloat(dimensions[t.weight]),
        lineHeight: t.lineHeight,
        letterSpacing: "0px",
      },
      $description: label,
    };
  }
  return out;
}

// ---------- 输出 ----------

const write = (file, data) => {
  const path = join(HERE, file);
  mkdirSync(HERE, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
};

// 付费版:light / dark 两个文件,拖入同一集合 → 两个模式
const lightFile = { Color: colorGroups(Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, v.light]))), ...commonGroups() };
const darkFile = { Color: colorGroups(Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, v.dark]))), ...commonGroups() };

// 免费版:单文件,浅色 + Dark/ 前缀暗色副本(导入后只有 1 个模式)
const freeFile = structuredClone(lightFile);
freeFile.Color.Dark = colorGroups(Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, v.dark])));

const p1 = write("figma-light.json", lightFile);
const p2 = write("figma-dark.json", darkFile);
const p3 = write("figma-free.json", freeFile);

// 样式文件:阴影为 boxShadow、排版为 typography,供插件生成 Effect/Text styles
const shadowGroup = {};
for (const [name, css] of Object.entries(shadows)) {
  shadowGroup[name] = { $type: "boxShadow", $value: boxShadowValue(css), $description: `阴影;CSS: ${css}` };
}
const stylesFile = {
  Color: colorGroups(Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, v.light]))),
  ...commonGroups(),
  Shadow: shadowGroup,
  Typography: typographyGroup(),
};
const p4 = write("tokens-styles.json", stylesFile);

// ---------- 自检 ----------

const errs = [];
function countTokens(obj) {
  let n = 0;
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object" && "$type" in v) n++;
    else if (v && typeof v === "object") n += countTokens(v);
  }
  return n;
}
function checkFile(label, data) {
  const n = countTokens(data);
  for (const [key, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !("$type" in v) && countTokens(v) === 0) errs.push(`${label}: ${key} 为空组`);
  }
  const walk = (obj, path) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object" && "$type" in v) {
        const t = v.$type;
        if (!["color", "dimension", "number", "string", "fontFamily", "duration", "boxShadow", "typography"].includes(t)) errs.push(`${label}: ${path}/${k} 类型 ${t} 不支持`);
        if (t === "dimension" && v.$value.unit !== "px") errs.push(`${label}: ${path}/${k} 单位非 px`);
        if (t === "duration" && v.$value.unit !== "s") errs.push(`${label}: ${path}/${k} 单位非 s`);
        if (t === "fontFamily" && typeof v.$value !== "string") errs.push(`${label}: ${path}/${k} 字体族非法`);
        if (t === "color" && !Array.isArray(v.$value.components)) errs.push(`${label}: ${path}/${k} 颜色值非法`);
        if (t === "boxShadow" && (!Array.isArray(v.$value) || !v.$value[0].color)) errs.push(`${label}: ${path}/${k} boxShadow 值非法`);
        if (t === "typography" && (!v.$value.fontSize || !v.$value.fontFamily)) errs.push(`${label}: ${path}/${k} typography 值非法`);
      } else if (v && typeof v === "object") {
        walk(v, `${path}/${k}`);
      }
    }
  };
  walk(data, "");
  return n;
}

const n1 = checkFile("light", lightFile);
const n2 = checkFile("dark", darkFile);
const n3 = checkFile("free", freeFile);
const n4 = checkFile("styles", stylesFile);
if (errs.length) {
  console.error("校验失败:\n" + errs.join("\n"));
  process.exit(1);
}

console.log(`已生成(共 ${n1} 个令牌):`);
console.log(`  ${p1} (浅色模式)`);
console.log(`  ${p2} (暗色模式)`);
console.log(`  ${p3} (免费单文件,${n3} 个令牌)`);
console.log(`  ${p4} (样式文件,${n4} 个令牌:boxShadow × ${Object.keys(shadows).length} + typography × ${Object.keys(typography).length})`);
console.log("校验通过");
