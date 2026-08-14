// 节目详情面板（首页详情态 + /<episode_id> 直链复用）：
// 标题/主持人/日期时长/简介/台本（折叠）/原始对话/点赞收藏
import { Show, createSignal } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import type { QueueEpisode } from "../lib/playback";
import { InteractButtons } from "./interact-buttons";

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

  return (
    <div {...stylex.props(styles.root)}>
      <h1 {...stylex.props(styles.title)}>{ep().title || t("common.unnamed")}</h1>
      <p {...stylex.props(styles.meta)}>
        {(() => {
          const pub = ep().publishedAt;
          return `${hostName()} · ${pub ? new Date(pub).toLocaleDateString("zh-CN") : ""}${ep().durationSeconds ? ` · ${fmtDuration(ep().durationSeconds)}` : ""}`;
        })()}
      </p>
      <InteractButtons episodeId={ep().id} />
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
