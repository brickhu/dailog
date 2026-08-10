import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { api } from "../lib/client";
import { useI18n } from "@dailogues/i18n";

// /polishes：创作容器（polish）列表——每个容器可生成多条润色脚本，点击进入编辑页。

interface PolishItem {
  id: string;
  title: string | null;
  status: string;
  snapshotTitle: string | null;
  episodeId: string | null;
  episodeStatus: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  editing: "studio.status.editing",
  generating: "studio.status.generating",
  published: "studio.status.published",
  failed: "studio.status.none",
};

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
    justifyContent: "space-between",
    marginBottom: dimensions.spacing6,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
  },
  subtitle: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing1,
  },
  card: {
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing3,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dimensions.spacing3,
    cursor: "pointer",
    backgroundColor: colors.surface,
  },
  cardMain: {
    minWidth: 0,
  },
  cardTitle: {
    fontWeight: dimensions.fontWeightMedium,
    fontSize: dimensions.fontSizeMd,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardMeta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing1,
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
  badgeGenerating: {
    backgroundColor: "#fef3c7",
    color: "#92400e",
  },
  empty: {
    padding: dimensions.spacing8,
    textAlign: "center",
    color: colors.neutral,
    border: `1px dashed ${colors.ink}`,
    borderRadius: dimensions.radiusMd,
  },
  emptyAction: {
    marginTop: dimensions.spacing4,
  },
  error: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing3,
  },
});

export default function PolishesPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = createSignal<PolishItem[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    try {
      const list = await api.get<PolishItem[]>("/v1/polishes");
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("studio.loadFailed"));
    } finally {
      setLoading(false);
    }
  });

  return (
    <div {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <div>
          <div {...stylex.props(styles.title)}>{t("studio.scripts")}</div>
          <div {...stylex.props(styles.subtitle)}>
            你的创作容器——每个容器基于一份对话快照，可生成多条润色脚本
          </div>
        </div>
        <Button onClick={() => navigate("/")}>{t("studio.importFromLink")}</Button>
      </header>

      <Show when={loading()}>
        <div {...stylex.props(styles.subtitle)}>{t("common.loading")}</div>
      </Show>
      <Show when={error()}>
        <div {...stylex.props(styles.error)}>{error()}</div>
      </Show>

      <Show when={!loading() && !error() && items().length === 0}>
        <div {...stylex.props(styles.empty)}>
          还没有创作容器。粘贴 AI 对话分享链接导入，创建你的第一个脚本。
          <div {...stylex.props(styles.emptyAction)}>
            <Button onClick={() => navigate("/")}>{t("studio.importFromLink")}</Button>
          </div>
        </div>
      </Show>

      <For each={items()}>
        {(item) => (
          <div {...stylex.props(styles.card)} onClick={() => navigate(`/polish/${item.id}`)}>
            <div {...stylex.props(styles.cardMain)}>
              <div {...stylex.props(styles.cardTitle)}>{item.snapshotTitle ?? item.title ?? "未命名容器"}</div>
              <div {...stylex.props(styles.cardMeta)}>
                {new Date(item.createdAt).toLocaleDateString("zh-CN")}
              </div>
            </div>
            <span
              {...stylex.props(
                styles.badge,
                item.episodeStatus === "published" && styles.badgePublished,
                item.episodeStatus === "generating" && styles.badgeGenerating,
              )}
            >
              {item.episodeId
                ? t(STATUS_LABEL[item.episodeStatus ?? ""] as never)
                : t("studio.noEpisode")}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}
