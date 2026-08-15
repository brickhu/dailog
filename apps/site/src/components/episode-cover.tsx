// 封面图（加载占位 + 失败兜底）：R2 首次请求冷启动慢（数秒，见 developer-guide），
// 加载中显示灰底占位，加载失败显示 🎙 —— 避免封面区域长时间空白。
import { createSignal, Show, type JSX } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { episodeCoverUrl } from "../lib/env";

const styles = stylex.create({
  wrap: {
    position: "relative",
    width: "100%",
    aspectRatio: "1 / 1",
  },
  img: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: dimensions.radiusSm,
    display: "block",
  },
  placeholder: {
    position: "absolute",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.surfaceStrong,
    fontSize: "40px",
    color: colors.neutral,
    userSelect: "none",
  },
});

export function EpisodeCover(props: {
  id: string;
  coverUrl: string | null | undefined;
  alt?: string;
  style?: JSX.CSSProperties;
}) {
  const [state, setState] = createSignal<"loading" | "loaded" | "error">("loading");
  const src = () => episodeCoverUrl(props.id, props.coverUrl);
  return (
    <Show when={src()} fallback={<div {...stylex.props(styles.placeholder)}>🎙</div>}>
      <div {...stylex.props(styles.wrap)} style={props.style}>
        <Show when={state() !== "loaded"}>
          <div {...stylex.props(styles.placeholder)}>🎙</div>
        </Show>
        <img
          src={src()!}
          alt={props.alt ?? ""}
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
          style={state() === "loaded" ? undefined : { display: "none" }}
          {...stylex.props(styles.img)}
        />
      </div>
    </Show>
  );
}
