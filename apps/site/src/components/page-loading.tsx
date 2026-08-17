// 页面级加载占位（数据区 <Suspense fallback> 统一使用）：居中 spinner + 可选文案。
// 路由过渡不再做全局骨架屏——目标页壳立即渲染，异步数据由各页内部 Suspense 的
// fallback 处理；有骨架配置的页面（列表/详情）沿用 page-skeletons，其余先用
// spinner（需要结构化占位时可自行替换为骨架）。
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Spinner } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";

const styles = stylex.create({
  loading: {
    minHeight: "40vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: dimensions.spacing3,
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
});

/** 页面数据加载占位：居中 spinner（默认带"加载中…"文案，可覆盖 label） */
export function PageSpinner(props: { label?: string } = {}) {
  const { t } = useI18n();
  return (
    <div {...stylex.props(styles.loading)}>
      <Spinner size={28} />
      <span>{props.label ?? t("common.loading")}</span>
    </div>
  );
}
