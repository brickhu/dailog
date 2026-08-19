// 点赞交互（简化版 0034）：图标 + 数字（当前用户状态 + 最新计数，interactions 合并返回）。
// 收藏与播放统计已移除——收藏由「加入播放列表」覆盖，节目页不再展示播放/完播次数。
// 未登录点击 → 跳统一登录页（redirect 回当前页）；登录后刷新即恢复状态。
import { createEffect, createResource, createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

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

interface LikeResp {
  liked?: boolean;
  likes?: number;
}

export function InteractButtons(props: {
  episodeId: string;
  /** 父级已请求的公开计数（详情页统计行同端点）；缺省时组件自行请求（0036 恢复） */
  counts?: { likes?: number } | null;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [liked, setLiked] = createSignal(false);
  const [likeCount, setLikeCount] = createSignal(0);
  const [busy, setBusy] = createSignal(false);

  // 公开计数：父级已提供（详情页统计行）则直接复用；否则组件自行请求 stats。
  // 点赞状态：登录态端点（interactions），SSR 无 cookie 必然 401 → 客户端 hydration 后重新请求。
  // source 在 SSR 端为 null → 不执行 fetcher（相对路径在 Node fetch 下直接抛错
  // "Failed to parse URL"；且避免与父级统计行重复请求）——客户端 hydration 后执行。
  const [stats] = createResource(
    () => (typeof window === "undefined" ? null : props.episodeId),
    async (episodeId) => {
      if (props.counts) return props.counts;
      const r = await fetch(`/v1/public/episodes/${episodeId}/stats`);
      return r.ok ? ((await r.json()) as { likes?: number }) : null;
    },
  );
  const [interactions] = createResource(
    () => (typeof window === "undefined" ? null : props.episodeId),
    async (episodeId) => {
      const r = await fetch(`/v1/episodes/${episodeId}/interactions`);
      return r.ok ? ((await r.json()) as LikeResp) : null;
    },
  );
  createEffect(() => {
    const d = stats();
    if (d && typeof d.likes === "number") setLikeCount(d.likes);
  });
  createEffect(() => {
    const d = interactions();
    if (d) {
      setLiked(!!d.liked);
      if (typeof d.likes === "number") setLikeCount(d.likes);
    }
  });

  const toggle = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      const res = await fetch(`/v1/episodes/${props.episodeId}/like`, { method: "POST" });
      if (res.status === 401) {
        navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as LikeResp;
      setLiked(!!data.liked);
      if (typeof data.likes === "number") setLikeCount(data.likes);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(styles.actions)}>
      <button
        {...stylex.props(styles.actionBtn, liked() && styles.actionActive)}
        aria-label={liked() ? t("episode.liked") : t("episode.like")}
        onClick={toggle}
      >
        <span aria-hidden="true">{liked() ? "♥" : "♡"}</span>
        <Show when={!stats.loading} fallback={<span {...stylex.props(styles.countSkeleton)} />}>
          <span {...stylex.props(styles.count)}>{likeCount()}</span>
        </Show>
      </button>
    </div>
  );
}
