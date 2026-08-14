// 收藏/点赞交互（客户端）：未登录点击 → 跳统一登录页（redirect 回当前页）
import { createSignal } from "solid-js";
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
    padding: "6px 14px",
    borderRadius: "999px",
    backgroundColor: "transparent",
    color: colors.foreground,
    fontSize: "13px",
    cursor: "pointer",
  },
  actionActive: {
    borderColor: colors.primary,
    color: colors.primary,
  },
});

export function InteractButtons(props: { episodeId: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [fav, setFav] = createSignal(false);
  const [liked, setLiked] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const toggle = async (kind: "favorite" | "like") => {
    if (busy()) return;
    const res = await fetch(`/v1/episodes/${props.episodeId}/${kind}`, { method: "POST" });
    if (res.status === 401) {
      // 未登录：跳统一登录页，登录后回当前页
      navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!res.ok) return;
    setBusy(true);
    try {
      const data = (await res.json()) as { favorited?: boolean; liked?: boolean };
      if (kind === "favorite") setFav(!!data.favorited);
      else setLiked(!!data.liked);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(styles.actions)}>
      <button
        {...stylex.props(styles.actionBtn, liked() && styles.actionActive)}
        onClick={() => toggle("like")}
      >
        {liked() ? t("episode.liked") : t("episode.like")}
      </button>
      <button
        {...stylex.props(styles.actionBtn, fav() && styles.actionActive)}
        onClick={() => toggle("favorite")}
      >
        {fav() ? t("episode.favorited") : t("episode.favorite")}
      </button>
    </div>
  );
}
