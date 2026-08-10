import { createSignal, For, onMount, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { api } from "../lib/client";
import { ApiError } from "../lib/api";
import { consumeSse } from "../lib/sse";
import { tryParseSegments } from "../lib/parseJsonLoose";
import { applyScriptOp, totalCharCount, type ScriptSegment } from "../lib/scriptOps";
import { useI18n } from "@dailogues/i18n";

export interface ScriptEditorProps {
  polishId: string;
  /** 编辑已有 transcript（null = 未生成，显示生成入口） */
  transcriptId?: string | null;
  /** 已有 transcript 的脚本（transcriptId 存在时直接进入编辑态） */
  initialSegments?: ScriptSegment[];
  /** 润色完成回调（新建 transcript 时带 transcriptId） */
  onDone?: (transcriptId: string) => void;
}

type EditorState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "editing"; segments: ScriptSegment[]; version: number | null }
  | { kind: "polishing"; segments: ScriptSegment[]; raw: string }
  | { kind: "error"; message: string };

export default function ScriptEditor(props: ScriptEditorProps) {
  const { t } = useI18n();
  const [state, setState] = createSignal<EditorState>({ kind: "loading" });
  const [toast, setToast] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  // 未保存改动快照（覆盖确认用）：加载/保存成功/润色完成时更新
  const [savedSegments, setSavedSegments] = createSignal<ScriptSegment[]>([]);
  // 重新润色方向输入（展开态 + 值）
  const [directionOpen, setDirectionOpen] = createSignal(false);
  const [direction, setDirection] = createSignal("");

  const update = (op: Parameters<typeof applyScriptOp>[1]) => {
    setState((s) => {
      if (s.kind !== "editing") return s;
      return { ...s, segments: applyScriptOp(s.segments, op) };
    });
  };

  const loadOrPolish = async () => {
    if (props.transcriptId && Array.isArray(props.initialSegments)) {
      setState({ kind: "editing", segments: props.initialSegments, version: null });
      setSavedSegments(props.initialSegments);
      return;
    }
    // 无 transcript：等待用户点击「生成脚本」（SSE 润色）
    setState({ kind: "empty" });
  };

  /** 重新润色入口：未保存改动先确认（覆盖保护）→ 展开方向输入 */
  const requestRepolish = () => {
    const s = state();
    if (s.kind !== "editing") return;
    const dirty = JSON.stringify(s.segments) !== JSON.stringify(savedSegments());
    if (dirty && !window.confirm(t("studio.scriptEditor.repolishConfirm"))) return;
    setDirection("");
    setDirectionOpen(true);
  };

  const startPolish = async (instruction?: string | null) => {
    setState({ kind: "polishing", segments: [], raw: "" });
    setDirectionOpen(false);
    let raw = "";
    try {
      const res = await api.request(`/v1/transcripts/new`, {
        method: "POST",
        body: JSON.stringify({ polishId: props.polishId, ...(instruction ? { instruction } : {}) }),
        // SSE 长连接（润色流式输出可能 1-3 分钟）：跳过默认 30s 超时
        timeoutMs: 0,
      });
      await consumeSse(res, {
        onEvent: (ev) => {
          if (ev.event !== "segment") return;
          raw += ev.data;
          // 增量尝试解析：JSON 数组逐渐成形，段落实时浮现
          const parsed = tryParseSegments(raw);
          if (parsed) {
            setState({ kind: "polishing", segments: normalize(parsed), raw });
          } else {
            setState((s) => (s.kind === "polishing" ? { ...s, raw } : s));
          }
        },
        onDone: async (data) => {
          const { transcriptId } = JSON.parse(data) as { transcriptId?: string };
          const final = normalize(tryParseSegments(raw) ?? []);
          setState({ kind: "editing", segments: final, version: null });
          setSavedSegments(final);
          props.onDone?.(transcriptId ?? "");
        },
        onError: (data) => {
          const parsed = JSON.parse(data) as { error?: string };
          setState({ kind: "error", message: parsed.error ?? t("studio.scriptEditor.polishFailed") });
        },
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        setState({ kind: "error", message: e.detail ?? t("studio.scriptEditor.qualityFailed") });
      } else if (e instanceof ApiError && e.status === 429) {
        setState({ kind: "error", message: e.detail ?? t("studio.scriptEditor.limitReached") });
      } else if (e instanceof ApiError && e.status === 404) {
        setState({ kind: "error", message: t("studio.scriptEditor.noDialogue") });
      } else {
        setState({ kind: "error", message: e instanceof Error ? e.message : t("studio.scriptEditor.polishFailed") });
      }
    }
  };

  const saveDraft = async () => {
    const s = state();
    if (s.kind !== "editing") return;
    setSaving(true);
    try {
      if (!props.transcriptId) {
        setToast(t("studio.scriptEditor.saveFirst"));
        return;
      }
      await api.request(`/v1/transcripts/${props.transcriptId}`, {
        method: "PUT",
        body: JSON.stringify({ segments: s.segments }),
      });
      setState({ ...s, version: null });
      setSavedSegments(s.segments);
      setToast(t("studio.scriptEditor.saved"));
      setTimeout(() => setToast(null), 2000);
    } catch (e) {
      setToast(e instanceof Error ? `保存失败：${e.message}` : t("studio.scriptEditor.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  onMount(loadOrPolish);

  // Show 条件不窄化联合类型，用局部变量辅助函数显式窄化
  const cur = () => state();
  const editing = (): Extract<EditorState, { kind: "editing" }> | null => {
    const s = cur();
    return s.kind === "editing" ? s : null;
  };
  const polishing = (): Extract<EditorState, { kind: "polishing" }> | null => {
    const s = cur();
    return s.kind === "polishing" ? s : null;
  };
  const failed = (): Extract<EditorState, { kind: "error" }> | null => {
    const s = cur();
    return s.kind === "error" ? s : null;
  };

  return (
    <div>
      <Show when={cur().kind === "loading"}>
        <div {...stylex.props(styles.status)}>{t("common.loading")}</div>
      </Show>

      <Show when={polishing()}>
        <div>
          <div {...stylex.props(styles.status)}>{t("studio.scriptEditor.polishing")}</div>
          <For each={polishing()!.segments}>
            {(seg) => <SegmentPreview seg={seg} />}
          </For>
        </div>
      </Show>

      <Show when={failed()}>
        <div {...stylex.props(styles.errorBox)}>
          <div {...stylex.props(styles.errorText)}>{failed()!.message}</div>
          <Button onClick={loadOrPolish}>{t("common.retry")}</Button>
        </div>
      </Show>

      <Show when={editing()}>
        <div>
          <div {...stylex.props(styles.toolbar)}>
            <span {...stylex.props(styles.count)}>
              {editing()!.segments.length} 段 · {totalCharCount(editing()!.segments)} 字（约
              {Math.round(totalCharCount(editing()!.segments) / 240)} 分钟）
            </span>
            <div>
              <Button appear="ghost" onClick={saveDraft} disabled={saving()}>{saving() ? t("studio.scriptEditor.saving") : t("studio.scriptEditor.save")}</Button>
              <Button appear="ghost" onClick={requestRepolish}>{t("studio.scriptEditor.repolish")}</Button>
            </div>
          </div>
          <Show when={directionOpen()}>
            <div {...stylex.props(styles.directionBox)}>
              <input
                {...stylex.props(styles.directionInput)}
                placeholder={t("studio.scriptEditor.instruction")}
                value={direction()}
                onInput={(e) => setDirection(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") startPolish(direction().trim() || null);
                  if (e.key === "Escape") setDirectionOpen(false);
                }}
              />
              <Button onClick={() => startPolish(direction().trim() || null)}>{t("studio.scriptEditor.polish")}</Button>
              <Button appear="ghost" onClick={() => setDirectionOpen(false)}>{t("common.cancel")}</Button>
            </div>
          </Show>
          <For each={editing()!.segments}>
            {(seg, i) => (
              <SegmentRow
                seg={seg}
                index={i()}
                total={editing()!.segments.length}
                onOp={(op) => update(op)}
              />
            )}
          </For>
          <Button
            appear="ghost"
            style={{ "margin-top": dimensions.spacing3 }}
            onClick={() =>
              update({
                type: "insert",
                index: editing()!.segments.length,
                segment: { speaker: "host", text: "" },
              })
            }
          >
            + 添加段落
          </Button>
          <Show when={toast()}>
            <div {...stylex.props(styles.toast)}>{toast()}</div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** 校验/规整 LLM 输出段落（丢弃非法字段，避免渲染崩溃） */
function normalize(parsed: Array<{ speaker?: string; text?: string }> | null): ScriptSegment[] {
  if (!parsed) return [];
  return parsed
    .filter((p) => p && typeof p === "object" && (p.speaker === "host" || p.speaker === "guest") && typeof p.text === "string")
    .map((p) => ({ speaker: p.speaker as "host" | "guest", text: p.text as string }));
}

function SegmentPreview(props: { seg: ScriptSegment }) {
  const { t } = useI18n();
  return (
    <div {...stylex.props(styles.row, props.seg.speaker === "host" ? styles.rowHost : styles.rowGuest)}>
      <span {...stylex.props(styles.speakerTag, props.seg.speaker === "host" ? styles.tagHost : styles.tagGuest)}>
        {props.seg.speaker === "host" ? t("studio.scriptEditor.you") : "AI"}
      </span>
      <span {...stylex.props(styles.previewText)}>{props.seg.text}</span>
    </div>
  );
}

function SegmentRow(props: {
  seg: ScriptSegment;
  index: number;
  total: number;
  onOp: (op: Parameters<typeof applyScriptOp>[1]) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = createSignal(props.seg.text);
  return (
    <div {...stylex.props(styles.row, props.seg.speaker === "host" ? styles.rowHost : styles.rowGuest)}>
      <div {...stylex.props(styles.rowHeader)}>
        <button
          {...stylex.props(styles.speakerTag, props.seg.speaker === "host" ? styles.tagHost : styles.tagGuest)}
          onClick={() => props.onOp({ type: "setSpeaker", index: props.index, speaker: props.seg.speaker === "host" ? "guest" : "host" })}
          title={t("studio.scriptEditor.switchSpeaker")}
        >
          {props.seg.speaker === "host" ? t("studio.scriptEditor.you") : "AI"}
        </button>
        <div {...stylex.props(styles.rowActions)}>
          <button
            {...stylex.props(styles.iconButton)}
            disabled={props.index === 0}
            onClick={() => props.onOp({ type: "move", index: props.index, dir: -1 })}
          >
            ↑
          </button>
          <button
            {...stylex.props(styles.iconButton)}
            disabled={props.index === props.total - 1}
            onClick={() => props.onOp({ type: "move", index: props.index, dir: 1 })}
          >
            ↓
          </button>
          <button {...stylex.props(styles.iconButton, styles.iconDanger)} onClick={() => props.onOp({ type: "remove", index: props.index })}>
            ✕
          </button>
        </div>
      </div>
      <textarea
        {...stylex.props(styles.textarea)}
        value={text()}
        onInput={(e) => {
          setText(e.currentTarget.value);
          props.onOp({ type: "updateText", index: props.index, text: e.currentTarget.value });
        }}
        rows={Math.max(2, Math.ceil(props.seg.text.length / 40))}
      />
    </div>
  );
}

const styles = stylex.create({
  status: {
    color: colors.neutral,
    padding: dimensions.spacing4,
    textAlign: "center",
  },
  errorBox: {
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.danger}`,
    background: colors.surface,
    textAlign: "center",
  },
  errorText: {
    color: colors.danger,
    marginBottom: dimensions.spacing3,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: dimensions.spacing3,
    flexWrap: "wrap",
    gap: dimensions.spacing2,
  },
  count: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  directionBox: {
    display: "flex",
    gap: dimensions.spacing2,
    alignItems: "center",
    marginBottom: dimensions.spacing3,
    padding: dimensions.spacing2,
    borderRadius: dimensions.radiusMd,
    background: colors.background,
    border: `1px solid ${colors.ink}`,
  },
  directionInput: {
    flex: 1,
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusSm,
    border: `1px solid ${colors.ink}`,
    backgroundColor: colors.surface,
    color: colors.foreground,
    fontSize: dimensions.fontSizeSm,
  },
  row: {
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing2,
  },
  rowHost: {
    background: "rgba(91, 140, 255, 0.06)",
    borderLeft: `3px solid ${colors.primary}`,
  },
  rowGuest: {
    backgroundColor: "rgba(159, 122, 234, 0.06)",
    borderLeft: `3px solid #9f7aea`,
  },
  rowHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: dimensions.spacing2,
  },
  speakerTag: {
    padding: `2px ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusFull,
    fontSize: "12px",
    border: "none",
    cursor: "pointer",
  },
  tagHost: {
    backgroundColor: "rgba(91, 140, 255, 0.2)",
    color: colors.primary,
  },
  tagGuest: {
    backgroundColor: "rgba(159, 122, 234, 0.2)",
    color: "#b794f4",
  },
  rowActions: {
    display: "flex",
    gap: dimensions.spacing1,
  },
  iconButton: {
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    color: colors.neutral,
    borderRadius: dimensions.radiusSm,
    cursor: "pointer",
    padding: `2px ${dimensions.spacing2}`,
  },
  iconDanger: {
    color: colors.danger,
  },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    backgroundColor: "transparent",
    border: "none",
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.6,
    resize: "vertical",
    fontFamily: "inherit",
  },
  previewText: {
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.6,
  },
  toast: {
    position: "fixed",
    bottom: dimensions.spacing8,
    left: "50%",
    transform: "translateX(-50%)",
    padding: `${dimensions.spacing2} ${dimensions.spacing4}`,
    borderRadius: dimensions.radiusMd,
    background: colors.success,
    color: colors.onSuccess,
    fontSize: dimensions.fontSizeSm,
  },
});
