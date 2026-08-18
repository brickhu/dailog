import { A, cache, createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { listPublicPlaylists, type PlaylistSummary } from "../lib/db";
import { episodeCoverUrl, playlistCoverUrl } from "../lib/env";

// 播放列表索引（/playlists）：平台策展列表（语言偏好优先 + 精选优先）——封面自动取首期节目封面
const getPlaylists = cache((lang: "zh" | "en") => listPublicPlaylists(30, lang), "playlists-index");

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
    paddingBottom: "72px", // 播放条高度预留
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing1,
  },
  subtitle: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: "0 0 24px",
  },
  card: {
    display: "flex",
    gap: dimensions.spacing4,
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    marginBottom: dimensions.spacing3,
    textDecoration: "none",
    color: "inherit",
    ":hover": { borderColor: colors.primary },
  },
  cover: {
    width: "96px",
    height: "96px",
    borderRadius: dimensions.radiusSm,
    objectFit: "cover",
    flexShrink: 0,
  },
  coverFallback: {
    width: "96px",
    height: "96px",
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.ink,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "28px",
    color: colors.foreground,
    flexShrink: 0,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: dimensions.fontSizeLg,
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  desc: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  },
  empty: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
});

export default function PlaylistsPage() {
  const { t, locale } = useI18n();
  const playlists = createAsync<PlaylistSummary[]>(() => getPlaylists(locale() === "en" ? "en" : "zh"));

  return (
    <div {...stylex.props(layouts.page)}>
      <div {...stylex.props(layouts.containerSm)}>
        <Title>{t("playlists.title")} · dailog</Title>
        <div {...stylex.props(layouts.fullRow, styles.title)}>{t("playlists.title")}</div>
        <p {...stylex.props(layouts.fullRow, styles.subtitle)}>{t("playlists.desc")}</p>
        <Show
          when={playlists() && playlists()!.length > 0}
          fallback={<div {...stylex.props(layouts.fullRow, styles.empty)}>{t("playlists.empty")}</div>}
        >
          <For each={playlists()}>
            {(pl: PlaylistSummary) => (
              <A href={`/playlist/${pl.slug}`} {...stylex.props(layouts.fullRow, styles.card)}>
                <Show when={playlistCoverUrl(pl.id, pl.coverUrl, 192) ?? episodeCoverUrl(pl.firstEpisodeId ?? "", pl.firstCover, 192)} fallback={<div {...stylex.props(styles.coverFallback)}>🎧</div>}>
                  {(cover) => <img src={cover()} alt={pl.title} {...stylex.props(styles.cover)} />}
                </Show>
                <div {...stylex.props(styles.body)}>
                  <h3 {...stylex.props(styles.cardTitle)}>{pl.title}</h3>
                  <p {...stylex.props(styles.meta)}>{t("playlists.episodeCount", { count: pl.episodeCount })}</p>
                  <Show when={pl.description}>
                    <p {...stylex.props(styles.desc)}>{pl.description}</p>
                  </Show>
                </div>
              </A>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
