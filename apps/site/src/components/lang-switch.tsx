import { Show, createSignal, onCleanup, onMount } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions, shadows } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

// 语言切换：地球 icon 按钮 + 下拉菜单（中文 / English）
// 独立组件——导航/页脚等多处可复用；点击外部自动收起

const styles = stylex.create({
  wrap: {
    position: "relative",
  },
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "34px",
    height: "34px",
    borderRadius: "50%",
    backgroundColor: "transparent",
    color: colors.neutral,
    cursor: "pointer",
    ":hover": { color: colors.foreground, borderColor: colors.neutral },
  },
  menu: {
    position: "absolute",
    right: 0,
    top: "calc(100% + 6px)",
    minWidth: "120px",
    padding: dimensions.spacing1,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    boxShadow: shadows.shadowMed,
    display: "flex",
    flexDirection: "column",
    zIndex: 20,
  },
  item: {
    background: "none",
    border: "none",
    textAlign: "left",
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusSm,
    fontSize: dimensions.fontSizeSm,
    color: colors.foreground,
    cursor: "pointer",
    ":hover": { backgroundColor: colors.surfaceStrong },
  },
  itemActive: {
    fontWeight: dimensions.fontWeightMedium,
  },
});

/** 地球 icon（16px，跟随当前颜色） */
function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" stroke="currentColor" stroke-width="1.6" />
    </svg>
  );
}

export function LangSwitch() {
  const { t, locale, setLocale } = useI18n();
  const [open, setOpen] = createSignal(false);
  let wrapRef: HTMLDivElement | undefined;

  // 点击外部关闭
  const onDocClick = (e: MouseEvent) => {
    if (wrapRef && !wrapRef.contains(e.target as Node)) setOpen(false);
  };
  // 点击外部关闭：注册/清理都收在 onMount 内——SSR 下 onCleanup 顶层执行会访问 document 炸掉
  onMount(() => {
    document.addEventListener("click", onDocClick);
    onCleanup(() => document.removeEventListener("click", onDocClick));
  });

  const pick = (next: "zh" | "en") => {
    setLocale(next);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} {...stylex.props(styles.wrap)}>
      <button
        type="button"
        {...stylex.props(styles.trigger)}
        aria-label={t("nav.language")}
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <GlobeIcon />
      </button>
      <Show when={open()}>
        <div role="menu" {...stylex.props(styles.menu)}>
          <button
            type="button"
            role="menuitem"
            {...stylex.props(styles.item, locale() === "zh" && styles.itemActive)}
            onClick={() => pick("zh")}
          >
            中文
          </button>
          <button
            type="button"
            role="menuitem"
            {...stylex.props(styles.item, locale() === "en" && styles.itemActive)}
            onClick={() => pick("en")}
          >
            English
          </button>
        </div>
      </Show>
    </div>
  );
}
