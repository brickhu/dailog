import { type JSX } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { type StyleXStyles } from "@stylexjs/stylex";

export type Direction = "horizontal" | "vertical"


const styles = stylex.create({
    base: {
        width: "100%",
        height: "100%",
        display : "flex",
        justifyContent : "center",
        alignItems: "center"
    },
    horizontal: {
        flexDirection: "row",
    },
    vertical: {
        flexDirection: "column"
    }
})

export function Centered(props: {
    children? : JSX.Element,
    direction? : Direction,
    xstyle? : StyleXStyles
}){
    // StyleX 编译红线：stylex.props 条件必须是直接引用 props 的裸调用表达式
    // （禁本地 const + 动态索引 styles[DIRECTION]——编译期会静默丢弃未被
    // 静态引用的样式，styles.horizontal/vertical 变成 undefined，direction 永不生效）
    const isDirection = (d: Direction) => (props.direction ?? "vertical") === d;
    const attrs = stylex.props(
        styles.base,
        isDirection("horizontal") && styles.horizontal,
        isDirection("vertical") && styles.vertical,
        props.xstyle
    );
    return <div {...attrs}> {props?.children}</div>
}