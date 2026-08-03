import { createAsync } from "@solidjs/router";
import { createSignal, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import { getEpisode } from "../../lib/db";
import { env } from "../../lib/env";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../theme.stylex";

// 单集页：/episode/:id（播放器 + 元信息；点赞/收藏按钮 Task 4）
const styles = stylex.create({
  page: {
    minHeight: "100vh",
    background: tokens.colorBg,
    color: tokens.colorText,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: tokens.space6,
  },
  back: {
    display: "inline-block",
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    textDecoration: "none",
    marginBottom: tokens.space5,
  },
  title: {
    fontSize: tokens.fontSizeXl,
    fontWeight: tokens.fontWeightBold,
    marginBottom: tokens.space2,
  },
  meta: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    marginBottom: tokens.space5,
  },
  player: {
    width: "100%",
    marginBottom: tokens.space5,
  },
  desc: {
    color: tokens.colorTextMuted,
    lineHeight: 1.8,
    whiteSpace: "pre-wrap",
  },
  notFound: {
    color: tokens.colorTextMuted,
    textAlign: "center",
    padding: tokens.space7,
  },
  actions: {
    display: "flex",
    gap: tokens.space3,
    marginBottom: tokens.space5,
  },
  actionBtn: {
    padding: `${tokens.space1} ${tokens.space4}`,
    borderRadius: tokens.radiusFull,
    border: `1px solid ${tokens.colorBorder}`,
    background: tokens.colorSurface,
    color: tokens.colorTextMuted,
    cursor: "pointer",
    fontSize: tokens.fontSizeSm,
  },
  actionActive: {
    borderColor: tokens.colorPrimary,
    color: tokens.colorPrimary,
  },
});

/** 收藏/点赞交互（客户端）：未登录点击 → 跳统一登录页（redirect 回当前单集页） */
function InteractButtons(props: { episodeId: string }) {
  const [fav, setFav] = createSignal(false);
  const [liked, setLiked] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const toggle = async (kind: "favorite" | "like") => {
    if (busy()) return;
    const res = await fetch(`/api/episodes/${props.episodeId}/${kind}`, { method: "POST" });
    if (res.status === 401) {
      // 未登录：跳统一登录页，登录后回当前页
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
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
        {liked() ? "♥ 已赞" : "♡ 点赞"}
      </button>
      <button
        {...stylex.props(styles.actionBtn, fav() && styles.actionActive)}
        onClick={() => toggle("favorite")}
      >
        {fav() ? "★ 已收藏" : "☆ 收藏"}
      </button>
    </div>
  );
}

export default function EpisodePage() {
  const params = useParams<{ id: string }>();
  const ep = createAsync(() => getEpisode(params.id));
  const audioUrl = () =>
    ep()?.audioUrl ? `${env.apiBaseUrl}/${ep()!.audioUrl}` : null;

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.content)}>
        <Show when={ep()} fallback={<div {...stylex.props(styles.notFound)}>节目不存在或未发布</div>}>
          <Title>{ep()!.title || "dailogues"}</Title>
          <a href={`/@${ep()!.username}`} {...stylex.props(styles.back)}>
            ← @{ep()!.username} 的频道
          </a>
          <div {...stylex.props(styles.title)}>{ep()!.title || "未命名节目"}</div>
          <div {...stylex.props(styles.meta)}>
            @{ep()!.username} · {new Date(ep()!.publishedAt ?? 0).toLocaleDateString("zh-CN")} ·{" "}
            {Math.floor((ep()!.durationSeconds ?? 0) / 60)} 分钟
          </div>
          <Show when={audioUrl()}>
            <audio controls src={audioUrl()!} {...stylex.props(styles.player)} />
          </Show>
          <InteractButtons episodeId={ep()!.id} />
          <div {...stylex.props(styles.desc)}>{ep()!.description || "（暂无简介）"}</div>
        </Show>
      </div>
    </div>
  );
}
