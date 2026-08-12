import { createAsync } from "@solidjs/router";
import { For, Show, createSignal } from "solid-js";
import { listLatestEpisodes, type EpisodeSummary } from "../lib/db";
import { episodeCoverUrl } from "../lib/env";
import { SiteNav } from "../components/site-nav";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

// 探索页（PRD §5 /discover）：新 / 热 / 精 / 荐 四个 tab。
// v1（P4 前）：四个 tab 均展示最新节目列表；hot/picked/top 的真实排序与精选池随 P4 接入
const TABS = ["new", "hot", "picked", "top"] as const;
type Tab = (typeof TABS)[number];

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing8,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing4,
  },
  tabs: {
    display: "flex",
    gap: dimensions.spacing2,
    marginBottom: dimensions.spacing6,
    borderBottom: `1px solid ${colors.ink}`,
  },
  tab: {
    padding: `${dimensions.spacing2} ${dimensions.spacing4}`,
    fontSize: dimensions.fontSizeMd,
    color: colors.neutral,
    textDecoration: "none",
    borderBottom: "2px solid transparent",
    cursor: "pointer",
    background: "none",
    borderTop: "none",
    borderLeft: "none",
    borderRight: "none",
  },
  tabActive: {
    color: colors.foreground,
    fontWeight: dimensions.fontWeightMedium,
    borderBottomColor: colors.brand,
  },
  card: {
    display: "block",
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing3,
    textDecoration: "none",
    color: "inherit",
    overflow: "hidden",
  },
  thumb: {
    width: "48px",
    height: "48px",
    borderRadius: dimensions.radiusSm,
    objectFit: "cover",
    float: "left",
    marginRight: dimensions.spacing3,
  },
  epTitle: {
    fontWeight: dimensions.fontWeightMedium,
    marginBottom: dimensions.spacing1,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  langTag: {
    display: "inline-block",
    marginLeft: dimensions.spacing2,
    padding: "1px 6px",
    borderRadius: dimensions.radiusSm,
    border: `1px solid ${colors.ink}`,
    fontSize: "11px",
    lineHeight: 1.4,
  },
  empty: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
});

function fmtDate(d: Date | null): string {
  return d ? new Date(d).toLocaleDateString("zh-CN") : "";
}

function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function DiscoverPage() {
  const { t, locale } = useI18n();
  const [tab, setTab] = createSignal<Tab>("new");
  // 语言偏好分流（同首页）：界面语言即内容偏好，同语言优先 + 时间 fallback
  const episodes = createAsync<EpisodeSummary[]>(() => listLatestEpisodes(50, locale() === "zh" ? "zh" : "en"));

  return (
    <div {...stylex.props(styles.page)}>
      <SiteNav />
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.title)}>{t("discover.title")}</div>
        <div {...stylex.props(styles.tabs)}>
          <For each={TABS}>
            {(key) => (
              <button
                type="button"
                onClick={() => setTab(key)}
                {...stylex.props(styles.tab, tab() === key && styles.tabActive)}
              >
                {t(`discover.${key}` as never)}
              </button>
            )}
          </For>
        </div>
        <Show
          when={episodes()?.length}
          fallback={<div {...stylex.props(styles.empty)}>{t("discover.empty")}</div>}
        >
          <For each={episodes()}>
            {(ep) => (
              <a href={`/episode/${ep.id}`} {...stylex.props(styles.card)}>
                <Show when={episodeCoverUrl(ep.id, ep.coverUrl)}>
                  <img src={episodeCoverUrl(ep.id, ep.coverUrl)!} alt={ep.title || ""} {...stylex.props(styles.thumb)} />
                </Show>
                <div {...stylex.props(styles.epTitle)}>{ep.title || t("common.unnamed")}</div>
                <div {...stylex.props(styles.meta)}>
                  @{ep.username} · {fmtDate(ep.publishedAt)} · {fmtDuration(ep.durationSeconds)}
                  {ep.language ? <span {...stylex.props(styles.langTag)}>{ep.language === "en" ? "EN" : "中"}</span> : null}
                </div>
              </a>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
