// 节目卡片（三种模式，首页网格/列表/纯封面共用）：
// - compact 精简：只有封面图，不带交互（无按钮/无 hover 划入）
// - grid 网格：封面（Cover 三态播放按钮，hover 划入）+ 标题 + 时间 + 时长，上下排列
// - list 列表：小封面 + 标题/日期 横排，时长 + 三态播放按钮靠右
// - 事件：onPlay/onPause 控制全局播放器；onClick 卡片点击（进详情）；onHover 预取
import type { JSX } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { Cover, CoverControls } from "./cover";
import { CARD_COVER_SIZES } from "../lib/env";
import type { QueueEpisode } from "../lib/playback";

const styles = stylex.create({
  // —— grid 网格模式（上下排列）——
  gridCard: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
    cursor: "pointer",
    ":hover": { borderColor: colors.primary },
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
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // —— list 列表模式（横向排列）——
  listRow: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    cursor: "pointer",
    ":hover": { borderColor: colors.primary },
  },
  listInfo: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing1,
  },
  listRight: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    flexShrink: 0,
  },
  duration: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    fontVariantNumeric: "tabular-nums",
  },
});

function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function EpisodeCard(props: {
  /** 节目 meta（id / coverUrl / title / publishedAt / durationSeconds 等） */
  episode: QueueEpisode;
  /** 模式 @default "grid" */
  variant?: "compact" | "grid" | "list";
  /** 是否播放中（外部受控，来自全局播放器） */
  playing: boolean;
  /** 待播放点击（进入加载中）——外部接入全局播放器 */
  onPlay?: () => void;
  /** 播放中点击暂停——外部接入全局播放器 */
  onPause?: () => void;
  /** 卡片主体点击（进详情页） */
  onClick?: () => void;
  /** 卡片 hover（列表页详情预取等） */
  onHover?: () => void;
  /** CSS 控制显示大小（透传） */
  style?: JSX.CSSProperties;
  class?: string;
}) {
  const { t, locale } = useI18n();
  const hostName = () => props.episode.callName ?? props.episode.displayName ?? props.episode.username;
  const date = () => {
    const d = props.episode.publishedAt;
    return d ? new Date(d).toLocaleDateString(locale() === "zh" ? "zh-CN" : "en-US") : "";
  };
  const metaText = () => [hostName(), date(), fmtDuration(props.episode.durationSeconds)].filter(Boolean).join(" · ");

  if (props.variant === "compact") {
    // 精简：只有封面图，不带交互
    return (
      <Cover
        episode={props.episode}
        playing={false}
        interactive={false}
        sizes={CARD_COVER_SIZES}
        style={props.style}
        class={props.class}
      />
    );
  }

  if (props.variant === "list") {
    // 列表：封面 + 标题/日期 + （时长 + 播放按钮靠右）
    return (
      <div
        {...stylex.props(styles.listRow)}
        style={props.style}
        class={props.class}
        onClick={props.onClick}
        onPointerEnter={props.onHover}
      >
        <Cover
          episode={props.episode}
          playing={false}
          interactive={false}
          sizes={CARD_COVER_SIZES}
          style={{ width: "56px", height: "56px" }}
        />
        <div {...stylex.props(styles.listInfo)}>
          <p {...stylex.props(styles.title)}>{props.episode.title || t("common.unnamed")}</p>
          <p {...stylex.props(styles.meta)}>{date()}</p>
        </div>
        <div {...stylex.props(styles.listRight)}>
          <span {...stylex.props(styles.duration)}>{fmtDuration(props.episode.durationSeconds)}</span>
          <CoverControls playing={props.playing} onPlay={props.onPlay} onPause={props.onPause} size="sm" />
        </div>
      </div>
    );
  }

  // grid 网格：封面（三态按钮 hover 划入）+ 标题 + 时间 + 时长，上下排列
  return (
    <div
      {...stylex.props(styles.gridCard)}
      style={props.style}
      class={props.class}
      onClick={props.onClick}
      onPointerEnter={props.onHover}
    >
      <Cover episode={props.episode} playing={props.playing} onPlay={props.onPlay} onPause={props.onPause} sizes={CARD_COVER_SIZES} />
      <p {...stylex.props(styles.title)}>{props.episode.title || t("common.unnamed")}</p>
      <p {...stylex.props(styles.meta)}>{metaText()}</p>
    </div>
  );
}
