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
  createdAt: string;
}

const STATUS_LABEL: Record<Episode["status"], { textKey: string; color: string }> = {
  draft: { textKey: "studio.status.draft", color: "#8b95a7" },
  generating: { textKey: "studio.status.generating", color: "#e0a23c" },
  published: { textKey: "studio.status.published", color: "#3fb68b" },
  failed: { textKey: "studio.status.failed", color: "#f0506e" },
};

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
    justifyContent: "space-between",
    gap: dimensions.spacing3,
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
            <Button onClick={() => navigate("/episodes/new")}>{t("studio.startNew")}</Button>
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
            const status = STATUS_LABEL[ep.status] ?? STATUS_LABEL.draft;
            return (
              <div {...stylex.props(styles.card)}>
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
                  <span
                    {...stylex.props(styles.badge)}
                    style={{ background: `${status.color}22`, color: status.color }}
                  >
                    {t(status.textKey as never)}
                  </span>
                  <Show when={ep.status === "published"}>
                    <a
                      href={`${env.siteBaseUrl}/episode/${ep.id}`}
                      target="_blank"
                      rel="noopener"
                      {...stylex.props(styles.viewLink)}
                    >
                      {t("studio.episodeView")}
                    </a>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>

        <div {...stylex.props(styles.placeholderRow)}>
          <div {...stylex.props(styles.placeholder)}>{t("studio.inviteFriends")}</div>
          <div {...stylex.props(styles.placeholder)}>{t("studio.subscribePro")}</div>
        </div>
      </div>
    </div>
  );
}
