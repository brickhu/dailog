import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { api } from "../lib/client";
import { useI18n } from "@dailogues/i18n";
import { env } from "../lib/env";

export interface Episode {
  id: string;
  title: string | null;
  status: "draft" | "generating" | "published" | "failed";
  durationSeconds: number | null;
  /** 主题（脚本 topic 继承）+ 标签（大模型生成） */
  topic: string | null;
  tags: string[] | null;
  coverUrl: string | null;
  /** 最新生成 job 状态（queued/tts/merge/upload/done/failed；null = 从未生成） */
  jobStatus: string | null;
  jobError: string | null;
  createdAt: string;
}

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing8,
  },
  hero: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: dimensions.spacing6,
  },
  heroActions: {
    display: "flex",
    gap: dimensions.spacing3,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
  },
  card: {
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing3,
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    cursor: "pointer",
  },
  cover: {
    width: "52px",
    height: "52px",
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
    fontSize: dimensions.fontSizeXl,
    fontWeight: dimensions.fontWeightBold,
    color: "#fff",
    // 渐变占位（无封面图）：主题色系
    background: "linear-gradient(135deg, #6d5ae0 0%, #3fb68b 100%)",
  },
  cardMain: {
    minWidth: 0,
  },
  epTitle: {
    fontWeight: dimensions.fontWeightMedium,
    fontSize: dimensions.fontSizeMd,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  epMeta: {
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
  cardActions: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
  },
  viewLink: {
    color: colors.primary,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    ":hover": { textDecoration: "underline" },
  },
  badge: {
    padding: `2px ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusFull,
    fontSize: "12px",
    flexShrink: 0,
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
  extCard: {
    padding: dimensions.spacing6,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing6,
  },
  extTitle: {
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing2,
  },
  extStep: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.7,
    marginBottom: dimensions.spacing1,
  },
  placeholderRow: {
    display: "flex",
    gap: dimensions.spacing3,
    marginTop: dimensions.spacing6,
  },
  placeholder: {
    flex: 1,
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    border: `1px dashed ${colors.ink}`,
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textAlign: "center",
  },
  empty: {
    padding: dimensions.spacing12,
    textAlign: "center",
    color: colors.neutral,
    border: `1px dashed ${colors.ink}`,
    borderRadius: dimensions.radiusMd,
  },
  error: {
    color: colors.danger,
    marginBottom: dimensions.spacing3,
  },
});

export default function Dashboard() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [episodes, setEpisodes] = createSignal<Episode[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      setEpisodes(await api.get<Episode[]>("/v1/episodes"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("studio.loadFailed"));
    } finally {
      setLoading(false);
    }
  });

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.hero)}>
          <div {...stylex.props(styles.title)}>{t("studio.myEpisodes")}</div>
          <div {...stylex.props(styles.heroActions)}>
            <Button appear="ghost" onClick={() => navigate("/")}>{t("studio.importFromLink")}</Button>
            <Button onClick={() => navigate("/")}>{t("studio.startNew")}</Button>
          </div>
        </div>

        <Show when={error()}>
          <div {...stylex.props(styles.error)}>{error()}</div>
        </Show>

        <Show when={!loading() && episodes().length === 0}>
          <div {...stylex.props(styles.empty)}>
            还没有节目。粘贴 AI 对话分享链接（Claude / ChatGPT / DeepSeek / Gemini / Kimi / 豆包），第一期的内容就有了。
          </div>
        </Show>

        <For each={episodes()}>
          {(ep) => {
            // 展示状态：已发布 > 生成失败 > 生成中 > 未发布（episodes.status 只有 published 会被更新，其余看 job）
            const badge =
              ep.status === "published"
                ? { text: t("studio.episode.published"), cls: styles.badgePublished }
                : ep.jobStatus === "failed"
                  ? { text: t("studio.status.failed"), cls: styles.badgeFailed }
                  : ep.jobStatus && ["queued", "tts", "merge", "upload"].includes(ep.jobStatus)
                    ? { text: t("studio.status.generating"), cls: styles.badgeGenerating }
                    : { text: t("studio.episode.unpublished"), cls: styles.badgeUnpublished };
            return (
            <div
              {...stylex.props(styles.card)}
              onClick={() => navigate(`/episodes/${ep.id}`)}
              role="button"
            >
              {/* 封面：无封面图时用标题首字渐变占位 */}
              <Show
                when={ep.coverUrl}
                fallback={
                  <div {...stylex.props(styles.cover, styles.coverPlaceholder)}>
                    {(ep.title ?? "D").slice(0, 1).toUpperCase()}
                  </div>
                }
              >
                <img src={ep.coverUrl!} alt="" {...stylex.props(styles.cover, styles.coverImg)} />
              </Show>
              <div {...stylex.props(styles.cardMain)}>
                <div {...stylex.props(styles.epTitle)}>{ep.title || t("studio.unnamed")}</div>
                <div {...stylex.props(styles.epMeta)}>
                  {new Date(ep.createdAt).toLocaleDateString(locale() === "zh" ? "zh-CN" : "en-US")}
                  {ep.durationSeconds ? ` · ${t("studio.episodeDuration", { minutes: Math.max(1, Math.round(ep.durationSeconds / 60)) })}` : ""}
                </div>
                <Show when={ep.topic || (ep.tags && ep.tags.length > 0)}>
                  <div {...stylex.props(styles.tags)}>
                    <Show when={ep.topic}>
                      <span {...stylex.props(styles.tag)}>{ep.topic}</span>
                    </Show>
                    <For each={ep.tags ?? []}>
                      {(tag) => <span {...stylex.props(styles.tag)}>{tag}</span>}
                    </For>
                  </div>
                </Show>
              </div>
              <div {...stylex.props(styles.cardActions)}>
                <span {...stylex.props(styles.badge, badge.cls)}>{badge.text}</span>
                <Show when={ep.status === "published"}>
                  <a
                    href={`${env.siteBaseUrl}/episode/${ep.id}`}
                    target="_blank"
                    rel="noopener"
                    onClick={(e) => e.stopPropagation()}
                    {...stylex.props(styles.viewLink)}
                  >
                    {t("studio.episodeView")} →
                  </a>
                </Show>
              </div>
            </div>
            );
          }}
        </For>

        <div {...stylex.props(styles.placeholderRow)}>
          <div {...stylex.props(styles.placeholder)}>{t("studio.subscribePro")}</div>
        </div>
      </div>
    </div>
  );
}
