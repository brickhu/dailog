// 节目详情面板（首页详情态 + /<episode_id> 直链复用）：
// 标题/主持人/日期时长/播放统计/简介/台本（折叠）/原始对话/点赞收藏
import { Show, createSignal, onMount } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { env } from "../lib/env";
import type { QueueEpisode } from "../lib/playback";
import { InteractButtons } from "./interact-buttons";
import { ShareButtons } from "./share-buttons";

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing4,
    height: "100%",
    overflowY: "auto",
    paddingRight: dimensions.spacing2,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
    lineHeight: 1.3,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  desc: {
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.7,
    margin: 0,
    whiteSpace: "pre-wrap",
  },
  source: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    ":hover": { color: colors.primary },
  },
  transcriptBtn: {
    alignSelf: "flex-start",
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusFull,
    background: "transparent",
    color: colors.foreground,
    fontSize: dimensions.fontSizeSm,
    cursor: "pointer",
  },
  transcript: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    lineHeight: 1.8,
    whiteSpace: "pre-wrap",
    paddingLeft: dimensions.spacing3,
    margin: 0,
  },
  noDesc: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  // 组件级骨架：统计行加载中占位（小灰条 + 脉冲）
  statsSkeleton: {
    display: "inline-block",
    width: "120px",
    height: "12px",
    borderRadius: "4px",
    backgroundColor: colors.surfaceStrong,
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

function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m} 分 ${String(s).padStart(2, "0")} 秒`;
}

export function EpisodeDetail(props: { episode: QueueEpisode }) {
  const { t } = useI18n();
  const ep = () => props.episode;
  const hostName = () => ep().callName ?? ep().displayName ?? ep().username;
  const [showTranscript, setShowTranscript] = createSignal(false);
  // 播放/完播统计（公开端点；播放器上报后下次加载刷新）——组件级独立加载，不阻塞页面主体
  const [stats, setStats] = createSignal<{ plays: number; completions: number } | null>(null);
  const [statsReady, setStatsReady] = createSignal(false);
  onMount(() => {
    void fetch(`${env.apiBaseUrlPublic ?? env.apiBaseUrl}/v1/public/episodes/${ep().id}/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStats(d))
      .catch(() => {})
      .finally(() => setStatsReady(true));
  });

  return (
    <div {...stylex.props(styles.root)}>
      <h1 {...stylex.props(styles.title)}>{ep().title || t("common.unnamed")}</h1>
      <p {...stylex.props(styles.meta)}>
        {(() => {
          const pub = ep().publishedAt;
          return `${hostName()} · ${pub ? new Date(pub).toLocaleDateString("zh-CN") : ""}${ep().durationSeconds ? ` · ${fmtDuration(ep().durationSeconds)}` : ""}`;
        })()}
      </p>
      {/* 统计行：组件级骨架（加载中灰条，独立于页面主体） */}
      <Show when={statsReady()} fallback={<span {...stylex.props(styles.statsSkeleton)} />}>
        <Show when={stats()}>
          <p {...stylex.props(styles.meta)}>
            {t("episode.plays", { count: stats()!.plays })} · {t("episode.completions", { count: stats()!.completions })}
          </p>
        </Show>
      </Show>
      <InteractButtons episodeId={ep().id} />
      <ShareButtons episode={ep()} />
      <Show when={ep().description} fallback={<p {...stylex.props(styles.noDesc)}>{t("episode.noDescription")}</p>}>
        <p {...stylex.props(styles.desc)}>{ep().description}</p>
      </Show>
      <Show when={ep().sourceUrl}>
        <a href={ep().sourceUrl!} target="_blank" rel="noopener noreferrer" {...stylex.props(styles.source)}>
          {t("episode.sourceUrl")} ↗ {ep().sourceUrl}
        </a>
      </Show>
      <Show when={ep().transcript}>
        <button {...stylex.props(styles.transcriptBtn)} onClick={() => setShowTranscript((v) => !v)}>
          {showTranscript() ? t("common.cancel") : t("episode.transcript")}
        </button>
        <Show when={showTranscript()}>
          <p {...stylex.props(styles.transcript)}>{ep().transcript}</p>
        </Show>
      </Show>
    </div>
  );
}
