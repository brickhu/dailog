import { createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import { listLatestEpisodes, type EpisodeSummary } from "../lib/db";
import { SiteNav } from "../components/site-nav";
import { env, episodeCoverUrl } from "../lib/env";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

// 首页：landing 首屏（左：tagline + what it is + 立即投稿 CTA；右：精选节目播放器）
// 播放器过渡期取最新已发布节目（is_picked 精选随编辑端上线后切换，refactor-assessment P2/P3）
const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: dimensions.spacing8,
    alignItems: "center",
    maxWidth: "1080px",
    margin: "0 auto",
    padding: `${dimensions.spacing12} ${dimensions.spacing8} ${dimensions.spacing12}`,
  },
  heroLeft: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing4,
  },
  tagline: {
    fontSize: dimensions.fontSize3xl,
    fontWeight: dimensions.fontWeightBold,
    lineHeight: 1.25,
    margin: 0,
  },
  what: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeLg,
    lineHeight: 1.6,
    margin: 0,
  },
  ctaHint: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
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
    fontSize: dimensions.fontSizeLg,
  },
  ctaGhost: {
    display: "inline-block",
    width: "fit-content",
    padding: `${dimensions.spacing3} ${dimensions.spacing6}`,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    color: colors.foreground,
    fontWeight: dimensions.fontWeightMedium,
    textDecoration: "none",
    fontSize: dimensions.fontSizeLg,
  },
  ctaRow: {
    display: "flex",
    gap: dimensions.spacing3,
    alignItems: "center",
    flexWrap: "wrap",
  },
  cover: {
    width: "100%",
    borderRadius: dimensions.radiusMd,
    aspectRatio: "1 / 1",
    objectFit: "cover",
  },
  thumb: {
    width: "48px",
    height: "48px",
    borderRadius: dimensions.radiusSm,
    objectFit: "cover",
    float: "left",
    marginRight: dimensions.spacing3,
  },
  playerCard: {
    borderRadius: dimensions.radiusLg,
    border: `1px solid ${colors.ink}`,
    backgroundColor: colors.surface,
    padding: dimensions.spacing5,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
  },
  playerTitle: {
    fontSize: dimensions.fontSizeLg,
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
  },
  playerEpTitle: {
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
  },
  playerMeta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  audio: {
    width: "100%",
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

export default function Home() {
  const { t, locale } = useI18n();
  // 语言偏好分流：界面语言即内容偏好（中文界面 → 中文节目优先，不足时 fallback 其他语言）
  const episodes = createAsync<EpisodeSummary[]>(() => listLatestEpisodes(20, locale() === "zh" ? "zh" : "en"));
  const featured = () => episodes()?.[0] ?? null;
  const audioUrl = () => {
    const ep = featured();
    return ep ? `${env.apiBaseUrlPublic ?? env.apiBaseUrl}/v1/public/episodes/${ep.id}/audio` : null;
  };

  return (
    <div {...stylex.props(styles.page)}>
      <SiteNav />
      <section {...stylex.props(styles.hero)}>
        <div {...stylex.props(styles.heroLeft)}>
          <h1 {...stylex.props(styles.tagline)}>{t("home.hero.tagline")}</h1>
          <p {...stylex.props(styles.what)}>{t("home.hero.what")}</p>
          <p {...stylex.props(styles.ctaHint)}>{t("home.hero.ctaHint")}</p>
          <div {...stylex.props(styles.ctaRow)}>
            <a href="/submit" {...stylex.props(styles.cta)}>{t("home.hero.submit")}</a>
            <a href="/discover" {...stylex.props(styles.ctaGhost)}>{t("home.hero.browse")}</a>
          </div>
        </div>
        <div {...stylex.props(styles.playerCard)}>
          <div {...stylex.props(styles.playerTitle)}>{t("home.hero.playerTitle")}</div>
          <Show
            when={featured()}
            fallback={<div {...stylex.props(styles.empty)}>{t("home.hero.playerFallback")}</div>}
          >
            <Show when={episodeCoverUrl(featured()!.id, featured()!.coverUrl)}>
              <img
                src={episodeCoverUrl(featured()!.id, featured()!.coverUrl)!}
                alt={featured()!.title || ""}
                {...stylex.props(styles.cover)}
              />
            </Show>
            <div {...stylex.props(styles.playerEpTitle)}>{featured()!.title || t("common.unnamed")}</div>
            <div {...stylex.props(styles.playerMeta)}>
              @{featured()!.username} · {fmtDate(featured()!.publishedAt)} · {fmtDuration(featured()!.durationSeconds)}
            </div>
            <Show when={audioUrl()}>
              <audio controls src={audioUrl()!} {...stylex.props(styles.audio)} />
            </Show>
          </Show>
        </div>
      </section>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.title)}>{t("home.latest")}</div>
        <Show
          when={episodes()?.length}
          fallback={<div {...stylex.props(styles.empty)}>{t("home.empty")}</div>}
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
