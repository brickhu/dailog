import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { api } from "../lib/client";
import { useI18n } from "@dailogues/i18n";
import { env } from "../lib/env";

// /episodes/:id 节目详情：封面/标题/状态/时长/标签/描述 + 试听 + 发布/发布页链接/编辑脚本。

interface EpisodeDetail {
  id: string;
  transcriptId: string;
  polishId: string;
  title: string | null;
  description: string | null;
  status: "generating" | "published" | "failed" | string;
  durationSeconds: number | null;
  topic: string | null;
  tags: string[] | null;
  coverUrl: string | null;
  createdAt: string;
  publishedAt: string | null;
}

const styles = stylex.create({
  page: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing6,
    color: colors.foreground,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    marginBottom: dimensions.spacing5,
  },
  backLink: {
    color: colors.primary,
    fontSize: dimensions.fontSizeMd,
    cursor: "pointer",
    textDecoration: "none",
  },
  card: {
    padding: dimensions.spacing5,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
  },
  topRow: {
    display: "flex",
    gap: dimensions.spacing4,
    marginBottom: dimensions.spacing4,
  },
  cover: {
    width: "88px",
    height: "88px",
    borderRadius: dimensions.radiusMd,
    flexShrink: 0,
    objectFit: "cover",
  },
  coverImg: {
    display: "block",
  },
  coverPlaceholder: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    color: "#fff",
    background: "linear-gradient(135deg, #6d5ae0 0%, #3fb68b 100%)",
  },
  main: {
    minWidth: 0,
    flex: 1,
  },
  epTitle: {
    fontWeight: dimensions.fontWeightBold,
    fontSize: dimensions.fontSizeXl,
    marginBottom: dimensions.spacing1,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing1,
  },
  tags: {
    display: "flex",
    flexWrap: "wrap",
    gap: dimensions.spacing1,
    marginTop: dimensions.spacing2,
  },
  tag: {
    fontSize: "12px",
    color: colors.primary,
    background: `${colors.primary}14`,
    border: `1px solid ${colors.primary}33`,
    borderRadius: "999px",
    padding: "2px 10px",
  },
  badge: {
    padding: `2px ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusFull,
    fontSize: "12px",
    flexShrink: 0,
    alignSelf: "flex-start",
  },
  badgePublished: {
    backgroundColor: "#dcfce7",
    color: "#166534",
  },
  badgeUnpublished: {
    backgroundColor: colors.surfaceWeak,
    color: colors.neutralWeak,
  },
  desc: {
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.7,
    marginBottom: dimensions.spacing4,
    whiteSpace: "pre-wrap",
  },
  audioBox: {
    marginBottom: dimensions.spacing4,
  },
  audioLabel: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing2,
  },
  audio: {
    width: "100%",
  },
  actions: {
    display: "flex",
    gap: dimensions.spacing3,
    marginTop: dimensions.spacing4,
  },
  link: {
    color: colors.primary,
    fontSize: dimensions.fontSizeMd,
    textDecoration: "none",
    ":hover": { textDecoration: "underline" },
  },
  error: {
    color: colors.danger,
    marginBottom: dimensions.spacing3,
  },
});

export default function EpisodeDetailPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const params = useParams();
  const episodeId = typeof params.id === "string" ? params.id : "";
  const [ep, setEp] = createSignal<EpisodeDetail | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [audioUrl, setAudioUrl] = createSignal<string | null>(null);
  const [publishBusy, setPublishBusy] = createSignal(false);

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.get<EpisodeDetail>(`/v1/episodes/${episodeId}`);
      setEp(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("studio.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  /** 试听：音频在 tracks（多语言音轨）——接口按归属流式返回；无音频 404 隐藏 */
  const loadAudio = async () => {
    try {
      const res = await api.request(`/v1/episodes/${episodeId}/audio`);
      if (!res.ok) return;
      const blob = await res.blob();
      setAudioUrl(URL.createObjectURL(blob));
    } catch {
      // 生成中/无音轨：试听区隐藏
    }
  };

  onMount(async () => {
    await load();
    await loadAudio();
  });

  const publish = async () => {
    setPublishBusy(true);
    try {
      await api.post(`/v1/episodes/${episodeId}/publish`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("studio.publishFailed"));
    } finally {
      setPublishBusy(false);
    }
  };

  const published = () => ep()?.status === "published";

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.header)}>
        <a {...stylex.props(styles.backLink)} onClick={() => navigate("/episodes")}>
          ← {t("studio.myEpisodes")}
        </a>
      </div>

      <Show when={error() && !loading()}>
        <div {...stylex.props(styles.error)}>{error()}</div>
      </Show>
      <Show when={loading()}>
        <div {...stylex.props(styles.meta)}>{t("common.loading")}</div>
      </Show>

      <Show when={!loading() && ep()}>
        <div {...stylex.props(styles.card)}>
          <div {...stylex.props(styles.topRow)}>
            <Show
              when={ep()!.coverUrl}
              fallback={
                <div {...stylex.props(styles.cover, styles.coverPlaceholder)}>
                  {(ep()!.title ?? "D").slice(0, 1).toUpperCase()}
                </div>
              }
            >
              <img src={ep()!.coverUrl!} alt="" {...stylex.props(styles.cover, styles.coverImg)} />
            </Show>
            <div {...stylex.props(styles.main)}>
              <div {...stylex.props(styles.epTitle)}>{ep()!.title || t("studio.unnamed")}</div>
              <div {...stylex.props(styles.meta)}>
                {new Date(ep()!.createdAt).toLocaleDateString(locale() === "zh" ? "zh-CN" : "en-US")}
                {ep()!.durationSeconds
                  ? ` · ${t("studio.episodeDuration", { minutes: Math.max(1, Math.round((ep()!.durationSeconds ?? 0) / 60)) })}`
                  : ""}
              </div>
              <Show when={ep()!.topic || ((ep()!.tags?.length ?? 0) > 0)}>
                <div {...stylex.props(styles.tags)}>
                  <Show when={ep()!.topic}>
                    <span {...stylex.props(styles.tag)}>{ep()!.topic}</span>
                  </Show>
                  <For each={ep()!.tags ?? []}>
                    {(tag) => <span {...stylex.props(styles.tag)}>{tag}</span>}
                  </For>
                </div>
              </Show>
            </div>
            <span
              {...stylex.props(
                styles.badge,
                published() ? styles.badgePublished : styles.badgeUnpublished,
              )}
            >
              {published() ? t("studio.episode.published") : t("studio.episode.unpublished")}
            </span>
          </div>

          <Show when={ep()!.description}>
            <div {...stylex.props(styles.desc)}>{ep()!.description}</div>
          </Show>

          <Show when={audioUrl()}>
            <div {...stylex.props(styles.audioBox)}>
              <div {...stylex.props(styles.audioLabel)}>{t("studio.episode.audio")}</div>
              <audio controls src={audioUrl()!} {...stylex.props(styles.audio)} />
            </div>
          </Show>

          <div {...stylex.props(styles.actions)}>
            <Show
              when={!published()}
              fallback={
                <a
                  href={`${env.siteBaseUrl}/episode/${ep()!.id}`}
                  target="_blank"
                  rel="noopener"
                  {...stylex.props(styles.link)}
                >
                  {t("studio.episodeView")} →
                </a>
              }
            >
              <Button onClick={publish} disabled={publishBusy()}>
                {publishBusy() ? t("studio.editor.publishing") : t("studio.editor.publish")}
              </Button>
            </Show>
            <a
              {...stylex.props(styles.link)}
              onClick={() => navigate(`/polish/${ep()!.polishId}?script=${ep()!.transcriptId}`)}
            >
              {t("studio.episode.editScript")} →
            </a>
          </div>
        </div>
      </Show>
    </div>
  );
}
