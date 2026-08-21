import { type JSX } from "solid-js";
import * as stylex from "@stylexjs/stylex";

// 断点常量本地定义（stylex babel 插件不支持跨文件常量解析，值同 theme.stylex.const）
const TABLET = "@media (min-width: 640px) and (max-width: 1024px)";
const DESKTOP = "@media (min-width: 1025px)";

// 页面内容容器：限宽 1128px 居中 + 左右留白 + 断点列数（手机 4 / 平板 8 / 桌面 12）——
// 直接写 CSS（不再依赖 Grid 组件）
const styles = stylex.create({
  container: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)", // 手机（移动优先默认）
    [TABLET]: { gridTemplateColumns: "repeat(8, 1fr)" },
    [DESKTOP]: { gridTemplateColumns: "repeat(12, 1fr)" },
    width: "100%",
    maxWidth: 1128, // px
    margin: "0 auto",
    boxSizing: "border-box",
    paddingInline: 16, // 左右留白
    rowGap: 16,
    columnGap: 16,
    gridAutoRows: "minmax(16px, auto)",
  },
});

/** 页面内容容器：断点列数（手机 4 / 平板 8 / 桌面 12）+ 限宽 1128 居中 + 左右留白 */
export function Container(props: { children?: JSX.Element }) {
  return <div {...stylex.props(styles.container)}>{props.children}</div>;
}