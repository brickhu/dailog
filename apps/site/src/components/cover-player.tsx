// 封面播放卡（极简）：封面图 + 居中的播放/暂停按钮。
// 进度/标题/切换由全局播放条（PlayerBar）承载——封面只保留最核心的播放控制。
import { Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { episodeCoverUrl } from "../lib/env";
import type { QueueEpisode } from "../lib/playback";

const styles = stylex.create({
  wrap: {
    position: "relative",
    width: "100%",
    aspectRatio: "1 / 1",
    borderRadius: dimensions.radiusLg,
    overflow: "hidden",
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    userSelect: "none",
    flexShrink: 0,
  },
  cover: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    pointerEvents: "none",
  },
  shade: {
    position: "absolute",
    inset: 0,
    background: "linear-gradient(to top, rgba(0,0,0,0.35) 0%, transparent 40%)",
    pointerEvents: "none",
  },
  btnWrap: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
  btn: {
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    border: "none",
    backgroundColor: "#fff",
    color: "#111",
    fontSize: dimensions.fontSizeXl,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
    pointerEvents: "auto",
  },
});

export function CoverPlayer(props: {
  episode: QueueEpisode;
  playing: boolean;
  onToggle: () => void;
}) {
  return (
    <div {...stylex.props(styles.wrap)}>
      <Show when={episodeCoverUrl(props.episode.id, props.episode.coverUrl)}>
        <img src={episodeCoverUrl(props.episode.id, props.episode.coverUrl)!} alt={props.episode.title || ""} {...stylex.props(styles.cover)} />
      </Show>
      <div {...stylex.props(styles.shade)} />
      <div {...stylex.props(styles.btnWrap)}>
        <button
          {...stylex.props(styles.btn)}
          onClick={props.onToggle}
          aria-label={props.playing ? "pause" : "play"}
        >
          {props.playing ? "⏸" : "▶"}
        </button>
      </div>
    </div>
  );
}
