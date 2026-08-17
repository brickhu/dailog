import { type JSX } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors } from "@dailogues/ui/theme.stylex";

const styles = stylex.create({
  // 品牌色填充：直接引用主题 brand token（跟随浅/暗自动切换）。
  // 不做外部覆盖——stylex 原子类按类名排序，CSS 变量类覆盖不可靠；
  // 如需不同品牌色场景，走内联 style（--logo-brand）由调用方自行处理
  fillBrand: {
    fill: colors.brand,
  },
})



const FullLogo = (props: { style?: JSX.CSSProperties; class?: string }) => {
    return(
        <svg
          viewBox="0 0 288 104"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={props.style}
          class={props.class}
        >
            <path d="M52 32H28V64H52V72H20V24H52V32Z" fill="currentColor"/>
            <path d="M60 64H52V32H60V64Z" fill="currentColor"/>
            <path d="M212 72H188V64H212V72Z" fill="currentColor"/>
            <path d="M188 64H180V32H188V64Z" fill="currentColor"/>
            <path d="M220 64H212V32H220V64Z" fill="currentColor"/>
            <path d="M212 32H188V24H212V32Z" fill="currentColor"/>
            <path d="M260 72H236V64H260V72Z" fill="currentColor"/>
            <path d="M236 64H228V32H236V64Z" fill="currentColor"/>
            <path d="M268 48V64H260V56H252V48H268Z" fill="currentColor"/>
            <path d="M268 40H260V32H268V40Z" fill="currentColor"/>
            <path d="M260 32H236V24H260V32Z" fill="currentColor"/>
            <path d="M128 72H120V24H128V72Z" {...stylex.props(styles.fillBrand)} />
            <path d="M148 64H172V72H140V24H148V64Z" fill="currentColor"/>
            <path d="M76 48H100V32H108V72H100V56H76V72H68V32H76V48Z" {...stylex.props(styles.fillBrand)}/>
            <path d="M100 32H76V24H100V32Z" {...stylex.props(styles.fillBrand)}/>
            <path d="M116 96H108L100 88H68V80H104L112 88L120 80H128V88H124L116 96Z" {...stylex.props(styles.fillBrand)}/>
        </svg>
    )
}
const Pattern = (props: { style?: JSX.CSSProperties; class?: string }) => {
    return(
        <svg
          viewBox="0 0 104 104"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={props.style}
          class={props.class}
        >
            <path d="M66 80L74 72H82V80H78L70 88H62L54 80H22V72H58L66 80ZM30 40H54V24H62V64H54V48H30V64H22V24H30V40ZM82 64H74V16H82V64ZM54 24H30V16H54V24Z" fill="currentColor"/>
        </svg>

    )
}


export function Logo(props: {
  /** logo 款式 */
  variant?: "full" | "pattern";
  style?: JSX.CSSProperties;
  class?: string;
  /** stylex.props(...) 展开时返回 className——兼容透传（site-nav 用 stylex 类控制尺寸） */
  className?: string;
}) {
  // 外部尺寸样式（stylex 类或内联 style）透传到 svg——否则 svg 无尺寸约束渲染异常
  const svgClass = props.className ?? props.class;
  return props.variant === "pattern" ? (
    <Pattern style={props.style} class={svgClass} />
  ) : (
    <FullLogo style={props.style} class={svgClass} />
  );
}