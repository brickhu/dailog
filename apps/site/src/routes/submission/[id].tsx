// 投稿详情页（/submissions/<id>）：当前用户单条投稿的状态/来源/节目信息
import { A, createAsync, useParams } from "@solidjs/router";
import { Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { apiBaseForFetch } from "../../lib/env";


interface SubmissionDetail {
  id: string;
  url: string;
  title: string | null;
  status: string;
  createdAt: string;
  episode: {
    id: string;
    slug: string;
    title: string | null;
    number: number | null;
    coverUrl: string | null;
    status: string;
  } | null;
}

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: dimensions.radiusLg,
    padding: dimensions.spacing6,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing4,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    flexWrap: "wrap",
  },
  title: {
    fontSize: dimensions.fontSizeXl,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
  },
  badge: {
    padding: `2px ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusFull,
    fontSize: dimensions.fontSizeXs,
    fontWeight: dimensions.fontWeightMedium,
    backgroundColor: colors.surfaceStrong,
    color: colors.foreground,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
    lineHeight: 1.7,
    wordBreak: "break-all",
  },
  reason: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  episode: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dimensions.spacing3,
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.background,
    flexWrap: "wrap",
  },
  episodeTitle: {
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
  },
  notFound: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
});

function SubmissionDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const data = createAsync<SubmissionDetail | null>(async () => {
    // 服务端用 API 基址直取（公开端点，序列化给客户端复用）；客户端同源代理
    const base = typeof window === "undefined" ? apiBaseForFetch : "";
    const res = await fetch(`${base}/v1/public/submissions/${params.id}`);
    if (!res.ok) return null;
    return (await res.json()) as SubmissionDetail;
  });

  const STATUS_KEYS: Record<string, Parameters<typeof t>[0]> = {
    submitted: "status.submitted",
    rejected: "status.rejected",
    published: "status.published",
    accepted: "status.accepted",
    generating: "status.generating",
    failed: "status.failed",
  };
  const statusLabel = (status: string | null) => {
    if (!status) return "";
    const key = STATUS_KEYS[status];
    return key ? t(key) : status;
  };

  return (
    <div {...stylex.props(layouts.page)}>
      <div {...stylex.props(layouts.containerSm)}>
        <Title>{data()?.title || t("common.unnamed")} · dailog</Title>
        <Show when={data()} fallback={<div {...stylex.props(styles.notFound)}>{t("common.empty")}</div>}>
          {(d) => (
            <div {...stylex.props(styles.card)}>
              <div {...stylex.props(styles.titleRow)}>
                <p {...stylex.props(styles.title)}>{d().title || t("common.unnamed")}</p>
                <span {...stylex.props(styles.badge)}>{statusLabel(d().status)}</span>
              </div>
              <Show when={d().episode}>
                {(ep) => (
                  <div {...stylex.props(styles.episode)}>
                    <div>
                      <p {...stylex.props(styles.episodeTitle)}>
                        {t("submission.episodeTitle")} #{ep().number ?? ""} · {ep().title || t("common.unnamed")}
                      </p>
                      <Show
                        when={ep().status === "published"}
                        fallback={
                          <p {...stylex.props(styles.meta)}>
                            {ep().status === "failed"
                              ? t("submission.episodeFailed")
                              : t("submission.episodeInProgress")}
                          </p>
                        }
                      >
                        <A href={`/episode/${ep().slug}`} {...stylex.props(styles.meta)}>
                          {t("submission.viewEpisode")} →
                        </A>
                      </Show>
                    </div>
                  </div>
                )}
              </Show>
              <p {...stylex.props(styles.meta)}>
                {t("submission.submittedAt")}：{d().createdAt ? new Date(d().createdAt).toLocaleDateString("zh-CN") : ""}
              </p>
              <p {...stylex.props(styles.meta)}>
                {t("submission.sourceUrl")}：{" "}
                <a href={d().url} target="_blank" rel="noopener" style={{ color: "inherit", "text-decoration": "underline" }}>
                  {d().url}
                </a>
              </p>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}

export default function SubmissionDetailRoute() {
  return <SubmissionDetailPage />;
}
