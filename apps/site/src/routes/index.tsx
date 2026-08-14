import { createSignal, Show, For, onMount } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { usePlayback, type QueueEpisode } from "../lib/playback";
import { env, episodeCoverUrl } from "../lib/env";
import { Faq } from "../components/faq";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

// 首页（传统博客式）：hero 品牌区 + 推荐节目列表。
// 播放由全局播放条（PlayerBar）接管——点卡片播放按钮即入队连播，播完自动切下一期；
// 点卡片进详情页（/<episode_id>）。列表数据 = 推荐队列 API（热度分排序 + 语言优先）。
const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
    paddingBottom: "72px", // 播放条高度预留
  },
  hero: {
    maxWidth: "1080px",
    margin: "0 auto",
    padding: `${dimensions.spacing12} ${dimensions.spacing8} ${dimensions.spacing8}`,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing4,
  },
  tagline: {
    fontSize: dimensions.fontSize4xl,
    fontWeight: dimensions.fontWeightBold,
    lineHeight: 1.25,
    margin: 0,
  },
  what: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeLg,
    lineHeight: 1.6,
    margin: 0,
    maxWidth: "640px",
  },
  ctaHint: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  ctaRow: {
    display: "flex",
    gap: dimensions.spacing3,
    alignItems: "center",
    flexWrap: "wrap",
  },
  cta: {
    display: "inline-block",
    width: "fit-content",
    padding: `${dimensions.spacing3} ${dimensions.spacing6}`,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.brand,
    color: colors.onBrand,
    fontWeight: dimensions.fontWeightMedium,
    textDecoration: "none",
    fontSize: dimensions.fontSizeMd,
  },

  listTitleRow: {
    maxWidth: "1080px",
    margin: "0 auto",
    padding: `${dimensions.spacing8} ${dimensions.spacing8} ${dimensions.spacing4}`,
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    "@media (max-width: 640px)": {
      padding: `${dimensions.spacing6} ${dimensions.spacing4} ${dimensions.spacing3}`,
    },
  },
  listTitle: {
    fontSize: dimensions.fontSizeXl,
    fontWeight: dimensions.fontWeightBold,
  },
  moreLink: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    ":hover": { color: colors.primary },
  },
  list: {
    maxWidth: "1080px",
    margin: "0 auto",
    padding: `0 ${dimensions.spacing8} ${dimensions.spacing12}`,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: dimensions.spacing5,
    "@media (max-width: 640px)": {
      gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
      padding: `0 ${dimensions.spacing4} ${dimensions.spacing8}`,
      gap: dimensions.spacing4,
    },
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    backgroundColor: colors.surface,
    padding: dimensions.spacing3,
    cursor: "pointer",
    ":hover": { borderColor: colors.primary },
  },
  cover: {
    width: "100%",
    aspectRatio: "1 / 1",
    objectFit: "cover",
    borderRadius: dimensions.radiusSm,
  },
  title: {
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  playBtn: {
    alignSelf: "flex-start",
    padding: `${dimensions.spacing1} ${dimensions.spacing4}`,
    borderRadius: dimensions.radiusFull,
    border: `1px solid ${colors.brand}`,
    backgroundColor: "transparent",
    color: colors.brandStrong,
    fontSize: dimensions.fontSizeSm,
    cursor: "pointer",
  },
  playBtnActive: {
    backgroundColor: colors.brand,
    color: colors.onBrand,
  },
  cardActions: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    flexWrap: "wrap",
  },
  playingTime: {
    color: colors.neutral,
    fontSize: "12px",
    fontVariantNumeric: "tabular-nums",
  },
  empty: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
  statCards: {
    maxWidth: "1080px",
    margin: "0 auto",
    padding: `0 ${dimensions.spacing8} ${dimensions.spacing12}`,
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: dimensions.spacing4,
    "@media (max-width: 640px)": {
      gridTemplateColumns: "1fr",
      padding: `0 ${dimensions.spacing4} ${dimensions.spacing8}`,
    },
  },
  statCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: dimensions.spacing2,
    minHeight: "160px",
    padding: dimensions.spacing5,
    borderRadius: dimensions.radiusLg,
    backgroundColor: colors.surface, // 与节目卡片统一灰
    border: `1px solid ${colors.ink}`,
    textDecoration: "none",
    color: "inherit",
    textAlign: "center",
    ":hover": { borderColor: colors.primary },
  },
  statTitle: {
    fontSize: "20px",
    fontWeight: dimensions.fontWeightBold,
    color: colors.foreground,
  },
  statLogo: {
    width: "52px",
    height: "52px",
    borderRadius: "50%",
    objectFit: "cover",
    border: `1px solid ${colors.ink}`,
  },
  statLogoFallback: {
    width: "52px",
    height: "52px",
    borderRadius: "50%",
    backgroundColor: colors.ink,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "22px",
    color: colors.foreground,
  },
  statLogos: {
    display: "flex",
    gap: dimensions.spacing2,
    alignItems: "center",
  },
  statLogoSmall: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    objectFit: "cover",
    border: `1px solid ${colors.ink}`,
  },
  statLogoFallbackSmall: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    backgroundColor: colors.ink,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "16px",
    color: colors.foreground,
  },
  statTags: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: dimensions.spacing2,
  },
  statTag: {
    padding: "2px 10px",
    borderRadius: dimensions.radiusFull,
    backgroundColor: colors.surface, // 与节目卡片同色（surface 底 + ink 描边）
    border: `1px solid ${colors.ink}`,
    fontSize: "13px",
    color: colors.foreground,
  },
  statText: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
});

