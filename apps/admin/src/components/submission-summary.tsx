import { createSignal, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { apiUrl } from "../lib/client";
import type { AdminSubmissionSummary } from "../lib/types";

// 投稿摘要（审核/生成/发布页全局展示）：标题、摘要、消息量、总字数、分享页 url、
// 投稿人邮箱、平台、语言、主持人（人设 + 采样播放）、AI 嘉宾（人设 + 采样播放）、状态

const styles = stylex.create({
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
  row: { display: "flex", flexWrap: "wrap", gap: `${dimensions.spacing2} ${dimensions.spacing4}`, fontSize: dimensions.fontSizeSm, color: colors.neutral },
  item: { display: "flex", gap: dimensions.spacing1, alignItems: "center" },
  label: { color: colors.neutral },
  value: { color: colors.foreground, wordBreak: "break-all" },
  link: { color: colors.brandStrong, textDecoration: "underline" },
  badge: {
    display: "inline-block",
    padding: `${dimensions.spacing1} ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.surfaceStrong,
    fontSize: dimensions.fontSizeSm,
    color: colors.foreground,
  },
  personaRow: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    flexWrap: "wrap",
    fontSize: dimensions.fontSizeSm,
    color: colors.foreground,
  },
  personaLabel: { color: colors.neutral },
  personaName: { fontWeight: dimensions.fontWeightMedium },
  playButton: {
    background: "none",
    border: `1px solid ${colors.ink}`,
    borderRadius: dimensions.radiusSm,
    padding: `${dimensions.spacing1} ${dimensions.spacing2}`,
    fontSize: dimensions.fontSizeSm,
    color: colors.foreground,
    cursor: "pointer",
  },
  audio: { maxWidth: "260px", height: "32px" },
  missing: { color: colors.neutral, fontStyle: "italic" },
});

/** 采样播放按钮：点击展开内嵌 audio */
function SamplePlay(props: { src: string | null }) {
  const { t } = useI18n();
  const [open, setOpen] = createSignal(false);
  return (
    <Show when={props.src} fallback={<span {...stylex.props(styles.missing)}>{t("admin.noSample")}</span>}>
      <button type="button" {...stylex.props(styles.playButton)} onClick={() => setOpen(!open())}>
        {t("admin.playSample")}
      </button>
      <Show when={open()}>
        <audio controls src={props.src ?? undefined} {...stylex.props(styles.audio)} />
      </Show>
    </Show>
  );
}

export default function SubmissionSummary(props: { data: AdminSubmissionSummary; showStatus?: boolean }) {
  const { t } = useI18n();
  const d = () => props.data;
  const hostSampleSrc = () =>
    d().host?.hasSample ? apiUrl(`/v1/editor/samples/host/${d().host!.id}/audio`) : null;
  const guestSampleSrc = () =>
    d().guest?.hasSample ? apiUrl(`/v1/editor/samples/guest/${d().guest!.id}/audio`) : null;
  return (
    <div {...stylex.props(styles.card)}>
      <p {...stylex.props(styles.cardTitle)}>{t("admin.summary")}</p>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.item)}>
          <span {...stylex.props(styles.label)}>{t("admin.epTitle")}：</span>
          <span {...stylex.props(styles.value)}>{d().title ?? t("common.unnamed")}</span>
        </span>
        <Show when={d().sourceTitle}>
          <span {...stylex.props(styles.item)}>
            <span {...stylex.props(styles.label)}>{t("admin.sourceTitle")}：</span>
            <span {...stylex.props(styles.value)}>{d().sourceTitle}</span>
          </span>
        </Show>
        <span {...stylex.props(styles.item)}>
          <span {...stylex.props(styles.label)}>{t("admin.msgCount")}：</span>
          <span {...stylex.props(styles.value)}>{d().msgCount}</span>
        </span>
        <span {...stylex.props(styles.item)}>
          <span {...stylex.props(styles.label)}>{t("admin.wordCount")}：</span>
          <span {...stylex.props(styles.value)}>{d().wordCount}</span>
        </span>
        <Show when={props.showStatus !== false}>
          <span {...stylex.props(styles.item)}>
            <span {...stylex.props(styles.label)}>{t("admin.summaryStatus")}：</span>
            <span {...stylex.props(styles.badge)}>{t(`admin.status.${d().status}` as never)}</span>
          </span>
        </Show>
      </div>
      <div {...stylex.props(styles.row)}>
        <Show when={d().snapshotUrl}>
          <span {...stylex.props(styles.item)}>
            <span {...stylex.props(styles.label)}>{t("admin.shareUrl")}：</span>
            <a href={d().snapshotUrl!} target="_blank" rel="noreferrer" {...stylex.props(styles.link)}>{d().snapshotUrl}</a>
          </span>
        </Show>
        <Show when={d().email}>
          <span {...stylex.props(styles.item)}>
            <span {...stylex.props(styles.label)}>{t("admin.email")}：</span>
            <span {...stylex.props(styles.value)}>{d().email}</span>
          </span>
        </Show>
        <Show when={d().platform}>
          <span {...stylex.props(styles.item)}>
            <span {...stylex.props(styles.label)}>{t("admin.platform")}：</span>
            <span {...stylex.props(styles.value)}>{d().platform}</span>
          </span>
        </Show>
        <Show when={d().language}>
          <span {...stylex.props(styles.item)}>
            <span {...stylex.props(styles.label)}>{t("admin.language")}：</span>
            <span {...stylex.props(styles.value)}>{d().language}</span>
          </span>
        </Show>
      </div>
      <Show when={d().host}>
        <div {...stylex.props(styles.personaRow)}>
          <span {...stylex.props(styles.personaLabel)}>{t("admin.hostPersona")}：</span>
          <span {...stylex.props(styles.personaName)}>{d().host!.name ?? d().host!.persona?.callName ?? t("common.unnamed")}</span>
          <SamplePlay src={hostSampleSrc()} />
        </div>
      </Show>
      <Show when={d().guest}>
        <div {...stylex.props(styles.personaRow)}>
          <span {...stylex.props(styles.personaLabel)}>{t("admin.aiPersona")}：</span>
          <span {...stylex.props(styles.personaName)}>{d().guest!.name}</span>
          <SamplePlay src={guestSampleSrc()} />
        </div>
      </Show>
    </div>
  );
}
