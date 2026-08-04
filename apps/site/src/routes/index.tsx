import { createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import { listLatestEpisodes, type EpisodeSummary } from "../lib/db";
import { SiteNav } from "../components/site-nav";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@dailogues/ui/theme.stylex";

// 首页：最新发布的节目（消费端入口）
const styles = stylex.create({
  page: {
    minHeight: "100vh",
    background: tokens.colorBg,
    color: tokens.colorText,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: tokens.space6,
  },
  title: {
    fontSize: tokens.fontSizeXl,
    fontWeight: tokens.fontWeightBold,
    marginBottom: tokens.space5,
  },
  card: {
    display: "block",
    padding: tokens.space4,
    borderRadius: tokens.radiusMd,
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
    marginBottom: tokens.space3,
    textDecoration: "none",
    color: "inherit",
  },
  epTitle: {
    fontWeight: tokens.fontWeightMedium,
    marginBottom: tokens.space1,
  },
  meta: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
  },
  empty: {
    color: tokens.colorTextMuted,
    textAlign: "center",
    padding: tokens.space7,
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
  const episodes = createAsync<EpisodeSummary[]>(() => listLatestEpisodes());

  return (
    <div {...stylex.props(styles.page)}>
      <SiteNav />
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.title)}>最新节目</div>
        <Show
          when={episodes()?.length}
          fallback={<div {...stylex.props(styles.empty)}>还没有已发布的节目</div>}
        >
          <For each={episodes()}>
            {(ep) => (
              <a href={`/episode/${ep.id}`} {...stylex.props(styles.card)}>
                <div {...stylex.props(styles.epTitle)}>{ep.title || "未命名节目"}</div>
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
