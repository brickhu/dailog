// 节目详情面板（首页详情态 + /<episode_id> 直链复用）：
// 标题/主持人/日期时长/播放统计/简介/台本（折叠）/原始对话/点赞收藏
import { For, Show, createEffect, createResource, createSignal, onCleanup } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { apiBaseForFetch } from "../lib/env";
import { usePlayback, type QueueEpisode } from "../lib/playback";
import { getPlaylistsByEpisode } from "../lib/db";
import { InteractButtons } from "./interact-buttons";
import { ShareButton } from "./share-buttons";
import { fetchFavoriteStatus, setFavorite } from "../lib/favorites";
import { fmtDate, fmtDuration } from "../lib/format";

const styles = stylex.create({
  favBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusSm,
    backgroundColor: "transparent",
    color: colors.neutral,
    border: "1px solid",
    borderColor: colors.ink,
    cursor: "pointer",
    fontSize: dimensions.fontSizeSm,
  },
  favActive: {
    color: colors.brand,
    borderColor: colors.brand,
  },
  root: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing4,
    height: "100%",
    overflowY: "auto",
    paddingRight: dimensions.spacing2,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
    lineHeight: 1.3,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  desc: {
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.7,
    margin: 0,
    whiteSpace: "pre-wrap",
  },
  summary: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeMd,
    margin: 0,
    lineHeight: 1.6,
  },
  refsSection: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
  },
  refsLabel: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
  },
  refItem: {
    fontSize: dimensions.fontSizeSm,
    color: colors.foreground,
    lineHeight: 1.6,
  },
  refLink: {
    color: colors.brand,
    textDecoration: "none",
    overflowWrap: "anywhere",
  },
  source: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    ":hover": { color: colors.primary },
  },
  transcriptBtn: {
    alignSelf: "flex-start",
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusFull,
    background: "transparent",
    color: colors.foreground,
    fontSize: dimensions.fontSizeSm,
    cursor: "pointer",
  },
  transcript: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    lineHeight: 1.8,
    whiteSpace: "pre-wrap",
    paddingLeft: dimensions.spacing3,
    margin: 0,
  },
  noDesc: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  // 组件级骨架：统计行加载中占位（小灰条 + 脉冲）
  statsSkeleton: {
    display: "inline-block",
    width: "120px",
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

export function EpisodeDetail(props: { episode: QueueEpisode }) {
  const { t } = useI18n();
  const ep = () => props.episode;
  const hostName = () => ep().callName ?? ep().displayName ?? ep().username;
  const [showTranscript, setShowTranscript] = createSignal(false);
  // 台本 = scripts/{submissionId}.json 引用：展开时拉取公开端点 → 解析 segments → 去情绪标签
  const [transcriptText, setTranscriptText] = createSignal<string | null>(null);
  createEffect(() => {
    if (!showTranscript()) return;
    const ref = ep().transcript;
    if (!ref) return;
    const m = /^scripts\/([0-9a-f-]+)\.json$/.exec(ref);
    if (!m) { setTranscriptText(null); return; }
    const sid = m[1];
    let cancelled = false;
    fetch(`${apiBaseForFetch}/v1/public/scripts/${encodeURIComponent(sid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const scripts = (data && data.scripts) || [];
        const segs = (scripts[0] && scripts[0].segments) || [];
        if (!segs.length) { setTranscriptText(null); return; }
        const text = segs
          .map((s: { speaker?: string; text?: unknown }) => `${s.speaker === "guest" ? "嘉宾" : "主持人"}：${String(s.text || "").replace(/\[[^\]]*\]/g, "").trim()}`)
          .join("\n");
        setTranscriptText(text);
      })
      .catch(() => { if (!cancelled) setTranscriptText(null); });
    onCleanup(() => { cancelled = true; });
  });
  // 播放/完播统计（0036 恢复）：createResource 独立加载；likes 计数由 InteractButtons 复用 stats
  const [stats, { refetch: refetchStats }] = createResource(
    () => ep().id,
    async (id) => {
      const r = await fetch(`${apiBaseForFetch}/v1/public/episodes/${id}/stats`);
      return r.ok ? ((await r.json()) as { plays: number; completions: number; likes?: number }) : null;
    },
  );
  // 本集开始播放 → 重新拉取统计（play 上报后数字即时刷新，无需手动刷新页面）；
  // 暂停续播重复触发时 refetch 幂等（同一 session 已去重，计数不叠加）
  // 延后 ~600ms 再拉取：reportStat 是 fire-and-forget 的 POST，立即 refetch 可能抢在
  // 上报落库前读到旧值（显示仍是 0）；短暂延迟让上报先到达
  const { current: pbCurrent, playing } = usePlayback();
  createEffect(() => {
    const cur = pbCurrent();
    if (cur?.id === ep().id && playing()) {
      const timer = setTimeout(() => void refetchStats(), 600);
      onCleanup(() => clearTimeout(timer));
    }
  });
  // 收录于哪些公开播放列表（「收录于」反查——服务端函数 RPC）
  const [inPlaylists] = createResource(
    () => ep().id,
    (id) => getPlaylistsByEpisode(id).catch(() => []),
  );
  // 收藏（共享函数；登录态端点 SSR 401 → 客户端 hydration 后加载）——与详情页同模式
  const navigate = useNavigate();
  const [fav, { refetch: refetchFav }] = createResource(
    () => (typeof window === "undefined" ? null : ep().id),
    (id) => fetchFavoriteStatus(id),
  );
  const favorited = () => !!fav.latest?.contains;
  const [busyFav, setBusyFav] = createSignal(false);
  const toggleFavorite = async () => {
    if (busyFav()) return;
    setBusyFav(true);
    try {
      const res = await setFavorite(ep().id, favorited());
      if (res.status === 401) {
        navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (res.ok) refetchFav();
    } finally {
      setBusyFav(false);
    }
  };

  return (
    <div {...stylex.props(styles.root)}>
      <h1 {...stylex.props(styles.title)}>{ep().title || t("common.unnamed")}</h1>
      <Show when={ep().summary}>
        <p {...stylex.props(styles.summary)}>{ep().summary}</p>
      </Show>
      <p {...stylex.props(styles.meta)}>
        {(() => {
          const pub = ep().publishedAt;
          return `${hostName()} · ${pub ? fmtDate(pub) : ""}${ep().durationSeconds ? ` · ${fmtDuration(ep().durationSeconds, true)}` : ""}`;
        })()}
      </p>
      {/* 统计行：播放/完播次数（组件级骨架；0036 恢复） */}
      <Show when={!stats.loading} fallback={<span {...stylex.props(styles.statsSkeleton)} />}>
        <Show when={stats()}>
          <p {...stylex.props(styles.meta)}>
            {t("episode.plays", { count: stats()!.plays })} · {t("episode.completions", { count: stats()!.completions })}
          </p>
        </Show>
      </Show>
      <InteractButtons episodeId={ep().id} counts={stats()} />
      <div style={{ display: "flex", "align-items": "center", gap: "8px", "flex-wrap": "wrap" }}>
        <button type="button" {...stylex.props(styles.favBtn, favorited() && styles.favActive)} disabled={busyFav()} onClick={toggleFavorite}>
          {favorited() ? t("favorite.added") : t("favorite.add")}
        </button>
        <ShareButton episode={ep()} />
      </div>
      {/* 收录于：公开播放列表反查 */}
      <Show when={inPlaylists() && inPlaylists()!.length > 0}>
        <p {...stylex.props(styles.meta)}>
          {t("playlist.in")}{" "}
          <For each={inPlaylists()}>
            {(pl, i) => (
              <>
                {i() > 0 ? "、" : ""}
                <A href={`/playlist/${pl.slug}`} style={{ color: colors.primary, "text-decoration": "none" }}>「{pl.title}」</A>
              </>
            )}
          </For>
        </p>
      </Show>
      <Show when={ep().description} fallback={<p {...stylex.props(styles.noDesc)}>{t("episode.noDescription")}</p>}>
        <p {...stylex.props(styles.desc)}>{ep().description}</p>
      </Show>
      <Show when={ep().references && ep().references.length > 0}>
        <div {...stylex.props(styles.refsSection)}>
          <p {...stylex.props(styles.refsLabel)}>{t("episode.references")}</p>
          <For each={ep().references}>
            {(r) => (
              <div {...stylex.props(styles.refItem)}>
                <strong>{r.term}</strong>
                {r.type ? `（${r.type}）` : ""}：{r.explanation}
                {r.links && r.links.length > 0 ? (
                  <span>{" "}
                    <For each={r.links}>
                      {(l) => (
                        <a href={l} target="_blank" rel="noopener noreferrer" {...stylex.props(styles.refLink)}>{l}</a>
                      )}
                    </For>
                  </span>
                ) : null}
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={ep().sourceUrl}>
        <a href={ep().sourceUrl!} target="_blank" rel="noopener noreferrer" {...stylex.props(styles.source)}>
          {t("episode.sourceUrl")} ↗ {ep().sourceUrl}
        </a>
      </Show>
      <Show when={ep().transcript}>
        <button {...stylex.props(styles.transcriptBtn)} onClick={() => setShowTranscript((v) => !v)}>
          {showTranscript() ? t("common.cancel") : t("episode.transcript")}
        </button>
        <Show when={showTranscript() && transcriptText() !== null}>
          <p {...stylex.props(styles.transcript)}>{transcriptText()}</p>
        </Show>
        <Show when={showTranscript() && transcriptText() === null}>
          <p {...stylex.props(styles.transcript)}>…</p>
        </Show>
      </Show>
    </div>
  );
}