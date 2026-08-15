// 收藏/点赞交互（客户端）：图标 + 数字（公开计数 + 当前用户状态）。
// 未登录点击 → 跳统一登录页（redirect 回当前页）；登录后刷新即恢复状态。
import { createSignal, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { env } from "../lib/env";

const styles = stylex.create({
  actions: {
    display: "flex",
    gap: "8px",
    marginTop: "12px",
  },
  actionBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px", // 图标后面直接跟数字
    padding: "6px 14px",
    borderRadius: "999px",
    backgroundColor: "transparent",
    color: colors.foreground,
    fontSize: "13px",
    cursor: "pointer",
    ":hover": { borderColor: colors.primary },
  },
  actionActive: {
    borderColor: colors.primary,
    color: colors.primary,
  },
  count: {
    fontVariantNumeric: "tabular-nums",
  },
  // 组件级骨架：计数加载中占位（小灰条 + 脉冲，同全局 shimmer 风格）
  countSkeleton: {
    width: "18px",
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

interface InteractionsResp {
  liked?: boolean;
  likes?: number;
  favorited?: boolean;
  favorites?: number;
}

export function InteractButtons(props: { episodeId: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [fav, setFav] = createSignal(false);
  const [favCount, setFavCount] = createSignal(0);
  const [liked, setLiked] = createSignal(false);
  const [likeCount, setLikeCount] = createSignal(0);
  const [busy, setBusy] = createSignal(false);
  // 组件级加载态：计数未就绪时显示小骨架（不阻塞页面主体，独立并行加载）
  const [ready, setReady] = createSignal(false);

  // 挂载：公开计数（点赞/收藏数）+ 当前用户互动状态（未登录 401 → 保持未选中）
  onMount(() => {
    void fetch(`${env.apiBaseUrlPublic ?? env.apiBaseUrl}/v1/public/episodes/${props.episodeId}/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setLikeCount(d.likes ?? 0);
          setFavCount(d.favorites ?? 0);
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
    void fetch(`/v1/episodes/${props.episodeId}/interactions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setLiked(!!d.liked);
          setFav(!!d.favorited);
        }
      })
      .catch(() => {});
  });

  const toggle = async (kind: "favorite" | "like") => {
    if (busy()) return;
    setBusy(true);
    try {
      const res = await fetch(`/v1/episodes/${props.episodeId}/${kind}`, { method: "POST" });
      if (res.status === 401) {
        // 未登录：跳统一登录页，登录后回当前页
        navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as InteractionsResp;
      if (kind === "favorite") {
        setFav(!!data.favorited);
        if (typeof data.favorites === "number") setFavCount(data.favorites);
      } else {
        setLiked(!!data.liked);
        if (typeof data.likes === "number") setLikeCount(data.likes);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(styles.actions)}>
      <button
        {...stylex.props(styles.actionBtn, liked() && styles.actionActive)}
        aria-label={liked() ? t("episode.liked") : t("episode.like")}
        onClick={() => toggle("like")}
      >
        <span aria-hidden="true">{liked() ? "♥" : "♡"}</span>
        {/* 组件级骨架：计数未加载完成时不显示 "0"（避免误导），灰条占位 */}
        <Show when={ready()} fallback={<span {...stylex.props(styles.countSkeleton)} />}>
          <span {...stylex.props(styles.count)}>{likeCount()}</span>
        </Show>
      </button>
      <button
        {...stylex.props(styles.actionBtn, fav() && styles.actionActive)}
        aria-label={fav() ? t("episode.favorited") : t("episode.favorite")}
        onClick={() => toggle("favorite")}
      >
        <span aria-hidden="true">{fav() ? "★" : "☆"}</span>
        <Show when={ready()} fallback={<span {...stylex.props(styles.countSkeleton)} />}>
          <span {...stylex.props(styles.count)}>{favCount()}</span>
        </Show>
      </button>
    </div>
  );
}
