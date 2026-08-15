// 图标（内联 SVG，按需注入）：
// - 无 web component（iconify 官方确认 Solid 对 web component 支持弱 + hydration 干扰）
// - 无图标集打包：@iconify/utils 的 loadIcon 运行时从 iconify API 按需拉取单个图标
// - SSR 渲染空占位（客户端 onMount 后加载注入）——SSR/客户端首帧一致，无 hydration 风险
import { loadIcon } from "@iconify/utils";
import { createSignal, onMount, type JSX } from "solid-js";

export interface IconProps {
  /** iconify 图标名（如 "mdi:alert"、"mdi-light:alert"） */
  icon: string;
  width?: string | number;
  height?: string | number;
  class?: string;
  style?: JSX.CSSProperties;
}

export function Icon(props: IconProps) {
  const [svg, setSvg] = createSignal("");
  onMount(() => {
    // 延迟到 hydration 完全结束后注入：嵌套组件（如 Button 内）中 onMount 可能早于
    // 父级 hydration 完成，SVG 子节点注入会干扰节点匹配（Hydration Mismatch）
    setTimeout(async () => {
      const idx = props.icon.indexOf(":");
      if (idx <= 0) return;
      const collection = props.icon.slice(0, idx);
      const name = props.icon.slice(idx + 1);
      setSvg((await loadIcon(collection, name).catch(() => undefined)) ?? "");
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
