import { For, Show, createSignal } from "solid-js";
import { Title } from "@solidjs/meta";
import { env } from "../lib/env";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

// 订阅页（/subscribe）：dailog 单 feed + 各播客平台入口。
// 支持官方添加 URL 的平台（Apple/Overcast/Pocket Casts/Podcast Addict）→ 一键直达（feed 参数）；
// 无公开添加 URL 的平台（Spotify/小宇宙）→ 复制 feed 链接，App 内粘贴导入。
interface Platform {
  name: string;
  icon: string;
  /** 一键导入的目标 URL（feed 参数已内嵌）；null = 仅复制链接手动导入 */
  url: string | null;
}

// 断点标签（与 theme.stylex.ts 的 DESKTOP/TABLET 同值——stylex babel 插件不支持
// 跨文件常量解析，本地定义保持一致；改断点请同步 theme.stylex.ts）
const DESKTOP = "@media (min-width: 1025px)";
const TABLET = "@media (min-width: 640px) and (max-width: 1024px)";

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
  feedBox: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    padding: `${dimensions.spacing3} ${dimensions.spacing4}`,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    marginBottom: dimensions.spacing8,
    flexWrap: "wrap",
  },
  feedLabel: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    flexShrink: 0,
  },
  feedUrl: {
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightMedium,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
    minWidth: 0,
  },
  copyBtn: {
    padding: `${dimensions.spacing1} ${dimensions.spacing4}`,
    borderRadius: dimensions.radiusFull,
    backgroundColor: "transparent",
    color: colors.primaryStrong,
    fontSize: dimensions.fontSizeSm,
    cursor: "pointer",
    flexShrink: 0,
    ":hover": { opacity: 0.8 },
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", // 移动优先
gap: dimensions.spacing4,
[TABLET]: { gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" },
[DESKTOP]: { gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" },
  },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: dimensions.spacing2,
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    textDecoration: "none",
    color: "inherit",
    ":hover": { backgroundColor: colors.surfaceStrong },
  },
  platformName: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightMedium,
  },
  icon: {
    fontSize: "20px",
  },
  hint: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
    lineHeight: 1.5,
  },
  actionBtn: {
    padding: `${dimensions.spacing1} ${dimensions.spacing4}`,
    borderRadius: dimensions.radiusFull,
    backgroundColor: "transparent",
    color: colors.primaryStrong,
    fontSize: dimensions.fontSizeSm,
    cursor: "pointer",
    ":hover": { opacity: 0.8 },
  },
});

export default function SubscribePage() {
  const { t, locale } = useI18n();
  const base = `${env.siteBaseUrl}/feed`;
  // 分语言 feed：跟随界面语言——中文界面展示中文 feed，英文界面展示英文 feed
  // （英文 feed 无内容时服务端 fallback 全量，订阅不中断）
  const feedUrl = () => (locale() === "zh" ? `${base}/zh.xml` : `${base}/en.xml`);
  const [copied, setCopied] = createSignal<string | null>(null);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((v) => (v === key ? null : v)), 2000);
    } catch {
      /* 剪贴板不可用（非安全上下文等）静默 */
    }
  };

  // 平台列表：url = 官方添加 URL（当前语言 feed 参数内嵌）；null = 手动复制导入
  const platforms = (): Platform[] => [
    { name: "Apple Podcasts", icon: "🍎", url: `https://podcasts.apple.com/add?feed=${encodeURIComponent(feedUrl())}` },
    { name: "Overcast", icon: "⚡", url: `https://overcast.fm/podcasts/add?url=${encodeURIComponent(feedUrl())}` },
    { name: "Pocket Casts", icon: "🎧", url: `https://pocketcasts.com/subscribe?feed=${encodeURIComponent(feedUrl())}` },
    { name: "Podcast Addict", icon: "📻", url: `https://podcastaddict.com/add?url=${encodeURIComponent(feedUrl())}` },
    { name: "Spotify", icon: "🟢", url: null },
    { name: "小宇宙", icon: "🌌", url: null },
  ];

  return (
    <div {...stylex.props(layouts.page)}>
      <div {...stylex.props(layouts.containerLg)}>
        <Title>{t("subscribe.title")} · dailog</Title>
        <div {...stylex.props(layouts.fullRow, styles.title)}>{t("subscribe.title")}</div>
        <p {...stylex.props(layouts.fullRow, styles.desc)}>{t("subscribe.desc")}</p>

        <div {...stylex.props(layouts.fullRow, styles.feedBox)}>
          <span {...stylex.props(styles.feedLabel)}>{t("subscribe.feedLabel")}</span>
          <span {...stylex.props(styles.feedUrl)}>{feedUrl()}</span>
          <button type="button" {...stylex.props(styles.copyBtn)} onClick={() => copy(feedUrl(), "feed")}>
            {copied() === "feed" ? t("subscribe.copied") : t("subscribe.copy")}
          </button>
        </div>

        <div {...stylex.props(layouts.fullRow, styles.grid)}>
          <For each={platforms()}>
            {(p) => (
              <div {...stylex.props(styles.card)}>
                <div {...stylex.props(styles.platformName)}>
                  <span {...stylex.props(styles.icon)} aria-hidden="true">{p.icon}</span>
                  {p.name}
                </div>
                <p {...stylex.props(styles.hint)}>{p.url ? t("subscribe.oneClick") : t("subscribe.manual")}</p>
                <Show
                  when={p.url}
                  fallback={
                    <button type="button" {...stylex.props(styles.actionBtn)} onClick={() => copy(feedUrl(), p.name)}>
                      {copied() === p.name ? t("subscribe.copied") : t("subscribe.copy")}
                    </button>
                  }
                >
                  <a href={p.url!} target="_blank" rel="noopener noreferrer" {...stylex.props(styles.actionBtn)}>
                    {p.name} →
                  </a>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
