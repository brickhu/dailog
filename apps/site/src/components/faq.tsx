import { createSignal, For, Show } from "solid-js";
import { Icon } from "@dailogues/ui";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

// 首页常见问题：互斥手风琴（单开，点击切换）。文案走 i18n（中英），跟随语言切换。
const styles = stylex.create({
  wrap: {
    maxWidth: "1080px",
    margin: "0 auto",
    padding: `0 ${dimensions.spacing8} ${dimensions.spacing12}`,
    "@media (max-width: 640px)": {
      padding: `0 ${dimensions.spacing4} ${dimensions.spacing8}`,
    },
  },
  title: {
    fontSize: dimensions.fontSizeXl,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing4,
  },
  item: {
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    marginBottom: dimensions.spacing3,
  },
  qBtn: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dimensions.spacing3,
    padding: `${dimensions.spacing3} ${dimensions.spacing4}`,
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightMedium,
    color: colors.foreground,
    borderRadius: dimensions.radiusMd, // hover 高亮块圆角与卡片默认态一致
    ":hover": { backgroundColor: colors.surfaceStrong },
  },
  indicator: {
    display: "inline-flex",
    color: colors.neutral,
    flexShrink: 0,
    transition: "transform 0.2s ease",
  },
  indicatorOpen: {
    transform: "rotate(180deg)",
  },
  answer: {
    margin: 0,
    padding: `0 ${dimensions.spacing4} ${dimensions.spacing3}`,
    color: colors.neutral,
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.7,
  },
  quote: {
    margin: `${dimensions.spacing8} 0 0`,
    textAlign: "center",
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightMedium,
    color: colors.neutralWeak, // 引用文字用浅灰
    lineHeight: 1.5,
  },
  quoteAuthor: {
    margin: `${dimensions.spacing2} 0 0`,
    textAlign: "center",
    fontSize: dimensions.fontSizeSm,
    color: colors.neutralWeak,
  },
});

export function Faq() {
  const { t } = useI18n();
  // 当前展开项索引（互斥单开）；默认全部收起
  const [open, setOpen] = createSignal<number | null>(null);
  const items = () => [
    { q: t("home.faq.q1"), a: t("home.faq.a1") },
    { q: t("home.faq.q2"), a: t("home.faq.a2") },
    { q: t("home.faq.q3"), a: t("home.faq.a3") },
    { q: t("home.faq.q4"), a: t("home.faq.a4") },
    { q: t("home.faq.q5"), a: t("home.faq.a5") },
    { q: t("home.faq.q6"), a: t("home.faq.a6") },
  ];

  return (
    <section {...stylex.props(styles.wrap)}>
      <div {...stylex.props(styles.title)}>{t("home.faq.title")}</div>
      <For each={items()}>
        {(item, i) => {
          const isOpen = () => open() === i();
          return (
            <div {...stylex.props(styles.item)}>
              <button
                type="button"
                aria-expanded={isOpen()}
                aria-controls={`faq-answer-${i()}`}
                {...stylex.props(styles.qBtn)}
                onClick={() => setOpen(isOpen() ? null : i())}
              >
                <span>{item.q}</span>
                <span {...stylex.props(styles.indicator, isOpen() && styles.indicatorOpen)} aria-hidden="true">
                  <Icon icon="mdi:chevron-down" width={20} />
                </span>
              </button>
              <Show when={isOpen()}>
                <p id={`faq-answer-${i()}`} {...stylex.props(styles.answer)}>{item.a}</p>
              </Show>
            </div>
          );
        }}
      </For>
      {/* 底部品牌金句：大字号居中 + 署名 */}
      <p {...stylex.props(styles.quote)}>{t("home.faq.quote")}</p>
      <p {...stylex.props(styles.quoteAuthor)}>— {t("home.faq.quoteAuthor")}</p>
    </section>
  );
}
