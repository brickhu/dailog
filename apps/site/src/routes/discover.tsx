import { A, cache, createAsync } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import { listLatestEpisodes, listPublicPlaylists, type EpisodeSummary, type PlaylistSummary } from "../lib/db";
import { fmtDate, fmtDuration } from "../lib/format";
import { episodeCoverUrl, playlistCoverUrl } from "../lib/env";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { ListSkeleton } from "../components/page-skeletons";

// 探索页（PRD §5 /discover）：新 / 热 / 精 / 荐 四个 tab。
// v1（P4 前）：四个 tab 均展示最新节目列表；hot/picked/top 的真实排序与精选池随 P4 接入
const TABS = ["new", "hot", "picked", "top", "lists"] as const;
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
    fontSize: "11px",
    lineHeight: 1.4,
  },
  empty: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
});

export default function DiscoverPage() {
  const { t, locale } = useI18n();
  const [tab, setTab] = createSignal<Tab>("new");
  // 语言偏好分流（同首页）：界面语言即内容偏好，同语言优先 + 时间 fallback
  // cache：客户端导航间复用（公开数据无新鲜度问题），减少重复 DB 查询
  const getLatestCached = cache((lang: "zh" | "en") => listLatestEpisodes(50, lang), "discover-latest");
  const episodes = createAsync<EpisodeSummary[]>(() => getLatestCached(locale() === "zh" ? "zh" : "en"));
  // 「列表」tab：平台策展播放列表（语言偏好 = 界面语言；客户端导航间缓存）
  const getListsCached = cache((lang: "zh" | "en") => listPublicPlaylists(50, lang), "discover-lists");
  const lists = createAsync<PlaylistSummary[]>(() => getListsCached(locale() === "en" ? "en" : "zh"));

  return (
    <div {...stylex.props(layouts.page)}>
      <div {...stylex.props(layouts.containerSm)}>
        <div {...stylex.props(layouts.fullRow, styles.title)}>{t("discover.title")}</div>
        <div {...stylex.props(layouts.fullRow, styles.tabs)}>
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
        <div {...stylex.props(layouts.fullRow)}>
        <Show when={tab() !== "lists"}>
          <Suspense fallback={<ListSkeleton />}>
          <Show
            when={episodes()?.length}
            fallback={<div {...stylex.props(styles.empty)}>{t("discover.empty")}</div>}
          >
            <For each={episodes()}>
              {(ep) => (
                <A  href={`/episode/${ep.slug}`} {...stylex.props(styles.card)}>
                  <Show when={episodeCoverUrl(ep.id, ep.coverUrl)}>
                    <img src={episodeCoverUrl(ep.id, ep.coverUrl)!} alt={ep.title || ""} {...stylex.props(styles.thumb)} />
                  </Show>
                  <div {...stylex.props(styles.epTitle)}>{ep.title || t("common.unnamed")}</div>
                  <div {...stylex.props(styles.meta)}>
                    @{ep.username} · {fmtDate(ep.publishedAt)} · {fmtDuration(ep.durationSeconds)}
                    {ep.language ? <span {...stylex.props(styles.langTag)}>{ep.language === "en" ? "EN" : "中"}</span> : null}
                  </div>
                </A>
              )}
            </For>
          </Show>
          </Suspense>
        </Show>
        <Show when={tab() === "lists"}>
          <Suspense fallback={<ListSkeleton />}>
            <Show
              when={lists() && lists()!.length > 0}
              fallback={<div {...stylex.props(styles.empty)}>{t("playlists.empty")}</div>}
            >
              <For each={lists()}>
                {(pl: PlaylistSummary) => (
                  <A href={`/playlist/${pl.slug}`} {...stylex.props(styles.card)}>
                    <Show when={playlistCoverUrl(pl.id, pl.coverUrl, 96) ?? episodeCoverUrl(pl.firstEpisodeId ?? "", pl.firstCover, 96)}>
                      <img src={playlistCoverUrl(pl.id, pl.coverUrl, 96) ?? episodeCoverUrl(pl.firstEpisodeId ?? "", pl.firstCover, 96)!} alt={pl.title} {...stylex.props(styles.thumb)} />
                    </Show>
                    <div {...stylex.props(styles.epTitle)}>{pl.title}</div>
                    <div {...stylex.props(styles.meta)}>{t("playlists.episodeCount", { count: pl.episodeCount })}</div>
                  </A>
                )}
              </For>
            </Show>
          </Suspense>
        </Show>
        </div>
      </div>
    </div>
  );
}
