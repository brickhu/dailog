import { createResource, For, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { api } from "../lib/client";

// 概览（/）：审核 / 语音生成 / 节目发布 三组概要计数，点击进入对应列表
// 数据源：GET /v1/editor/overview

interface OverviewStats {
  reviews: { submitted: number; accepted: number; rejected: number };
  scripts: { pending: number; generated: number; failed: number };
  episodes: { published: number; failed: number };
}

const styles = stylex.create({
  page: { maxWidth: "860px", margin: "0 auto", padding: dimensions.spacing8, display: "flex", flexDirection: "column", gap: dimensions.spacing5 },
  title: { fontSize: dimensions.fontSize2xl, fontWeight: dimensions.fontWeightBold, margin: 0 },
  grid: { display: "flex", flexDirection: "column", gap: dimensions.spacing4 },
  card: {
    padding: dimensions.spacing5,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
  },
  cardTitle: { fontSize: dimensions.fontSizeLg, fontWeight: dimensions.fontWeightMedium, margin: 0 },
  rows: { display: "flex", flexDirection: "column", gap: dimensions.spacing2 },
  link: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusSm,
    border: `1px solid ${colors.ink}`,
    textDecoration: "none",
    color: "inherit",
    fontSize: dimensions.fontSizeMd,
    ":hover": {
      borderColor: colors.brandStrong,
    },
  },
  count: { fontWeight: dimensions.fontWeightBold, color: colors.brandStrong },
  enter: { color: colors.neutral, fontSize: dimensions.fontSizeSm },
  empty: { color: colors.neutral, textAlign: "center", padding: dimensions.spacing12 },
});

interface Row { key: string; label: string; count: number; href: string; }

export default function OverviewPage() {
  const { t } = useI18n();
  const [stats] = createResource<OverviewStats | null>(async () => {
    try {
      return await api.get<OverviewStats>("/v1/editor/overview");
    } catch {
      return null;
    }
  });

  const rows = () => {
    const s = stats();
    if (!s) return [];
    return [
      { section: "admin.overviewReviews", rows: [
        { key: "submitted", label: t("admin.pendingReviews", { n: s.reviews.submitted }), count: s.reviews.submitted, href: "/reviews" },
        { key: "accepted", label: t("admin.acceptedReviews", { n: s.reviews.accepted }), count: s.reviews.accepted, href: "/reviews?status=accepted" },
        { key: "rejected", label: t("admin.rejectedReviews", { n: s.reviews.rejected }), count: s.reviews.rejected, href: "/reviews?status=rejected" },
      ] as Row[] },
      { section: "admin.overviewVoice", rows: [
        { key: "pending", label: t("admin.pendingScripts", { n: s.scripts.pending }), count: s.scripts.pending, href: "/generates" },
        { key: "generated", label: t("admin.generatedScripts", { n: s.scripts.generated }), count: s.scripts.generated, href: "/generates" },
        { key: "failed", label: t("admin.failedScripts", { n: s.scripts.failed }), count: s.scripts.failed, href: "/generates" },
      ] as Row[] },
      { section: "admin.overviewPublish", rows: [
        { key: "published", label: t("admin.publishedEpisodesN", { n: s.episodes.published }), count: s.episodes.published, href: "/episodes" },
        { key: "failed", label: t("admin.failedEpisodesN", { n: s.episodes.failed }), count: s.episodes.failed, href: "/episodes" },
      ] as Row[] },
    ];
  };

  return (
    <div {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>{t("admin.overview")}</h1>
      <Show when={stats()?.reviews} fallback={<div {...stylex.props(styles.empty)}>{t("admin.loading")}</div>}>
        <div {...stylex.props(styles.grid)}>
          <For each={rows()}>
            {(section) => (
              <div {...stylex.props(styles.card)}>
                <p {...stylex.props(styles.cardTitle)}>{t(section.section as never)}</p>
                <div {...stylex.props(styles.rows)}>
                  <For each={section.rows}>
                    {(row) => (
                      <a href={row.href} {...stylex.props(styles.link)}>
                        <span>{row.label}</span>
                        <span {...stylex.props(styles.enter)}>{t("admin.enterList")}</span>
                      </a>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