function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function HomePage() {
  const { t, locale } = useI18n();
  const playback = usePlayback();
  const navigate = useNavigate();
  const [list, setList] = createSignal<QueueEpisode[]>([]);
  const [stats, setStats] = createSignal<{ hostCount: number; guestCount: number; episodeCount: number; topHost: string | null; topHostAvatar: string | null; topTags: string[] } | null>(null);
  const [guestLogos, setGuestLogos] = createSignal<Array<{ name: string; avatar: string | null }>>([]);

  // 拉推荐队列（热度分 + 语言优先）：填充播放器队列 + 首页列表
  onMount(() => {
    const lang = locale() === "en" ? "en" : "zh";
    void fetch(`${env.apiBaseUrlPublic ?? env.apiBaseUrl}/v1/public/episodes/recommended?lang=${lang}&limit=24`)
      .then((r) => (r.ok ? r.json() : null))
      .then((eps: unknown) => {
        if (Array.isArray(eps) && eps.length > 0) {
          setList(eps as QueueEpisode[]);
          // 播放器未激活才初始化队列；已激活（播放中）只刷新列表，不打断播放
          if (!playback.activated()) playback.setQueue(eps as QueueEpisode[]);
        }
      })
      .catch(() => {});
    // 站点头部数据（三个统计卡片）
    void fetch(`${env.apiBaseUrlPublic ?? env.apiBaseUrl}/v1/public/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStats(d))
      .catch(() => {});
    void fetch(`${env.apiBaseUrlPublic ?? env.apiBaseUrl}/v1/public/guests`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => Array.isArray(d) && setGuestLogos(d.slice(0, 4)))
      .catch(() => {});
  });

  const hostName = (ep: QueueEpisode) => ep.callName ?? ep.displayName ?? ep.username;
  // 当前播放中的节目：卡片显示「暂停」+ 已播放时间（进度由全局播放器驱动）
  const isCurrent = (id: string) => playback.current()?.id === id;
  const fmt = (sec: number) => {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div {...stylex.props(styles.page)}>
      <section {...stylex.props(styles.hero)}>
        <h1 {...stylex.props(styles.tagline)}>{t("home.hero.tagline")}</h1>
        <p {...stylex.props(styles.what)}>{t("home.hero.what")}</p>
        <div {...stylex.props(styles.ctaRow)}>
          <A href="/submit" {...stylex.props(styles.cta)}>{t("home.hero.submit")}</A>
        </div>
        <p {...stylex.props(styles.ctaHint)}>{t("home.hero.ctaHint")}</p>
      </section>

      <div {...stylex.props(styles.listTitleRow)}>
        <div {...stylex.props(styles.listTitle)}>{t("home.recommended")}</div>
        <A href="/discover" {...stylex.props(styles.moreLink)}>{t("home.hero.browse")}</A>
      </div>
      <Show
        when={list().length > 0}
        fallback={<div {...stylex.props(styles.empty)}>{t("common.loading")}</div>}
      >
        <div {...stylex.props(styles.list)}>
          <For each={list()}>
            {(ep) => (
              <div {...stylex.props(styles.card)} onClick={() => navigate(`/episode/${ep.slug}`)}>
                <Show when={episodeCoverUrl(ep.id, ep.coverUrl)}>
                  <img src={episodeCoverUrl(ep.id, ep.coverUrl)!} alt={ep.title || ""} {...stylex.props(styles.cover)} />
                </Show>
                <p {...stylex.props(styles.title)}>{ep.title || t("common.unnamed")}</p>
                <p {...stylex.props(styles.meta)}>
                  {hostName(ep)} · {fmtDuration(ep.durationSeconds)}
                </p>
                <div {...stylex.props(styles.cardActions)}>
                  <button
                    {...stylex.props(styles.playBtn, isCurrent(ep.id) && playback.playing() && styles.playBtnActive)}
                    onClick={(e) => { e.stopPropagation(); isCurrent(ep.id) ? playback.toggle() : playback.play(ep); }}
                  >
                    {/* 正在播放 → 暂停（实底高亮）；其余（含当前曲目暂停时）→ 播放（普通样式） */}
                    {isCurrent(ep.id) && playback.playing() ? "⏸" : "▶"}{" "}
                    {isCurrent(ep.id) && playback.playing() ? t("common.pause") : t("common.play")}
                  </button>
                  {/* 正在播放：已播放时间 / 总时长（实时跟随播放器进度）——未播放时所有卡片一致 */}
                  <Show when={isCurrent(ep.id) && playback.playing()}>
                    <span {...stylex.props(styles.playingTime)}>
                      {fmt(playback.progress())} / {fmt(playback.duration())}
                    </span>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* 站点头部统计卡片：主播 / AI 嘉宾 / 访谈期数（等宽等高灰色区块） */}
      <Show when={stats()}>
        <div {...stylex.props(styles.statCards)}>
          <A href="/hosts" {...stylex.props(styles.statCard)}>
            <div {...stylex.props(styles.statTitle)}>{t("home.statHosts", { count: stats()!.hostCount })}</div>
            <Show when={stats()!.topHostAvatar} fallback={<div {...stylex.props(styles.statLogoFallback)}>{stats()!.topHost?.slice(0, 1) || "?"}</div>}>
              <img src={stats()!.topHostAvatar!} alt="" {...stylex.props(styles.statLogo)} />
            </Show>
            <div {...stylex.props(styles.statText)}>{stats()!.topHost || ""}</div>
          </A>
          <A href="/guests" {...stylex.props(styles.statCard)}>
            <div {...stylex.props(styles.statTitle)}>{t("home.statGuests", { count: stats()!.guestCount })}</div>
            <div {...stylex.props(styles.statLogos)}>
              <For each={guestLogos()}>
                {(g) => (
                  <Show when={g.avatar} fallback={<div {...stylex.props(styles.statLogoFallbackSmall)}>{g.name.slice(0, 1)}</div>}>
                    <img src={g.avatar!} alt={g.name} {...stylex.props(styles.statLogoSmall)} />
                  </Show>
                )}
              </For>
            </div>
            <div {...stylex.props(styles.statText)}>{t("home.statGuestsSub")}</div>
          </A>
          <A href="/discover" {...stylex.props(styles.statCard)}>
            <div {...stylex.props(styles.statTitle)}>{t("home.statEpisodes", { count: stats()!.episodeCount })}</div>
            <div {...stylex.props(styles.statTags)}>
              <For each={stats()!.topTags}>
                {(tag) => <span {...stylex.props(styles.statTag)}>{tag}</span>}
              </For>
            </div>
            <div {...stylex.props(styles.statText)}>{t("home.statEpisodesSub")}</div>
          </A>
        </div>
      </Show>

      {/* 常见问题（互斥手风琴，双语跟随语言切换） */}
      <Faq />
    </div>
  );
}
