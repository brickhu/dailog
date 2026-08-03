import { createSignal } from "solid-js";
import { useParams } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex";

// 消费端骨架验证页（Task 2 脚手架 spike；三页/RSS 在后续步骤填充）
const styles = stylex.create({
  page: {
    minHeight: "100vh",
    background: tokens.colorBg,
    color: tokens.colorText,
    fontFamily: "system-ui, -apple-system, sans-serif",
    padding: tokens.space7,
  },
  title: {
    fontSize: tokens.fontSizeXl,
    fontWeight: tokens.fontWeightBold,
    marginBottom: tokens.space3,
  },
  tag: {
    display: "inline-block",
    padding: `${tokens.space1} ${tokens.space3}`,
    borderRadius: tokens.radiusFull,
    background: tokens.colorPrimary,
    color: "#fff",
    fontSize: tokens.fontSizeSm,
  },
});

export default function SkeletonPage() {
  const params = useParams();
  const [count, setCount] = createSignal(0);
  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.title)}>dailogues 消费端 SSR（骨架）</div>
      <div>路由参数：{JSON.stringify(params)}</div>
      <button {...stylex.props(styles.tag)} onClick={() => setCount(count() + 1)}>
        SSR 交互验证：{count()}
      </button>
    </div>
  );
}
