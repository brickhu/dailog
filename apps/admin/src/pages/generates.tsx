import { createResource, For, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { api } from "../lib/client";

// 生成任务列表（/generates）：已收录投稿 + 脚本数 + 语音状态（由节目/job 状态推导）
// 数据源：GET /v1/editor/generates

interface GenerateItem {
  id: string;
  title: string | null;
  snapshotTitle: string | null;
  platform: string | null;
  createdAt: string;
  reviewedAt: string | null;
  scripts: number;
  episodes: { id: string; transcriptId: string; status: string; jobStatus: string | null }[];
}

const RUNNING_JOBS = ["queued", "tts", "merge", "upload"];

/** 语音状态推导：生成中 > 失败 > 已生成 > 已发布 > 未生成 */
function voiceState(item: GenerateItem): "voiceGenerating" | "voiceFailed" | "voiceReady" | "published" | "voicePending" {
  if (item.episodes.some((e) => e.status === "generating" || RUNNING_JOBS.includes(e.jobStatus ?? ""))) return "voiceGenerating";
  if (item.episodes.some((e) => e.status === "failed")) return "voiceFailed";
  if (item.episodes.some((e) => e.status === "ready")) return "voiceReady";
  if (item.episodes.some((e) => e.status === "published")) return "published";
  return "voicePending";
}

const styles = stylex.create({
  page: { maxWidth: "860px", margin: "0 auto", padding: dimensions.spacing8 },
  title: { fontSize: dimensions.fontSize2xl, fontWeight: dimensions.fontWeightBold, margin: 0 },
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

export default function GeneratesPage() {
  const { t } = useI18n();
  const [items] = createResource<GenerateItem[]>(async () => {
    try {
      const res = await api.get<{ items: GenerateItem[] }>("/v1/editor/generates");
      return res.items;
    } catch {
      return [];
    }
  });

  return (
    <div {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>{t("admin.generateListTitle")}</h1>
      <Show when={items()?.length} fallback={<div {...stylex.props(styles.empty)}>{t("admin.generateEmpty")}</div>}>
        <For each={items()}>
          {(item) => (
            <a href={`/generate/${item.id}`} {...stylex.props(styles.card)}>
              <div {...stylex.props(styles.itemTitle)}>
                {item.title || item.snapshotTitle || t("common.unnamed")}
                <span {...stylex.props(styles.badge)}>{t(`admin.${voiceState(item)}` as never)}</span>
              </div>
              <div {...stylex.props(styles.meta)}>
                {t("admin.scriptCount", { n: item.scripts })}
                {item.platform ? ` · ${item.platform}` : ""}
                {item.reviewedAt ? ` · ${new Date(item.reviewedAt).toLocaleString("zh-CN")}` : ""}
              </div>
            </a>
          )}
        </For>
      </Show>
    </div>
  );
}
