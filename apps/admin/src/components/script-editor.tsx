import { createSignal, For, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { api } from "../lib/client";

// 脚本编辑器（编辑端）：手工修改 LLM 生成的脚本（segments）——增删段/改文本/换说话人。
// 保存写 updated_segments（草稿语义：原始 LLM 版本保留对比/恢复）；生成时读取有效脚本
// （updated_segments ?? segments，见 repo.getPolishDetail 的 segments 逻辑）。
// 迁移自 studio script-editor：去掉生成/润色 SSE/水印/persona（admin 的生成走 process 端点），
// 聚焦编辑 + 保存草稿。

interface Props {
  transcriptId: string;
  title: string | null;
  topic: string | null;
  creationNote: string | null;
  initialSegments: { speaker: string; text: string }[];
  onSaved?: () => void;
}

interface Seg {
  speaker: "host" | "guest";
  text: string;
}

const styles = stylex.create({
  editor: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
    marginTop: dimensions.spacing3,
    borderTop: `1px solid ${colors.ink}`,
    paddingTop: dimensions.spacing3,
  },
  row: {
    display: "flex",
    gap: dimensions.spacing2,
    alignItems: "flex-start",
  },
  speaker: {
    flexShrink: 0,
    padding: `${dimensions.spacing1} ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusSm,
    border: `1px solid ${colors.ink}`,
    backgroundColor: "transparent",
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    cursor: "pointer",
    minWidth: "72px",
  },
  speakerActive: {
    backgroundColor: colors.brand,
    color: colors.foreground,
    fontWeight: dimensions.fontWeightMedium,
  },
  text: {
    flex: 1,
    minHeight: "56px",
    boxSizing: "border-box",
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusSm,
    border: `1px solid ${colors.ink}`,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: dimensions.fontSizeSm,
    fontFamily: "inherit",
    resize: "vertical",
    lineHeight: 1.6,
  },
  del: {
    flexShrink: 0,
    background: "none",
    border: "none",
    color: colors.neutral,
    cursor: "pointer",
    fontSize: dimensions.fontSizeSm,
    padding: dimensions.spacing2,
    textDecoration: "underline",
  },
  meta: {
    fontSize: dimensions.fontSizeSm,
    color: colors.neutral,
    margin: 0,
  },
  saved: {
    color: colors.brandStrong,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  error: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
});

export default function ScriptEditor(props: Props) {
  const { t } = useI18n();
  const [segments, setSegments] = createSignal<Seg[]>(
    props.initialSegments.map((s) => ({
      speaker: s.speaker === "guest" ? "guest" : "host",
      text: s.text,
    })),
  );
  const [saving, setSaving] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const setSegment = (i: number, patch: Partial<Seg>) => {
    setSegments((list) => list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const removeSegment = (i: number) => setSegments((list) => list.filter((_, idx) => idx !== i));
  const addSegment = () => setSegments((list) => [...list, { speaker: "guest", text: "" }]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const cleaned = segments().filter((s) => s.text.trim()).map((s) => ({ speaker: s.speaker, text: s.text.trim() }));
      if (cleaned.length === 0) {
        setError(t("admin.scriptEmpty"));
        return;
      }
      await api.put<{ ok: true }>(`/v1/editor/transcripts/${props.transcriptId}`, { segments: cleaned });
      setSaved(true);
      props.onSaved?.();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div {...stylex.props(styles.editor)}>
      <p {...stylex.props(styles.meta)}>
        {props.title || props.topic || t("admin.scriptUntitled")}
        {props.creationNote ? ` — ${props.creationNote}` : ""}
      </p>
      <For each={segments()}>
        {(seg, i) => (
          <div {...stylex.props(styles.row)}>
            <button
              type="button"
              {...stylex.props(styles.speaker, seg.speaker === "host" && styles.speakerActive)}
              onClick={() => setSegment(i(), { speaker: seg.speaker === "host" ? "guest" : "host" })}
            >
              {seg.speaker === "host" ? t("admin.host") : t("admin.guest")}
            </button>
            <textarea
              {...stylex.props(styles.text)}
              value={seg.text}
              onInput={(e) => setSegment(i(), { text: e.currentTarget.value })}
            />
            <button type="button" {...stylex.props(styles.del)} onClick={() => removeSegment(i())}>
              ✕
            </button>
          </div>
        )}
      </For>
      <div {...stylex.props(styles.row)}>
        <Button appear="ghost" onClick={addSegment}>{t("admin.addSegment")}</Button>
        <Button onClick={save} disabled={saving()}>{saving() ? t("admin.saving") : t("admin.saveScript")}</Button>
        <Show when={saved()}>
          <p {...stylex.props(styles.saved)}>{t("admin.saved")}</p>
        </Show>
        <Show when={error()}>
          <p {...stylex.props(styles.error)}>{error()}</p>
        </Show>
      </div>
    </div>
  );
}
