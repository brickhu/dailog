import { type JSX } from "solid-js";
import { constants } from "@dailogues/ui/theme.stylex";
import { Grid } from "@dailogues/ui";

/**
 * 页面内容容器：断点列数（手机 4 / 平板 8 / 桌面 12）+ 居中限宽 1128px + 左右留白。
 * 注意：
 * - width 必须显式 100%（父级 layouts.page 是 flex + align-items:center，auto 会 shrink-wrap 收窄到内容宽）
 * - columns 与 minColWidth 二选一：同时传时 columns 优先（minColWidth 被忽略）
 */
export function GridContainerLg(props: { children?: JSX.Element }) {
  return (
    <Grid
      columns={{ base: 4, [constants.TABLET]: 8, [constants.DESKTOP]: 12 }}
      minRowHeight={16}
      width="100%"
      maxWidth={1128}
      gap={4}
      paddingX={4}
    >
      {props.children}
    </Grid>
  );
}

