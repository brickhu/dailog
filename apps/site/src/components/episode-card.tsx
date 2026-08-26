// 节目卡片（三种模式，首页网格/列表/纯封面共用）：
// - compact 精简：只有封面图，不带交互（无按钮/无 hover 划入）
// - grid 网格：封面（PlayButton 四态按钮，hover 划入）+ 标题 + 时间 + 时长，上下排列
// - list 列表：小封面 + 标题/日期 横排，时长 + 播放按钮靠右
// - 自包含：调用方只传 episode——播放/暂停/缓冲/错误由内部 PlayButton（独立组件
//   play-button.tsx）接入全局播放器（usePlayback）；卡片点击进详情（useNavigate）、
//   hover 预取详情数据（getEpisodeCached），均可用 onClick/onHover 覆盖
// cover.tsx 只负责显示图片；按钮的显隐/定位由卡片层决定——grid 封面右下角
// hover 划入（btnIdle/btnIdleVisible + hover 信号，见下），list 右侧常显。
// PlayButton 自身不管理"鼠标划入才显示"逻辑
import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { Cover } from "./cover";
import { PlayButton } from "./play-button";
import { CARD_COVER_SIZES } from "../lib/env";
import { getEpisodeCached } from "../lib/episode-cache";
import { usePlayback, type QueueEpisode } from "../lib/playback";
import { fmtDate, fmtDuration } from "../lib/format";

