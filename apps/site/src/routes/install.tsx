import { Show, createSignal, onMount } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { canInstall, isInstalled, isSafariIOS, requestInstall } from "../lib/install-store";

// 安装引导页（/install，footer「安装 App」入口）：
//  - Chrome/Edge/Android：beforeinstallprompt 已捕获（AppShell 全局）→ 一键安装按钮
//  - iOS Safari：无网页安装事件 → 手动「添加到主屏幕」三步引导
//  - 其他浏览器/事件未触发：菜单安装兜底说明
// mounted 门控：安装状态只在客户端可知，初始渲染保持与 SSR 一致避免 hydration 错位
const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
    paddingBottom: "72px", // 播放条高度预留
  },
  content: {
    maxWidth: "1080px",
    margin: "0 auto",
    padding: dimensions.spacing8,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    margin: "0 0 4px",
  },
  desc: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: "0 0 24px",
    maxWidth: "640px",
    lineHeight: 1.6,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: dimensions.spacing3,
    padding: dimensions.spacing6,
    borderRadius: dimensions.radiusLg,
    backgroundColor: colors.surface,
    maxWidth: "560px",
  },
  ctaDesc: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
    lineHeight: 1.6,
  },
  ok: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightSemiBold,
  },
  steps: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  step: {
    display: "flex",
    alignItems: "flex-start",
    gap: dimensions.spacing3,
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.6,
  },
  stepNum: {
    flexShrink: 0,
    width: "24px",
    height: "24px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    backgroundColor: colors.primaryWeak,
    color: colors.onPrimaryWeak,
    fontSize: dimensions.fontSizeSm,
    fontWeight: dimensions.fontWeightSemiBold,
  },
});

export default function InstallPage() {
  const { t } = useI18n();
  const [mounted, setMounted] = createSignal(false);
  onMount(() => setMounted(true));

  const installed = () => mounted() && isInstalled();
  const oneTap = () => mounted() && !isInstalled() && canInstall();
  const ios = () => mounted() && !isInstalled() && !canInstall() && isSafariIOS();
  const fallback = () => mounted() && !isInstalled() && !canInstall() && !isSafariIOS();

  return (
    <div {...stylex.props(styles.page)}>
      <Title>{t("install.title")}</Title>
      <div {...stylex.props(styles.content)}>
        <h1 {...stylex.props(styles.title)}>{t("install.title")}</h1>
        <p {...stylex.props(styles.desc)}>{t("install.desc")}</p>

        {/* 已安装 */}
        <Show when={installed()}>
          <div {...stylex.props(styles.card)}>
            <div {...stylex.props(styles.ok)}>✓ {t("install.installed")}</div>
            <p {...stylex.props(styles.ctaDesc)}>{t("install.installedDesc")}</p>
          </div>
        </Show>

        {/* 一键安装（Chrome/Edge/Android） */}
        <Show when={oneTap()}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.ctaDesc)}>{t("install.ctaDesc")}</p>
            <Button
              variant="primary"
              label={t("install.cta")}
              clickAction={() => {
                void requestInstall();
              }}
            />
          </div>
        </Show>

        {/* iOS Safari 手动添加 */}
        <Show when={ios()}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.ctaDesc)}>{t("install.iosHint")}</p>
            <ol {...stylex.props(styles.steps)}>
              <li {...stylex.props(styles.step)}>
                <span {...stylex.props(styles.stepNum)}>1</span>
                <span>{t("install.iosStep1")}</span>
              </li>
              <li {...stylex.props(styles.step)}>
                <span {...stylex.props(styles.stepNum)}>2</span>
                <span>{t("install.iosStep2")}</span>
              </li>
              <li {...stylex.props(styles.step)}>
                <span {...stylex.props(styles.stepNum)}>3</span>
                <span>{t("install.iosStep3")}</span>
              </li>
            </ol>
          </div>
        </Show>

        {/* 其他浏览器兜底 */}
        <Show when={fallback()}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.ctaDesc)}>{t("install.fallbackDesc")}</p>
          </div>
        </Show>
      </div>
    </div>
  );
}
