// 精选 banner 轮播（探索页顶部专属区）：整行宽大图 + 标题/摘要 + 播放按钮，一屏一张。
// - 空池不渲染任何内容（整区由调用方隐藏）；null = 加载中（PickedBannerSkeleton 占位）
// - 轮播用共享 Carousel（原生横向滚动 + 滚动吸附 + 两侧翻页按钮）
// - 卡片整体可点进详情：用 useClickableContainer（href 语义：Enter / 中键 / Cmd+点击新标签页；
//   内嵌播放按钮命中交互元素时不激活容器）——不用 <a> 包 <button>（无效 HTML + 点按钮会跳走）
import { For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Carousel } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { episodeCoverUrl } from "../lib/env";
import { fmtDate, fmtDuration } from "../lib/format";
import type { QueueEpisode } from "../lib/playback";
import type { EpisodeSummary } from "../lib/db";
import { PlayButton } from "./play-button";
import { useClickableContainer } from "./use-clickable-container";

// 断点标签（值同 theme.stylex 的 constants——stylex babel 插件不支持跨文件常量解析）
const DESKTOP = "@media (min-width: 1025px)";
const TABLET_UP = "@media (min-width: 640px)";

/** 秒 → 一行摘要（summary 优先，回退 description；截断交给 CSS 两行 clamp） */
function summaryOf(ep: EpisodeSummary): string {
  return (ep.summary || ep.description || "").replace(/\s+/g, " ").trim();
}

/** EpisodeSummary → 播放器队列项（PlayButton 需要 QueueEpisode 形状；列表查询不含的字段兜底） */
function toQueueEpisode(ep: EpisodeSummary): QueueEpisode {
  return {
    id: ep.id,
    slug: ep.slug,
    title: ep.title,
    description: ep.description,
    coverUrl: ep.coverUrl,
    audioUrl: ep.audioUrl,
    language: ep.language ?? "zh",
    durationSeconds: ep.durationSeconds,
    publishedAt: ep.publishedAt,
    username: ep.username ?? "",
    name: ep.name ?? ep.username ?? "",
    callName: null,
    transcript: null,
    sourceUrl: ep.sourceUrl ?? null,
  };
}

const styles = stylex.create({
  item: {
    width: "100%", // 一屏一张
  },
  slide: {
    position: "relative",
    width: "100%",
    height: "240px",
    borderRadius: dimensions.radiusLg,
    overflow: "hidden",
    backgroundColor: colors.surfaceStrong, // 无封面时的兜底底色
    cursor: "pointer",
    outline: { default: null, ":focus-visible": `2px solid ${colors.primary}` },
    outlineOffset: { default: "0", ":focus-visible": "3px" },
    [TABLET_UP]: { height: "320px" },
    [DESKTOP]: { height: "380px" },
  },
  cover: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  // 底部渐变遮罩：保证白字在任何封面上都可读（浅色/深色主题通用）
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundImage:
      "linear-gradient(to top, rgba(0, 0, 0, 0.82) 0%, rgba(0, 0, 0, 0.45) 38%, rgba(0, 0, 0, 0) 72%)",
  },
  body: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: dimensions.spacing2,
    padding: dimensions.spacing4,
    [TABLET_UP]: { padding: dimensions.spacing6 },
  },
  title: {
    margin: 0,
    color: "#ffffff",
    fontSize: dimensions.fontSizeXl,
    fontWeight: dimensions.fontWeightBold,
    textWrap: "balance",
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    [TABLET_UP]: { fontSize: dimensions.fontSize2xl },
  },
  desc: {
    margin: 0,
    color: "rgba(255, 255, 255, 0.86)",
    fontSize: dimensions.fontSizeSm,
    maxWidth: "720px",
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    [TABLET_UP]: { fontSize: dimensions.fontSizeMd },
  },
  meta: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: dimensions.spacing3,
    color: "rgba(255, 255, 255, 0.78)",
    fontSize: dimensions.fontSizeSm,
  },
  // 骨架（加载中）：与真实 banner 同高，避免布局跳动
  skeleton: {
    width: "100%",
    height: "240px",
    borderRadius: dimensions.radiusLg,
    backgroundColor: colors.surface,
    [TABLET_UP]: { height: "320px" },
    [DESKTOP]: { height: "380px" },
    animationName: stylex.keyframes({
      from: { opacity: 0.55 },
      to: { opacity: 1 },
    }),
    animationDuration: "0.9s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
    animationDirection: "alternate",
  },
});

/** 单张 banner：大图 + 渐变压底 + 标题/摘要 + 播放按钮；整张可点进详情 */
function PickedSlide(props: { episode: EpisodeSummary; isFirst: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const href = () => `/episode/${props.episode.slug}`;
  // banner 大图取 960 规格（整行宽 ~1100 CSS px；不指定 w 会拉原图）
  const cover = () => episodeCoverUrl(props.episode.id, props.episode.coverUrl, 960);
  const clickable = useClickableContainer({
    getHref: href,
    getLabel: () => props.episode.title || t("common.unnamed"),
    // SPA 内导航（hook 默认 window.location.assign 整页刷新）；preventDefault 后由 router 接管
    getOnClick: () => (e: MouseEvent) => {
      e.preventDefault();
      navigate(href());
    },
  });

  return (
    <div
      ref={clickable.setRef}
      role={clickable.role()}
      tabIndex={clickable.tabIndex()}
      aria-label={clickable.ariaLabel()}
      onClick={clickable.handleClick}
      onKeyDown={clickable.handleKeyDown}
      {...stylex.props(styles.slide)}
    >
      <Show when={cover()}>
        <img
          src={cover()!}
          alt=""
          loading={props.isFirst ? "eager" : "lazy"}
          {...stylex.props(styles.cover)}
        />
      </Show>
      <div {...stylex.props(styles.scrim)} />
      <div {...stylex.props(styles.body)}>
        <p {...stylex.props(styles.title)}>{props.episode.title || t("common.unnamed")}</p>
        <Show when={summaryOf(props.episode)}>
          <p {...stylex.props(styles.desc)}>{summaryOf(props.episode)}</p>
        </Show>
        <div {...stylex.props(styles.meta)}>
          <PlayButton episode={toQueueEpisode(props.episode)} isIconOnly={false} size="lg" />
          <span>
            @{props.episode.username} · {fmtDate(props.episode.publishedAt)} · {fmtDuration(props.episode.durationSeconds)}
          </span>
        </div>
      </div>
    </div>
  );
}

/** 加载中占位（与真实 banner 同高） */
export function PickedBannerSkeleton() {
  return <div {...stylex.props(styles.skeleton)} aria-busy="true" />;
}

/** 精选 banner：episodes 为空（无精选）→ 不渲染（整区隐藏由调用方保证） */
export function PickedBanner(props: { episodes: EpisodeSummary[] }) {
  const { t } = useI18n();
  return (
    <Carousel
      itemXstyle={styles.item}
      gap={3}
      hasSnap
      hasEdgeFade={false}
      aria-label={t("discover.picked")}
    >
      <For each={props.episodes}>{(ep, i) => <PickedSlide episode={ep} isFirst={i() === 0} />}</For>
    </Carousel>
  );
}
