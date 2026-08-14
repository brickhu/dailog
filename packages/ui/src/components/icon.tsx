// 图标（iconify web component 封装）：
// @iconify-icon/solid 3.0.3 的 Icon 组件把属性同时用 attr: 前缀与 {...props} 展开
// → SSR 输出重复属性（icon=... width=... icon=...）→ Hydration Mismatch。
// 这里直接用原生 <iconify-icon> 标签（属性单次渲染），注册由 iconify-icon 副作用完成。
import "iconify-icon";
import type { JSX } from "solid-js";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "iconify-icon": {
        icon?: string;
        width?: string | number;
        height?: string | number;
        mode?: string;
        inline?: boolean;
        rotate?: number | string;
        flip?: string;
        class?: string;
        style?: JSX.CSSProperties;
        // attr: 命名空间属性（Solid 对自定义元素的属性设置语法）
        [key: `attr:${string}`]: unknown;
      };
    }
  }
}

export interface IconProps {
  icon: string;
  width?: string | number;
  height?: string | number;
  mode?: "style" | "bg" | "mask";
  inline?: boolean;
  rotate?: number | string;
  flip?: "horizontal" | "vertical" | "both";
  class?: string;
  style?: JSX.CSSProperties;
}

export function Icon(props: IconProps) {
  return (
    <iconify-icon
      attr:icon={props.icon}
      attr:width={props.width}
      attr:height={props.height}
      attr:mode={props.mode}
      attr:inline={props.inline}
      attr:rotate={props.rotate}
      attr:flip={props.flip}
      class={props.class}
      style={props.style}
    />
  );
}
