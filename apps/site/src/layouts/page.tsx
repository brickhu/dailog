import { type JSX } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { type StyleXStyles } from "@stylexjs/stylex";

export type Direction = "horizontal" | "vertical"


const styles = stylex.create({
  page: {
    width: "100vw",
    flexShrink: "0", // shellRoot 纵向 flex 容器：内容超高时不被压缩
    display: "flex",
    flexDirection: "column",
    alignItems: "center", // 子项（container*）横向居中；container 自带 margin auto 双保险
  },
})

export function Page(props: {
    children? : JSX.Element,
    xstyle? : StyleXStyles
}){

    const attrs = stylex.props(
        styles.page,
        props.xstyle
    );
    return <div {...attrs}> {props?.children}</div>
}