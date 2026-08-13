import { createAsync } from "@solidjs/router";
import { createSignal, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import { getEpisode } from "../../lib/db";
import { SiteNav } from "../../components/site-nav";
import { env, episodeCoverUrl } from "../../lib/env";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

// 单集页：/episode/:id（播放器 + 元信息；点赞/收藏按钮 Task 4）
const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing8,
  },
  back: {
    display: "inline-block",
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    marginBottom: dimensions.spacing6,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing2,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing6,
  },
  cover: {
    width: "100%",
    maxWidth: "360px",
    borderRadius: dimensions.radiusMd,
    aspectRatio: "1 / 1",
    objectFit: "cover",
    marginBottom: dimensions.spacing4,
  },
  player: {
    width: "100%",
    marginBottom: dimensions.spacing6,
  },
  desc: {
    color: colors.neutral,
    lineHeight: 1.8,
    whiteSpace: "pre-wrap",
  },
  source: {
    display: "block",
    marginTop: dimensions.spacing6,
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    ":hover": { color: colors.primary },
  },
  notFound: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
  actions: {
    display: "flex",
    gap: dimensions.spacing3,
    marginBottom: dimensions.spacing6,
  },
  actionBtn: {
    padding: `${dimensions.spacing1} ${dimensions.spacing4}`,
    borderRadius: dimensions.radiusFull,
    border: `1px solid ${colors.ink}`,
    backgroundColor: colors.surface,
    color: colors.neutral,
    cursor: "pointer",
    fontSize: dimensions.fontSizeSm,
  },
  actionActive: {
    borderColor: colors.primary,
    color: colors.primary,
  },
});

/** 收藏/点赞交互（客户端）：未登录点击 → 跳统一登录页（redirect 回当前单集页） */
function InteractButtons(props: { episodeId: string }) {
  const { t } = useI18n();
  const [fav, setFav] = createSignal(false);
  const [liked, setLiked] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const toggle = async (kind: "favorite" | "like") => {
    if (busy()) return;
    const res = await fetch(`/v1/episodes/${props.episodeId}/${kind}`, { method: "POST" });
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

export default function EpisodePage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const ep = createAsync(() => getEpisode(params.id));
  // 公开音频端点（免鉴权）：音频在 tracks（storage key 不是 API 路径，不能直接拼 baseUrl）
  // 浏览器端用 apiBaseUrlPublic（https 页面加载 http 音频 = mixed content 被拦；未配置时回退 apiBaseUrl）
  const audioUrl = () =>
    ep() ? `${env.apiBaseUrlPublic ?? env.apiBaseUrl}/v1/public/episodes/${params.id}/audio` : null;

  return (
    <div {...stylex.props(styles.page)}>
      <SiteNav />
      <div {...stylex.props(styles.content)}>
        <Show when={ep()} fallback={<div {...stylex.props(styles.notFound)}>{t("episode.notFound")}</div>}>
          <Title>{ep()!.title || "dailog"}</Title>
          <a href={`/@${ep()!.username}`} {...stylex.props(styles.back)}>
            ← @{ep()!.username} 的频道
          </a>
          <Show when={episodeCoverUrl(ep()!.id, ep()!.coverUrl)}>
            <img src={episodeCoverUrl(ep()!.id, ep()!.coverUrl)!} alt={ep()!.title || ""} {...stylex.props(styles.cover)} />
          </Show>
          <div {...stylex.props(styles.title)}>{ep()!.title || t("common.unnamed")}</div>
          <div {...stylex.props(styles.meta)}>
            {ep()!.callName ?? ep()!.displayName ?? ep()!.username} · {new Date(ep()!.publishedAt ?? 0).toLocaleDateString("zh-CN")} ·{" "}
            {Math.floor((ep()!.durationSeconds ?? 0) / 60)} 分钟
          </div>
          <Show when={audioUrl()}>
            <audio controls src={audioUrl()!} {...stylex.props(styles.player)} />
          </Show>
          <InteractButtons episodeId={ep()!.id} />
          <div {...stylex.props(styles.desc)}>{ep()!.description || t("episode.noDescription")}</div>
          <Show when={ep()!.sourceUrl}>
            <a href={ep()!.sourceUrl!} target="_blank" rel="noopener noreferrer" {...stylex.props(styles.source)}>
              {t("episode.sourceUrl")} ↗ {ep()!.sourceUrl}
            </a>
          </Show>
        </Show>
      </div>
    </div>
  );
}
