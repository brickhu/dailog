import { createSignal, For, onMount, Show } from "solid-js";
import GenerateProgress from "../components/generate-progress";
import { useNavigate, useParams } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { api } from "../lib/client";
import { ApiError } from "../lib/api";
import { useI18n } from "@dailogues/i18n";
import { env } from "../lib/env";

// /episodes/:id 节目详情：封面/标题/状态/时长/标签/描述 + 试听 + 发布/发布页链接/编辑脚本。

export interface JobInfo {
  id: string;
  status: "queued" | "tts" | "merge" | "upload" | "done" | "failed";
  progress: number;
  error: string | null;
}

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
  badgeGenerating: {
    backgroundColor: "#fef3c7",
    color: "#92400e",
  },
  badgeFailed: {
    backgroundColor: "#fde8ec",
    color: "#c81e3f",
  },
  failBox: {
    border: `1px solid ${colors.danger}`,
    borderRadius: dimensions.radiusMd,
    padding: dimensions.spacing4,
    marginBottom: dimensions.spacing4,
    backgroundColor: colors.surface,
  },
  failTitle: {
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing1,
  },
  failReason: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    fontFamily: "monospace",
    marginBottom: dimensions.spacing3,
    wordBreak: "break-all",
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
  const [job, setJob] = createSignal<JobInfo | null>(null);
  /** 生成中（进行中 job 或刚点击重新生成）：挂 GenerateProgress 轮询 */
  const [running, setRunning] = createSignal(false);

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

  const loadJob = async () => {
    try {
      const j = await api.get<JobInfo>(`/v1/episodes/${episodeId}/job`);
      setJob(j);
      if (["queued", "tts", "merge", "upload"].includes(j.status)) setRunning(true);
    } catch {
      // 无 job（未生成过）：保持现状
    }
  };

  /** 试听：仅当生成完成（job done，音轨必已落库）才请求音频——避免对失败/未生成节目发无谓的 404 请求 */
  const loadAudio = async () => {
    if (job()?.status !== "done") return;
    try {
      const res = await api.request(`/v1/episodes/${episodeId}/audio`);
      if (!res.ok) return;
      const blob = await res.blob();
      setAudioUrl(URL.createObjectURL(blob));
    } catch {
      // 音频加载失败：试听区保持隐藏
    }
  };

  /** 重新生成（失败/中断的节目重跑管线；不重复扣配额） */
  const retry = async () => {
    setError(null);
    try {
      const res = await api.request(`/v1/episodes/${episodeId}/retry`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
        setError(body?.detail ?? body?.error ?? "retry failed");
        return;
      }
      setJob(null);
      setRunning(true);
    } catch (e) {
      if (e instanceof ApiError && e.code === "job_running") {
        setRunning(true); // 已有进行中 job：直接轮询
        return;
      }
      setError(e instanceof Error ? e.message : t("studio.generateFailed"));
    }
  };

  onMount(async () => {
    await load();
    await loadJob();
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
  /** 状态徽标：已发布 / 生成中 / 生成失败 / 未发布 */
  const badge = () => {
    if (published()) return { text: t("studio.episode.published"), cls: styles.badgePublished };
    const j = job();
    if (j?.status === "failed") return { text: t("studio.status.failed"), cls: styles.badgeFailed };
    if (j && ["queued", "tts", "merge", "upload"].includes(j.status)) {
      return { text: t("studio.status.generating"), cls: styles.badgeGenerating };
    }
    return { text: t("studio.episode.unpublished"), cls: styles.badgeUnpublished };
  };

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
            <span {...stylex.props(styles.badge, badge().cls)}>{badge().text}</span>
          </div>

          {/* 生成失败：原因 + 重新生成 */}
          <Show when={job()?.status === "failed" && !running()}>
            <div {...stylex.props(styles.failBox)}>
              <div {...stylex.props(styles.failTitle)}>{t("studio.status.failed")}</div>
              <div {...stylex.props(styles.failReason)}>{job()!.error ?? t("studio.generate.unknown")}</div>
              <div {...stylex.props(styles.actions)}>
                <Button onClick={retry}>{t("studio.episode.retry")}</Button>
              </div>
            </div>
          </Show>

          {/* 生成中：进度 + 试听（复用生成进度组件） */}
          <Show when={running()}>
            <GenerateProgress
              episodeId={episodeId}
              onDone={() => {
                setRunning(false);
                void load();
                void loadJob();
                void loadAudio();
              }}
              onFailed={(msg) => {
                setRunning(false);
                void loadJob();
                setError(`生成失败：${msg}`);
              }}
              onQuotaDenied={() => setError(t("studio.quota"))}
            />
          </Show>

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
