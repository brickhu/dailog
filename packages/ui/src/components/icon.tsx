// 图标（内联 SVG，按需注入）：
// - 无 web component（iconify 官方确认 Solid 对 web component 支持弱 + hydration 干扰）
// - 无图标集打包：运行时直接请求 iconify API 的 SVG 端点（{collection}/{name}.svg），
//   按需拉取单个图标；模块级缓存保证同一图标只请求一次
//   （注意：@iconify/utils 的 loadIcon 只处理 customCollections/本地 @iconify-json 包，
//   不访问网络，无图标集时恒返回 undefined，不可用于按需注入）
// - hydration 安全：SSR/首帧渲染空 span 占位（Show fallback）；注入后整个元素替换
//   （Show 切换），不在原元素上改 innerHTML —— 规避 Solid hydration 对动态 innerHTML
//   属性的节点匹配问题（Button 内嵌 Icon 曾报 Hydration Mismatch）
import { createSignal, onMount, Show, type JSX } from "solid-js";

export interface IconProps {
  /** iconify 图标名（如 "mdi:alert"、"mdi-light:alert"） */
  icon: string;
  width?: string | number;
  height?: string | number;
  class?: string;
  style?: JSX.CSSProperties;
}

// —— 自定义图标注册（addIcon，参考 iconify 的 addIcon API）——
// 外部可注册任意图标（body = SVG 内部内容，如 <path>；fill 用 currentColor 可随
// 文字颜色着色），优先于网络拉取；用法：addIcon("brand:logo", { body: '<path .../>' })
// 后 <Icon icon="brand:logo" /> 直接渲染（无需访问 iconify API）
export interface CustomIconData {
  /** SVG body（不含 <svg> 标签；fill="currentColor" 可继承文字颜色） */
  body: string;
  /** 图标基准宽度（viewBox 基准）@default 24 */
  width?: number;
  /** 图标基准高度（viewBox 基准）@default 24 */
  height?: number;
}

const customIcons = new Map<string, CustomIconData>();

/** 注册自定义图标（模块加载时调用；同名覆盖）：
 *  - addIcon("brand:logo", { body: '<path d="..."/>', width: 24, height: 24 })
 *  - addIcon("brand:logo", '<svg ...>...</svg>')  // 完整 SVG 字符串原样使用
 *  之后 <Icon icon="brand:logo" /> 即可渲染；尺寸默认 1em 继承 font-size，
 *  也可用 Icon 的 width/height 属性（与网络图标一致） */
export function addIcon(name: string, icon: CustomIconData | string): void {
  customIcons.set(name, typeof icon === "string" ? { body: icon } : icon);
}

// 拉取缓存（URL → Promise<SVG 字符串>）；空串（失败）不缓存，允许重试
const cache = new Map<string, Promise<string>>();

function loadIconSvg(icon: string, width?: string | number, height?: string | number): Promise<string> {
  // 自定义图标优先（addIcon 注册，按完整图标名匹配）
  const custom = customIcons.get(icon);
  if (custom) {
    const body = custom.body.trim();
    // 完整 SVG 字符串（以 <svg 开头）原样返回
    if (body.startsWith("<svg")) return Promise.resolve(body);
    const w = custom.width ?? 24;
    const h = custom.height ?? 24;
    return Promise.resolve(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`);
  }
  const idx = icon.indexOf(":");
  if (idx <= 0) return Promise.resolve("");
  const collection = icon.slice(0, idx);
  const name = icon.slice(idx + 1);
  // 尺寸：优先 height（iconify 按高度等比缩放）；都不传则省略（SVG 以 1em 响应，继承 font-size）
  const size =
    height != null
      ? `height=${encodeURIComponent(String(height))}`
      : width != null
        ? `width=${encodeURIComponent(String(width))}`
        : "";
  const url = `https://api.iconify.design/${collection}/${name}.svg${size ? `?${size}` : ""}`;
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => "");
    cache.set(url, p);
    void p.then((v) => {
      if (!v) cache.delete(url); // 拉取失败不缓存，下次再试
    });
  }
  return p;
}

export function Icon(props: IconProps) {
  const [svg, setSvg] = createSignal("");
  onMount(() => {
    // 延迟到 hydration 完全结束后注入：嵌套组件（如 Button 内）中 onMount 可能早于
    // 父级 hydration 完成，SVG 注入会干扰节点匹配（Hydration Mismatch）
    setTimeout(async () => {
      setSvg(await loadIconSvg(props.icon, props.width, props.height));
    }, 0);
  });
  return (
    <Show
      when={svg()}
      fallback={
        <span
          style={{
            display: "inline-block",
            "line-height": 0,
            "font-size": props.width != null ? `${props.width}px` : undefined,
            ...props.style,
          }}
          class={props.class}
        />
      }
    >
      <span
        innerHTML={svg()}
        style={{
          display: "inline-block",
          "line-height": 0,
          "font-size": props.width != null ? `${props.width}px` : undefined,
          ...props.style,
        }}
        class={props.class}
      />
    </Show>
  );
}