const styles = stylex.create({
  // —— grid 网格模式（上下排列）——
  gridCard: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
    // 撑满父容器宽（Carousel 项包裹层是 flex 容器，flex item width:auto 只收缩到内容宽；
    // width:100% 相对包裹层确定宽度解析 → 卡片填满，调用方无需再包一层 fill div）
    width: "100%",
    cursor: "pointer",
    ":hover": { borderColor: colors.primary },
  },
  // 封面槽：封面 + 右下角按钮的定位容器（按钮覆盖在封面上）
  coverSlot: {
    position: "relative",
  },
  // 按钮槽：右下角（grid 封面用）。
  // 固定 40×40 + flex：槽高不随内容类型变化（block 容器 vs inline 按钮的行盒高度不同，
  // bottom 锚定下按钮位置会差几像素——四态切换跳动）；按钮统一对齐右下。
  btnSlot: {
    position: "absolute",
    right: dimensions.spacing3,
    bottom: dimensions.spacing3,
    zIndex: 1,
    width: dimensions.sizeLg,
    height: dimensions.sizeLg,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "flex-end",
  },
  // 待播放：默认隐藏（透明），hover 淡入；触摸设备（无 hover）常显。
  // 卡片层持有（PlayButton 不管理显隐）：用 opacity 而非 translateY 位移——
  // 四态按钮切换时位置必须恒定（位移动画中点击/切换会让按钮从半路位置跳到
  // 最终位置，视觉跳动）
  btnIdle: {
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: "0.2s",
    transitionTimingFunction: "ease",
    "@media (hover: none)": {
      opacity: 1,
    },
  },
  btnIdleVisible: {
    opacity: 1,
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
  // 新节目标记：日期前的 brand 色小圆点（isNew=true 时显示）
  newDot: {
    display: "inline-block",
    width: "8px",
    height: "8px",
    marginRight: dimensions.spacing1,
    borderRadius: "50%",
    backgroundColor: colors.brand,
    verticalAlign: "middle",
    flexShrink: 0,
  },
  // —— list 列表模式（横向排列）——
  // list 封面固定 56×56：stylex 对象走 xstyle 传入（固定样式统一用 stylex.create，
  // 不再用内联 style——与全项目 xstyle 约定一致）
  coverList: {
    width: "56px",
    height: "56px",
  },
  listRow: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    width: "100%", // 撑满父容器宽（同上：flex 容器内不收缩到内容宽）
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

export function EpisodeCard(props: {
  /** 节目 meta（id / coverUrl / title / publishedAt / durationSeconds 等） */
  episode: QueueEpisode;
  /** 模式 @default "grid" */
  variant?: "compact" | "grid" | "list";
  /** 新节目标记：true 时日期前显示 brand 色小圆点 @default false */
  isNew?: boolean;
  /** 卡片主体点击覆盖（缺省内部进详情页 /episode/{slug}） */
  onClick?: () => void;
  /** 卡片 hover 覆盖（缺省内部预取详情数据） */
  onHover?: () => void;
  /** StyleX 样式：外部注入覆盖（stylex.create 产物，最后合并；命名与 ui 包 xstyle 统一） */
  xstyle?: stylex.StyleXStyles;
}) {
  const { t, locale } = useI18n();
  const playback = usePlayback();
  const navigate = useNavigate();
  const [hover, setHover] = createSignal(false);
  // 自包含行为：播放/暂停/缓冲/错误由内部 PlayButton（传 episode）接管；
  // 卡片层只管"按钮显隐"（grid 封面 hover 划入）+ 音源判定
  const isCurrent = (id: string) => playback.current()?.id === id;
  const audioError = () =>
    !props.episode.audioUrl ||
    (isCurrent(props.episode.id) && playback.audioError()) ||
    playback.preloadError() === props.episode.id;
  // grid 封面按钮显隐（卡片层策略）：待播放态 hover 划入；一旦本集进入
  // 播放/缓冲/错误态按钮常显（点击后鼠标移开也能看到暂停/spinner/警告）
  const btnReveal = () =>
    hover() ||
    audioError() ||
    (isCurrent(props.episode.id) && (playback.playing() || playback.buffering()));
  // 缺省行为：点击进详情、hover 预取详情数据；调用方可传 onClick/onHover 覆盖
  const handleClick = () => {
    if (props.onClick) props.onClick();
    else navigate(`/episode/${props.episode.slug}`);
  };
  const handleHover = () => {
    if (props.onHover) props.onHover();
    else void getEpisodeCached(props.episode.slug);
  };
  const date = () => {
    const d = props.episode.publishedAt;
    return d ? fmtDate(d, locale() === "zh" ? "zh-CN" : "en-US") : "";
  };
  // grid 模式 meta：日期 + 时长（不显示用户名——卡片聚焦内容，主播身份在详情页呈现）
  const metaText = () => [date(), fmtDuration(props.episode.durationSeconds)].filter(Boolean).join(" · ");
  // 封面 hover（grid 模式按钮划入的载体）；compact/list 不挂（避免多余事件）
  const coverPointerEnter = () => setHover(true);
  const coverPointerLeave = () => setHover(false);

  if (props.variant === "compact") {
    // 精简：只有封面图，不带交互
    return (
      <Cover episode={props.episode} sizes={CARD_COVER_SIZES} xstyle={props.xstyle} />
    );
  }

  if (props.variant === "list") {
    // 列表：封面 + 标题/日期 + （时长 + 播放按钮靠右）
    return (
      <div
        {...stylex.props(styles.listRow, props.xstyle)}
        onClick={handleClick}
        onPointerEnter={handleHover}
      >
        <Cover episode={props.episode} sizes={CARD_COVER_SIZES} xstyle={styles.coverList} />
        <div {...stylex.props(styles.listInfo)}>
          <p {...stylex.props(styles.title)}>{props.episode.title || t("common.unnamed")}</p>
          <p {...stylex.props(styles.meta)}>{date()}</p>
        </div>
        <div {...stylex.props(styles.listRight)}>
          <span {...stylex.props(styles.duration)}>{fmtDuration(props.episode.durationSeconds)}</span>
          <PlayButton episode={props.episode} size="sm" />
        </div>
      </div>
    );
  }

  // grid 网格：封面（播放按钮 hover 划入）+ 标题 + 时间 + 时长，上下排列
  return (
    <div
      {...stylex.props(styles.gridCard, props.xstyle)}
      onClick={handleClick}
      onPointerEnter={handleHover}
    >
      <div {...stylex.props(styles.coverSlot)} onPointerEnter={coverPointerEnter} onPointerLeave={coverPointerLeave}>
        <Cover episode={props.episode} sizes={CARD_COVER_SIZES} />
        <div {...stylex.props(styles.btnSlot)}>
          <div {...stylex.props(styles.btnIdle, btnReveal() && styles.btnIdleVisible)}>
            <PlayButton episode={props.episode} size="sm" />
          </div>
        </div>
      </div>
      <p {...stylex.props(styles.title)}>{props.episode.title || t("common.unnamed")}</p>
      <p {...stylex.props(styles.meta)}>
        <Show when={props.isNew}>
          <span {...stylex.props(styles.newDot)} />
        </Show>
        {metaText()}
      </p>
    </div>
  );
}


