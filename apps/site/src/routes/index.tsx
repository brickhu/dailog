import { createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import { listLatestEpisodes, type EpisodeSummary } from "../lib/db";
import { SiteNav } from "../components/site-nav";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

// 首页：最新发布的节目（消费端入口）
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
    marginBottom: dimensions.spacing6,
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
  },
  epTitle: {
    fontWeight: dimensions.fontWeightMedium,
    marginBottom: dimensions.spacing1,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
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

export default function Home() {
  const { t } = useI18n();
  const episodes = createAsync<EpisodeSummary[]>(() => listLatestEpisodes());

  return (
    <div {...stylex.props(styles.page)}>
      <SiteNav />
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.title)}>{t("home.latest")}</div>
        <Show
          when={episodes()?.length}
          fallback={<div {...stylex.props(styles.empty)}>{t("home.empty")}</div>}
        >
          <For each={episodes()}>
            {(ep) => (
              <a href={`/episode/${ep.id}`} {...stylex.props(styles.card)}>
                <div {...stylex.props(styles.epTitle)}>{ep.title || t("common.unnamed")}</div>
                <div {...stylex.props(styles.meta)}>
                  @{ep.username} · {fmtDate(ep.publishedAt)} · {fmtDuration(ep.durationSeconds)}
                </div>
              </a>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
