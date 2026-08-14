// 全局播放条（贯通全站）：底部常驻——封面缩略 + 标题 + 播放/暂停 + 进度条（可拖动）+ 下一期。
// 数据来自 PlaybackContext（队列/连播/统计上报/预加载均在此层）；点标题进详情页。
import { Show } from "solid-js";
import { A } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { episodeCoverUrl } from "../lib/env";
import { usePlayback } from "../lib/playback";

const styles = stylex.create({
  bar: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    padding: `${dimensions.spacing2} ${dimensions.spacing4}`,
    backgroundColor: "rgba(219, 219, 219, 0.72)", // surface 半透明（#dbdbdb）
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
  },
  cover: {
    width: "44px",
    height: "44px",
    borderRadius: dimensions.radiusSm,
    objectFit: "cover",
    flexShrink: 0,
    display: "block",
  },
  info: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  title: {
    fontSize: dimensions.fontSizeSm,
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textDecoration: "none",
    color: colors.foreground,
    ":hover": { color: colors.primary },
  },
  host: {
    fontSize: "12px",
    color: colors.neutral,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  btn: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    backgroundColor: "transparent",
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  btnMain: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
    color: colors.onBrand,
  },
  progress: {
    width: "140px",
    height: "4px",
    appearance: "none",
    WebkitAppearance: "none",
    background: colors.ink,
    borderRadius: "2px",
    cursor: "pointer",
    flexShrink: 0,
    "@media (max-width: 640px)": {
      width: "80px",
    },
  },
  time: {
    fontSize: "11px",
    color: colors.neutral,
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
  },
});

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PlayerBar() {
  const pb = usePlayback();
  const ep = () => pb.current();
  const hostName = () => ep()?.callName ?? ep()?.displayName ?? ep()?.username ?? "";

  return (
    <Show when={pb.activated() && ep()}>
      <div {...stylex.props(styles.bar)}>
        <A href={`/episode/${ep()!.slug}`}>
          <Show when={episodeCoverUrl(ep()!.id, ep()!.coverUrl)}>
            <img src={episodeCoverUrl(ep()!.id, ep()!.coverUrl)!} alt="" {...stylex.props(styles.cover)} />
          </Show>
        </A>
        <div {...stylex.props(styles.info)}>
          <A href={`/episode/${ep()!.slug}`} {...stylex.props(styles.title)}>{ep()!.title || ""}</A>
          <p {...stylex.props(styles.host)}>{hostName()}</p>
        </div>
        <button
          {...stylex.props(styles.btn, styles.btnMain)}
          onClick={pb.toggle}
          aria-label={pb.playing() ? "pause" : "play"}
        >
          {pb.playing() ? "⏸" : "▶"}
        </button>
        <button {...stylex.props(styles.btn)} onClick={pb.next} aria-label="next">⏭</button>
        <span {...stylex.props(styles.time)}>{fmt(pb.progress())}</span>
        <input
          type="range"
          min={0}
          max={Math.max(pb.duration(), 1)}
          step={0.5}
          value={Math.min(pb.progress(), pb.duration() || 0)}
          {...stylex.props(styles.progress)}
          onInput={(e) => pb.seek(Number(e.currentTarget.value))}
        />
        <span {...stylex.props(styles.time)}>{fmt(pb.duration())}</span>
      </div>
    </Show>
  );
}
