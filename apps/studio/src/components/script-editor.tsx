import { createSignal, For, onMount, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex.ts";
import { api } from "../lib/client";
import { ApiError } from "../lib/api";
import { consumeSse } from "../lib/sse";
import { tryParseSegments } from "../lib/parseJsonLoose";
import { applyScriptOp, totalCharCount, type ScriptSegment } from "../lib/scriptOps";

export interface ScriptEditorProps {
  episodeId: string;
  /** 无已有脚本时自动触发润色 */
  onDone?: (version: number) => void;
}

type EditorState =
  | { kind: "loading" }
  | { kind: "editing"; segments: ScriptSegment[]; version: number | null }
  | { kind: "polishing"; segments: ScriptSegment[]; raw: string }
  | { kind: "error"; message: string };

export default function ScriptEditor(props: ScriptEditorProps) {
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
    setState({ kind: "loading" });
    try {
      const existing = await api.get<{ version: number; segments: ScriptSegment[] } | null>(
        `/api/episodes/${props.episodeId}/script`,
      );
      if (existing && Array.isArray(existing.segments)) {
        setState({ kind: "editing", segments: existing.segments, version: existing.version });
        setSavedSegments(existing.segments);
        return;
      }
      await startPolish();
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "加载失败" });
    }
  };

  /** 重新润色入口：未保存改动先确认（覆盖保护）→ 展开方向输入 */
  const requestRepolish = () => {
    const s = state();
    if (s.kind !== "editing") return;
    const dirty = JSON.stringify(s.segments) !== JSON.stringify(savedSegments());
    if (dirty && !window.confirm("重新润色将覆盖当前未保存的改动，继续？")) return;
    setDirection("");
    setDirectionOpen(true);
  };

  const startPolish = async (instruction?: string | null) => {
    setState({ kind: "polishing", segments: [], raw: "" });
    setDirectionOpen(false);
    let raw = "";
    try {
      const res = await api.request(`/api/episodes/${props.episodeId}/polish`, {
        method: "POST",
        body: instruction ? JSON.stringify({ instruction }) : undefined,
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
          const { version } = JSON.parse(data) as { version?: number };
          const final = normalize(tryParseSegments(raw) ?? []);
          setState({ kind: "editing", segments: final, version: version ?? null });
          setSavedSegments(final);
          props.onDone?.(version ?? 0);
        },
        onError: (data) => {
          const parsed = JSON.parse(data) as { error?: string };
          setState({ kind: "error", message: parsed.error ?? "润色失败" });
        },
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        setState({ kind: "error", message: e.detail ?? "对话质量审核未通过" });
      } else if (e instanceof ApiError && e.status === 429) {
        setState({ kind: "error", message: e.detail ?? "该对话的润色次数已达上限" });
      } else if (e instanceof ApiError && e.status === 404) {
        setState({ kind: "error", message: "未找到对话内容" });
      } else {
        setState({ kind: "error", message: e instanceof Error ? e.message : "润色失败" });
      }
    }
  };

  const saveDraft = async () => {
    const s = state();
    if (s.kind !== "editing") return;
    setSaving(true);
    try {
      const saved = await api.put<{ version: number }>(`/api/episodes/${props.episodeId}/script`, {
        segments: s.segments,
      });
      setState({ ...s, version: saved.version });
      setSavedSegments(s.segments);
      setToast("草稿已保存");
      setTimeout(() => setToast(null), 2000);
    } catch (e) {
      setToast(e instanceof Error ? `保存失败：${e.message}` : "保存失败");
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
        <div {...stylex.props(styles.status)}>加载中…</div>
      </Show>

      <Show when={polishing()}>
        <div>
          <div {...stylex.props(styles.status)}>AI 正在打磨你的对话为播客脚本…（可稍等片刻）</div>
          <For each={polishing()!.segments}>
            {(seg) => <SegmentPreview seg={seg} />}
          </For>
        </div>
      </Show>

      <Show when={failed()}>
        <div {...stylex.props(styles.errorBox)}>
          <div {...stylex.props(styles.errorText)}>{failed()!.message}</div>
          <button {...stylex.props(styles.button)} onClick={loadOrPolish}>
            重试
          </button>
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
              <button {...stylex.props(styles.button, styles.buttonGhost)} onClick={saveDraft} disabled={saving()}>
                {saving() ? "保存中…" : "保存草稿"}
              </button>
              <button {...stylex.props(styles.button, styles.buttonGhost)} onClick={requestRepolish}>
                重新润色
              </button>
            </div>
          </div>
          <Show when={directionOpen()}>
            <div {...stylex.props(styles.directionBox)}>
              <input
                {...stylex.props(styles.directionInput)}
                placeholder="想怎么改？如：更简短、更口语化、换个开场…（可选）"
                value={direction()}
                onInput={(e) => setDirection(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") startPolish(direction().trim() || null);
                  if (e.key === "Escape") setDirectionOpen(false);
                }}
              />
              <button {...stylex.props(styles.button)} onClick={() => startPolish(direction().trim() || null)}>
                开始润色
              </button>
              <button {...stylex.props(styles.button, styles.buttonGhost)} onClick={() => setDirectionOpen(false)}>
                取消
              </button>
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
          <button
            {...stylex.props(styles.button, styles.addButton)}
            onClick={() =>
              update({
                type: "insert",
                index: editing()!.segments.length,
                segment: { speaker: "host", text: "" },
              })
            }
          >
            + 添加段落
          </button>
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
  return (
    <div {...stylex.props(styles.row, props.seg.speaker === "host" ? styles.rowHost : styles.rowGuest)}>
      <span {...stylex.props(styles.speakerTag, props.seg.speaker === "host" ? styles.tagHost : styles.tagGuest)}>
        {props.seg.speaker === "host" ? "你" : "AI"}
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
  const [text, setText] = createSignal(props.seg.text);
  return (
    <div {...stylex.props(styles.row, props.seg.speaker === "host" ? styles.rowHost : styles.rowGuest)}>
      <div {...stylex.props(styles.rowHeader)}>
        <button
          {...stylex.props(styles.speakerTag, props.seg.speaker === "host" ? styles.tagHost : styles.tagGuest)}
          onClick={() => props.onOp({ type: "setSpeaker", index: props.index, speaker: props.seg.speaker === "host" ? "guest" : "host" })}
          title="点击切换发言者"
        >
          {props.seg.speaker === "host" ? "你" : "AI"}
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
    color: tokens.colorTextMuted,
    padding: tokens.space4,
    textAlign: "center",
  },
  errorBox: {
    padding: tokens.space4,
    borderRadius: tokens.radiusMd,
    border: `1px solid ${tokens.colorDanger}`,
    background: tokens.colorSurface,
    textAlign: "center",
  },
  errorText: {
    color: tokens.colorDanger,
    marginBottom: tokens.space3,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: tokens.space3,
    flexWrap: "wrap",
    gap: tokens.space2,
  },
  count: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
  },
  button: {
    padding: `${tokens.space1} ${tokens.space3}`,
    borderRadius: tokens.radiusMd,
    border: "none",
    background: tokens.colorPrimary,
    color: "#fff",
    cursor: "pointer",
    fontSize: tokens.fontSizeSm,
    marginLeft: tokens.space2,
  },
  buttonGhost: {
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
    color: tokens.colorText,
  },
  directionBox: {
    display: "flex",
    gap: tokens.space2,
    alignItems: "center",
    marginBottom: tokens.space3,
    padding: tokens.space2,
    borderRadius: tokens.radiusMd,
    background: tokens.colorBg,
    border: `1px solid ${tokens.colorBorder}`,
  },
  directionInput: {
    flex: 1,
    padding: `${tokens.space1} ${tokens.space3}`,
    borderRadius: tokens.radiusSm,
    border: `1px solid ${tokens.colorBorder}`,
    background: tokens.colorSurface,
    color: tokens.colorText,
    fontSize: tokens.fontSizeSm,
  },
  addButton: {
    marginTop: tokens.space3,
  },
  row: {
    padding: tokens.space3,
    borderRadius: tokens.radiusMd,
    border: `1px solid ${tokens.colorBorder}`,
    marginBottom: tokens.space2,
  },
  rowHost: {
    background: "rgba(91, 140, 255, 0.06)",
    borderLeft: `3px solid ${tokens.colorPrimary}`,
  },
  rowGuest: {
    background: "rgba(159, 122, 234, 0.06)",
    borderLeft: `3px solid #9f7aea`,
  },
  rowHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: tokens.space2,
  },
  speakerTag: {
    padding: `2px ${tokens.space2}`,
    borderRadius: tokens.radiusFull,
    fontSize: "12px",
    border: "none",
    cursor: "pointer",
  },
  tagHost: {
    background: "rgba(91, 140, 255, 0.2)",
    color: tokens.colorPrimary,
  },
  tagGuest: {
    background: "rgba(159, 122, 234, 0.2)",
    color: "#b794f4",
  },
  rowActions: {
    display: "flex",
    gap: tokens.space1,
  },
  iconButton: {
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
    color: tokens.colorTextMuted,
    borderRadius: tokens.radiusSm,
    cursor: "pointer",
    padding: `2px ${tokens.space2}`,
  },
  iconDanger: {
    color: tokens.colorDanger,
  },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    background: "transparent",
    border: "none",
    color: tokens.colorText,
    fontSize: tokens.fontSizeMd,
    lineHeight: 1.6,
    resize: "vertical",
    fontFamily: "inherit",
  },
  previewText: {
    color: tokens.colorText,
    fontSize: tokens.fontSizeMd,
    lineHeight: 1.6,
  },
  toast: {
    position: "fixed",
    bottom: tokens.space6,
    left: "50%",
    transform: "translateX(-50%)",
    padding: `${tokens.space2} ${tokens.space4}`,
    borderRadius: tokens.radiusMd,
    background: tokens.colorSuccess,
    color: "#fff",
    fontSize: tokens.fontSizeSm,
  },
});
