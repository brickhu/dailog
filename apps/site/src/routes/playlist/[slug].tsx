import { A, cache, createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { getPlaylist, type PlaylistDetail } from "../../lib/db";
import { episodeCoverUrl, playlistCoverUrl } from "../../lib/env";
import { usePlayback, type QueueEpisode } from "../../lib/playback";

// 播放列表详情（/playlist/<slug>）：列表信息 + 有序节目 + 整单连播（setQueue + play）
const getPlaylistCached = cache((slug: string) => getPlaylist(slug), "playlist-detail");

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
  header: {
    display: "flex",
    gap: dimensions.spacing4,
    marginBottom: dimensions.spacing6,
  },
  cover: {
    width: "128px",
    height: "128px",
    borderRadius: dimensions.radiusMd,
    objectFit: "cover",
    flexShrink: 0,
  },
  coverFallback: {
    width: "128px",
    height: "128px",
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.ink,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "40px",
    color: colors.foreground,
    flexShrink: 0,
  },
  info: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
    minWidth: 0,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  desc: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeMd,
    margin: 0,
  },
  playAll: {
    display: "inline-flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    width: "fit-content",
    padding: `${dimensions.spacing2} ${dimensions.spacing5}`,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.brand,
    color: colors.onBrand,
    fontWeight: dimensions.fontWeightMedium,
    border: "none",
    cursor: "pointer",
    fontSize: dimensions.fontSizeMd,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusMd,
    marginBottom: dimensions.spacing2,
    textDecoration: "none",
    color: "inherit",
    backgroundColor: colors.surface,
    ":hover": { borderColor: colors.primary },
  },
  pos: {
    width: "28px",
    textAlign: "center",
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    flexShrink: 0,
  },
  thumb: {
    width: "48px",
    height: "48px",
    borderRadius: dimensions.radiusSm,
    objectFit: "cover",
    flexShrink: 0,
  },
  thumbFallback: {
    width: "48px",
    height: "48px",
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.ink,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "18px",
    color: colors.foreground,
    flexShrink: 0,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowMeta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  play: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: dimensions.spacing1,
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.brand,
    color: colors.onBrand,
    border: "none",
    cursor: "pointer",
    fontSize: dimensions.fontSizeSm,
  },
  notFound: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
  back: {
    display: "inline-block",
    marginBottom: dimensions.spacing4,
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
  },
});

function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function PlaylistPage(props: { params: { slug: string } }) {
  const { t } = useI18n();
  const playback = usePlayback();
  const playlist = createAsync<PlaylistDetail | null>(() => getPlaylistCached(props.params.slug));

  const queue = () => (playlist()?.episodes ?? []) as unknown as QueueEpisode[];

  const playAll = () => {
    const q = queue();
    if (q.length === 0) return;
    playback.setQueue(q);
    playback.play(q[0]);
  };

  const playOne = (ep: QueueEpisode) => {
    const q = queue();
    playback.setQueue(q);
    playback.play(ep);
  };

  return (
    <div {...stylex.props(layouts.page)}>
      <div {...stylex.props(layouts.containerSm)}>
        <A href="/playlists" {...stylex.props(layouts.fullRow, styles.back)}>← {t("playlists.title")}</A>
        <Show
          when={playlist()}
          fallback={<div {...stylex.props(layouts.fullRow, styles.notFound)}>{t("playlist.notFound")}</div>}
        >
          {(pl) => {
            const firstCover = pl().episodes.find((e) => e.coverUrl)?.coverUrl ?? null;
            const firstId = pl().episodes[0]?.id ?? "";
            return (
              <>
                <Title>{pl().title} · dailog</Title>
                <div {...stylex.props(layouts.fullRow, styles.header)}>
                  <Show when={playlistCoverUrl(pl().id, pl().coverUrl, 256) ?? episodeCoverUrl(firstId, firstCover, 256)} fallback={<div {...stylex.props(styles.coverFallback)}>🎧</div>}>
                    {(cover) => <img src={cover()} alt={pl().title} {...stylex.props(styles.cover)} />}
                  </Show>
                  <div {...stylex.props(styles.info)}>
                    <h1 {...stylex.props(styles.title)}>{pl().title}</h1>
                    <p {...stylex.props(styles.meta)}>
                      {t("playlists.episodeCount", { count: pl().episodeCount })}
                      <Show when={pl().updatedAt}> · {t("playlist.updatedAt", { date: new Date(pl().updatedAt!).toLocaleDateString() })}</Show>
                    </p>
                    <Show when={pl().description}>
                      <p {...stylex.props(styles.desc)}>{pl().description}</p>
                    </Show>
                    <button {...stylex.props(styles.playAll)} onClick={playAll}>▶ {t("playlist.playAll")}</button>
                  </div>
                </div>
                <For each={pl().episodes}>
                  {(ep, i) => (
                    <A href={`/episode/${ep.slug}`} {...stylex.props(layouts.fullRow, styles.row)}>
                      <span {...stylex.props(styles.pos)}>{i() + 1}</span>
                      <Show when={episodeCoverUrl(ep.id, ep.coverUrl, 96)} fallback={<div {...stylex.props(styles.thumbFallback)}>🎙️</div>}>
                        {(cover) => <img src={cover()} alt={ep.title ?? ""} {...stylex.props(styles.thumb)} />}
                      </Show>
                      <div {...stylex.props(styles.rowBody)}>
                        <p {...stylex.props(styles.rowTitle)}>{ep.title ?? t("common.unnamed")}</p>
                        <p {...stylex.props(styles.rowMeta)}>{ep.callName ?? ep.displayName ?? ep.username} · {fmtDuration(ep.durationSeconds)}</p>
                      </div>
                      <button
                        {...stylex.props(styles.play)}
                        onClick={(e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); playOne(ep as unknown as QueueEpisode); }}
                      >
                        ▶
                      </button>
                    </A>
                  )}
                </For>
              </>
            );
          }}
        </Show>
      </div>
    </div>
  );
}
