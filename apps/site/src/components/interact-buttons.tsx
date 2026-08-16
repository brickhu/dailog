// 收藏/点赞交互（客户端）：图标 + 数字（公开计数 + 当前用户状态）。
// 未登录点击 → 跳统一登录页（redirect 回当前页）；登录后刷新即恢复状态。
import { createEffect, createResource, createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { apiBaseForFetch } from "../lib/env";

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

export function InteractButtons(props: {
  episodeId: string;
  /** 父级已请求的公开计数（如详情页统计行）；缺省时组件自行请求 */
  counts?: { likes?: number; favorites?: number } | null;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [fav, setFav] = createSignal(false);
  const [favCount, setFavCount] = createSignal(0);
  const [liked, setLiked] = createSignal(false);
  const [likeCount, setLikeCount] = createSignal(0);
  const [busy, setBusy] = createSignal(false);

  // 公开计数：父级已提供（详情页统计行同端点）则直接复用，避免重复请求；
  // 否则组件自行请求。计数到达后填充（toggle 后以服务端返回的最新计数为准）。
  const [stats] = createResource(
    () => props.episodeId,
    async (episodeId) => {
      if (props.counts) return props.counts;
      const r = await fetch(`${apiBaseForFetch}/v1/public/episodes/${episodeId}/stats`);
      return r.ok ? ((await r.json()) as { likes?: number; favorites?: number }) : null;
    },
  );
  // 登录态端点：SSR 无 cookie 必然 401，且相对路径在 Node fetch 下直接抛错。
  // source 在 SSR 端为 null → server 端 load 短路（不执行、不序列化）→ 客户端 hydration 后重新请求。
  const [interactions] = createResource(
    () => (typeof window === "undefined" ? null : props.episodeId),
    async (episodeId) => {
      // 未登录 401 → null → 保持未选中
      const r = await fetch(`/v1/episodes/${episodeId}/interactions`);
      return r.ok ? ((await r.json()) as { liked?: boolean; favorited?: boolean }) : null;
    },
  );
  createEffect(() => {
    const d = stats();
    if (d) {
      setLikeCount(d.likes ?? 0);
      setFavCount(d.favorites ?? 0);
    }
  });
  createEffect(() => {
    const d = interactions();
    if (d) {
      setLiked(!!d.liked);
      setFav(!!d.favorited);
    }
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
        <Show when={!stats.loading} fallback={<span {...stylex.props(styles.countSkeleton)} />}>
          <span {...stylex.props(styles.count)}>{likeCount()}</span>
        </Show>
      </button>
      <button
        {...stylex.props(styles.actionBtn, fav() && styles.actionActive)}
        aria-label={fav() ? t("episode.favorited") : t("episode.favorite")}
        onClick={() => toggle("favorite")}
      >
        <span aria-hidden="true">{fav() ? "★" : "☆"}</span>
        <Show when={!stats.loading} fallback={<span {...stylex.props(styles.countSkeleton)} />}>
          <span {...stylex.props(styles.count)}>{favCount()}</span>
        </Show>
      </button>
    </div>
  );
}
