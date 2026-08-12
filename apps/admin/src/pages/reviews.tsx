import { createResource, createSignal, For, Show } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { api } from "../lib/client";

// 审核列表（/reviews）：待审核（默认，先到先审）/ 审核通过 / 审核未通过
// 数据源：GET /v1/editor/queue?status=...

interface QueueItem {
  id: string;
  title: string | null;
  snapshotTitle: string | null;
  platform: string | null;
  status: string;
  createdAt: string;
}

const TABS = ["submitted", "accepted", "rejected"] as const;
type Tab = (typeof TABS)[number];

const styles = stylex.create({
  page: { maxWidth: "860px", margin: "0 auto", padding: dimensions.spacing8 },
  title: { fontSize: dimensions.fontSize2xl, fontWeight: dimensions.fontWeightBold, margin: 0 },
  tabs: { display: "flex", gap: dimensions.spacing2, marginBottom: dimensions.spacing5, borderBottom: `1px solid ${colors.ink}` },
  tab: {
    padding: `${dimensions.spacing2} ${dimensions.spacing4}`,
    fontSize: dimensions.fontSizeMd,
    color: colors.neutral,
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    cursor: "pointer",
  },
  tabActive: { color: colors.foreground, fontWeight: dimensions.fontWeightMedium, borderBottomColor: colors.brand },
  card: {
    display: "block",
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing3,
    textDecoration: "none",
    color: "inherit",
  },
  itemTitle: { fontWeight: dimensions.fontWeightMedium, marginBottom: dimensions.spacing1 },
  meta: { color: colors.neutral, fontSize: dimensions.fontSizeSm },
  badge: {
    display: "inline-block",
    marginLeft: dimensions.spacing2,
    padding: `${dimensions.spacing1} ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.surfaceStrong,
    fontSize: dimensions.fontSizeSm,
  },
  empty: { color: colors.neutral, textAlign: "center", padding: dimensions.spacing12 },
});

export default function ReviewsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = createSignal<Tab>((params.status as Tab) ?? "submitted");
  const [items] = createResource(tab, async (status: Tab) => {
    try {
      const res = await api.get<{ items: QueueItem[] }>(`/v1/editor/queue?status=${status}`);
      return res.items;
    } catch {
      return [];
    }
  });

  const switchTab = (key: Tab) => {
    setTab(key);
    setParams({ status: key });
  };

  return (
    <div {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>{t("admin.reviewListTitle")}</h1>
      <div {...stylex.props(styles.tabs)}>
        <For each={TABS}>
          {(key) => (
            <button
              type="button"
              onClick={() => switchTab(key)}
              {...stylex.props(styles.tab, tab() === key && styles.tabActive)}
            >
              {t(`admin.status.${key}` as never)}
            </button>
          )}
        </For>
      </div>
      <Show
        when={items()?.length}
        fallback={<div {...stylex.props(styles.empty)}>{t("admin.reviewEmpty")}</div>}
      >
        <For each={items()}>
          {(item) => (
            <a href={`/reviews/${item.id}`} {...stylex.props(styles.card)}>
              <div {...stylex.props(styles.itemTitle)}>
                {item.title || item.snapshotTitle || t("common.unnamed")}
                <span {...stylex.props(styles.badge)}>{t(`admin.status.${item.status}` as never)}</span>
              </div>
              <div {...stylex.props(styles.meta)}>
                {item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN") : ""}
                {item.platform ? ` · ${item.platform}` : ""}
              </div>
            </a>
          )}
        </For>
      </Show>
    </div>
  );
}
