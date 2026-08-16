// 组件示例页（仅本地开发）：渲染 packages/ui 的完整组件展示（Examples）。
// 生产构建 import.meta.env.DEV=false → 不输出任何内容。
import { Examples } from "@dailogues/ui";
import { layouts } from "@dailogues/ui/theme.stylex";
import * as stylex from "@stylexjs/stylex";

export default function Example() {
  if (!import.meta.env.DEV) return null;
  return (
    <div {...stylex.props(layouts.page)}>
      <div {...stylex.props(layouts.containerFull)}>
      <Examples />
      </div>
    </div>
  );
}
