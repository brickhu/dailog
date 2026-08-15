// 图标（内联 SVG，按需注入）：
// - 无 web component（iconify 官方确认 Solid 对 web component 支持弱 + hydration 干扰）
// - 无图标集打包：运行时直接请求 iconify API 的 SVG 端点（{collection}/{name}.svg），
//   按需拉取单个图标；模块级缓存保证同一图标只请求一次
//   （注意：@iconify/utils 的 loadIcon 只处理 customCollections/本地 @iconify-json 包，
//   不访问网络，无图标集时恒返回 undefined，不可用于按需注入）
// - SSR 渲染空占位（客户端 onMount 后加载注入）——SSR/客户端首帧一致，无 hydration 风险
import { createSignal, onMount, type JSX } from "solid-js";

export interface IconProps {
  /** iconify 图标名（如 "mdi:alert"、"mdi-light:alert"） */
  icon: string;
  width?: string | number;
  height?: string | number;
  class?: string;
  style?: JSX.CSSProperties;
}

// 拉取缓存（URL → Promise<SVG 字符串>）；空串（失败）不缓存，允许重试
const cache = new Map<string, Promise<string>>();

function loadIconSvg(icon: string, width?: string | number, height?: string | number): Promise<string> {
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
    // 父级 hydration 完成，SVG 子节点注入会干扰节点匹配（Hydration Mismatch）
    setTimeout(async () => {
      setSvg(await loadIconSvg(props.icon, props.width, props.height));
    }, 0);
  });
  return (
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
  );
}
