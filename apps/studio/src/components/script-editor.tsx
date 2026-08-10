import { createSignal, For, onMount, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { api } from "../lib/client";
import { ApiError } from "../lib/api";
import { consumeSse } from "../lib/sse";
import { tryParseSegments } from "../lib/parseJsonLoose";
import { totalCharCount, type ScriptSegment } from "../lib/scriptOps";
import { useI18n } from "@dailogues/i18n";
import { EMPTY_PERSONA, type HostPersona } from "../lib/persona";

export interface ScriptEditorProps {
  polishId: string;
  /** host 结构化人设（称呼/职业/年龄/爱好…）——生成脚本时随请求提交（仅本次生效）；
   *  修改只改本地状态，不写回 profile 默认档案 */
  persona?: HostPersona | null;
  onPersonaChange?: (persona: HostPersona) => void;
  /** 编辑已有 transcript（null = 未生成，显示生成入口） */
  transcriptId?: string | null;
  /** 已有 transcript 的脚本（transcriptId 存在时直接进入编辑态） */
  initialSegments?: ScriptSegment[];
  /** 当前 transcript 元数据（列表传给编辑器展示：脚本标题/创作说明/主题） */
  title?: string | null;
  creationNote?: string | null;
  topic?: string | null;
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
  // 重新润色方向输入（展开态 + 值）
  const [directionOpen, setDirectionOpen] = createSignal(false);
  const [direction, setDirection] = createSignal("");
  // 刚生成的脚本元数据（done 事件带回 title/creationNote/topic；切换 transcript 后回落 props）
  const [scriptMeta, setScriptMeta] = createSignal<{
    id: string; title: string | null; creationNote: string | null; topic: string | null;
  } | null>(null);

  // 本次会话的人设（初始值来自 profile 默认档案；修改仅本地，不写回）
  const [persona, setPersona] = createSignal<HostPersona>(props.persona ?? EMPTY_PERSONA);
  const setField = (key: keyof HostPersona, value: string | string[] | null) => {
    setPersona((p) => {
      const next = { ...p, [key]: value };
      props.onPersonaChange?.(next);
      return next;
    });
  };

  const loadOrPolish = async () => {
    if (props.transcriptId && Array.isArray(props.initialSegments)) {
      setState({ kind: "editing", segments: props.initialSegments, version: null });
      return;
    }
    // 无 transcript：等待用户点击「生成脚本」（SSE 润色）
    setState({ kind: "empty" });
  };

  /** 重新润色入口（纠错通道）：展开方向输入 → AI 重写生成新脚本 */
  const requestRepolish = () => {
    const s = state();
    if (s.kind !== "editing") return;
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
        body: JSON.stringify({
          polishId: props.polishId,
          persona,
          ...(instruction ? { instruction } : {}),
        }),
        // SSE 长连接（润色流式输出可能 1-3 分钟）：跳过默认 30s 超时
        timeoutMs: 0,
      });
      await consumeSse(res, {
        onEvent: (ev) => {
          if (ev.event === "quality_failed") {
            setState({ kind: "error", message: t("studio.scriptEditor.qualityFailed") });
            return;
          }
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
          // 多主题切分：后端一次生成多条（各带 topic）；选第一条进入编辑，列表刷新后用户可换选
          const done = JSON.parse(data) as {
            transcriptId?: string;
            transcriptIds?: string[];
            transcripts?: { id: string; title: string | null; creationNote: string | null; topic: string | null }[];
          };
          // 生成完成即可展示脚本元数据（title/创作说明）——无需等父级刷新列表
          const meta = done.transcripts?.[0];
          if (meta) setScriptMeta({ id: meta.id, title: meta.title, creationNote: meta.creationNote, topic: meta.topic });
          const final = normalize(tryParseSegments(raw) ?? []);
          setState({ kind: "editing", segments: final, version: null });
          props.onDone?.(done.transcriptId ?? done.transcriptIds?.[0] ?? "");
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

  /** 当前脚本元数据：刚生成时用 done 事件数据，列表刷新后以 props（列表）为准 */
  const scriptMetaDisplay = () => {
    const m = scriptMeta();
    if (m && props.transcriptId && m.id === props.transcriptId) return m;
    if (props.title || props.creationNote || props.topic) {
      return { id: props.transcriptId ?? "", title: props.title ?? null, creationNote: props.creationNote ?? null, topic: props.topic ?? null };
    }
    return null;
  };

  return (
    <div>
      <Show when={cur().kind === "loading"}>
        <div {...stylex.props(styles.status)}>{t("common.loading")}</div>
      </Show>

      <Show when={cur().kind === "empty"}>
        <div {...stylex.props(styles.personaCard)}>
          <input
            {...stylex.props(styles.directionInput)}
            placeholder={t("persona.callName")}
            value={persona().callName ?? ""}
            onInput={(e) => setField("callName", e.currentTarget.value)}
          />
          <div {...stylex.props(styles.personaRow)}>
            <input
              {...stylex.props(styles.directionInput)}
              placeholder={t("persona.profession")}
              value={persona().profession ?? ""}
              onInput={(e) => setField("profession", e.currentTarget.value)}
            />
            <input
              {...stylex.props(styles.directionInput)}
              placeholder={t("persona.gender")}
              value={persona().gender ?? ""}
              onInput={(e) => setField("gender", e.currentTarget.value)}
            />
            <input
              {...stylex.props(styles.directionInput)}
              placeholder={t("persona.age")}
              value={persona().age ?? ""}
              onInput={(e) => setField("age", e.currentTarget.value)}
            />
          </div>
          <textarea
            {...stylex.props(styles.directionInput, styles.personaTraits)}
            placeholder={t("persona.traits")}
            value={persona().traits ?? ""}
            onInput={(e) => setField("traits", e.currentTarget.value)}
          />
          <Button
            block
            disabled={!persona().callName?.trim()}
            onClick={() => startPolish(direction().trim() || null)}
          >
            {t("studio.scriptEditor.generate")}
          </Button>
          <div {...stylex.props(styles.status)}>{t("studio.scriptEditor.hostNameHint")}</div>
        </div>
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

      <Show when={editing() && scriptMetaDisplay()}>
        <div {...stylex.props(styles.scriptMeta)}>
          <Show when={scriptMetaDisplay()!.title}>
            <div {...stylex.props(styles.scriptTitle)}>{scriptMetaDisplay()!.title}</div>
          </Show>
          <Show when={scriptMetaDisplay()!.creationNote}>
            <div {...stylex.props(styles.scriptNote)}>{scriptMetaDisplay()!.creationNote}</div>
          </Show>
        </div>
      </Show>

      <Show when={editing()}>
        <div>
          {/* 只读查看器：AI 生成即定稿，不可直接编辑——纠错走「重新润色」（带方向指令） */}
          <div {...stylex.props(styles.toolbar)}>
            <span {...stylex.props(styles.count)}>
              {editing()!.segments.length} 段 · {totalCharCount(editing()!.segments)} 字（约
              {Math.round(totalCharCount(editing()!.segments) / 240)} 分钟）
            </span>
            <div>
              <Button appear="ghost" onClick={requestRepolish}>{t("studio.scriptEditor.repolish")}</Button>
            </div>
          </div>
          <div {...stylex.props(styles.emotionHint)}>{t("studio.scriptEditor.emotionHint")}</div>
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
            {(seg) => <SegmentView seg={seg} />}
          </For>
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

/** 只读段落：AI 生成即定稿，不可直接编辑（纠错走重新润色） */
function SegmentView(props: { seg: ScriptSegment }) {
  const { t } = useI18n();
  return (
    <div {...stylex.props(styles.row, props.seg.speaker === "host" ? styles.rowHost : styles.rowGuest)}>
      <span {...stylex.props(styles.speakerTag, props.seg.speaker === "host" ? styles.tagHost : styles.tagGuest)}>
        {props.seg.speaker === "host" ? t("studio.scriptEditor.you") : "AI"}
      </span>
      <span {...stylex.props(styles.readonlyText)}>{props.seg.text}</span>
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
  scriptMeta: {
    border: `1px solid ${colors.ink}`,
    borderRadius: dimensions.radiusMd,
    background: colors.surface,
    padding: dimensions.spacing3,
    marginBottom: dimensions.spacing3,
  },
  scriptTitle: {
    fontWeight: dimensions.fontWeightBold,
    fontSize: dimensions.fontSizeMd,
    marginBottom: dimensions.spacing1,
  },
  scriptNote: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    lineHeight: "1.6",
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
  emotionHint: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing3,
    opacity: 0.8,
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
  personaCard: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusMd,
    background: colors.background,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing3,
  },
  personaRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: dimensions.spacing2,
  },
  personaTraits: {
    minHeight: "56px",
    fontFamily: "inherit",
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
  readonlyText: {
    flex: 1,
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.7,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },  previewText: {
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.6,
  },
});
