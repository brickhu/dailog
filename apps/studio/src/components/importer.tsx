import { createSignal, onMount, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { api } from "../lib/client";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

// ---------------------------------------------------------------------------
// Importer：分享链接采集组件（采集业务逻辑全在内部）
//   状态机：
//     idle    —— 输入框 + 导入按钮（空/非法 disabled；前端预检提示）
//     loading —— 采集中…
//     success —— 导入成功：标题/问答轮次/消息数/对话链接/AI平台 + [生成脚本][取消]
//     error   —— 导入失败：url + 失败原因 + [我知道了]（回默认态）
//   流程：本地预检（importer 规则）→ POST /v1/import → success（预览）
//         → [生成脚本] POST /v1/polishes/new → onGenerated(polishId)（宿主跳转）
// ---------------------------------------------------------------------------

export interface DialogueMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ImportedDialogue {
  platform: string;
  conversationId: string;
  title: string;
  url: string;
  messages: DialogueMessage[];
  snapshotId: string | null;
}

interface PlatformRule {
  id: string;
  label: string;
  sharePattern: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  kimi: "Kimi",
  doubao: "studio.import.doubao",
  tongyi: "studio.import.tongyi",
  plain: "studio.import.other",
};

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; dialogue: ImportedDialogue }
  | { kind: "error"; url: string; message: string };

export interface ImporterProps {
  /** 创作容器创建成功（宿主负责跳转编辑页） */
  onGenerated?: (polishId: string, dialogue: ImportedDialogue) => void;
  /** 成功态取消（缺省回默认态） */
  onCancel?: () => void;
  /** 失败已读（缺省回默认态） */
  onAck?: () => void;
}

export default function Importer(props: ImporterProps) {
  const { t } = useI18n();
  const auth = useAuth();
  const [state, setState] = createSignal<State>({ kind: "idle" });
  const [busy, setBusy] = createSignal(false);
  const [actionError, setActionError] = createSignal<string | null>(null);
  const [shareUrl, setShareUrl] = createSignal("");
  const [rules, setRules] = createSignal<PlatformRule[] | null>(null);
  const [urlHint, setUrlHint] = createSignal<{ ok: boolean; label?: string; message?: string } | null>(null);

  onMount(async () => {
    void loadRules();
  });

  /** 拉取 importer 校验规则（失败不阻塞——采集时服务端仍会校验） */
  const loadRules = async () => {
    try {
      const res = await api.request("/v1/importer/platforms");
      const body = (await res.json().catch(() => null)) as { platforms?: PlatformRule[] } | null;
      if (res.ok && Array.isArray(body?.platforms)) setRules(body.platforms);
    } catch {
      /* 规则拉取失败：跳过前端预检，服务端兜底 */
    }
  };

  /** 本地预检：匹配 importer 下发的分享页结构正则 */
  const validateUrl = (url: string): { ok: boolean; label?: string; message?: string } => {
    const trimmed = url.trim();
    if (!trimmed) return { ok: false };
    if (!/^https?:\/\//.test(trimmed)) return { ok: false, message: t("studio.import.urlHttp") };
    const rs = rules();
    if (!rs) return { ok: true }; // 规则未就绪：放行，服务端校验
    for (const r of rs) {
      try {
        if (new RegExp(r.sharePattern).test(trimmed)) return { ok: true, label: r.label };
      } catch {
        /* 规则异常跳过 */
      }
    }
    return { ok: false, message: t("studio.import.urlInvalid") };
  };

  const onUrlInput = (value: string) => {
    setShareUrl(value);
    setUrlHint(validateUrl(value));
    setActionError(null);
  };

  /** 分享链接采集：本地预检 → 调 API 转发 → importer 服务 */
  const collectFromUrl = async () => {
    const url = shareUrl().trim();
    if (!url || busy()) return;
    const hint = validateUrl(url);
    if (!hint.ok) {
      setActionError(hint.message ?? t("studio.import.urlRequired"));
      return;
    }
    setBusy(true);
    setActionError(null);
    setState({ kind: "loading" });
    try {
      const res = await api.request("/v1/import", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            dialogue?: {
              platform?: string;
              conversationId?: string;
              title?: string;
              url?: string;
              messages?: DialogueMessage[];
            };
            snapshotId?: string;
            existing?: boolean;
            polishId?: string;
            error?: string;
          }
        | null;
      // 已有容器：直接交给宿主（继续创作）
      if (res.ok && body?.existing && body.polishId) {
        props.onGenerated?.(body.polishId, {
          platform: body.dialogue?.platform ?? "plain",
          conversationId: body.dialogue?.conversationId ?? url,
          title: body.dialogue?.title ?? t("studio.import.shareDialogue"),
          url: body.dialogue?.url ?? url,
          messages: body.dialogue?.messages ?? [],
          snapshotId: body.snapshotId ?? null,
        });
        return;
      }
      if (res.ok && body?.dialogue?.messages?.length) {
        setState({
          kind: "success",
          dialogue: {
            platform: body.dialogue.platform ?? "plain",
            conversationId: body.dialogue.conversationId ?? url,
            title: body.dialogue.title ?? t("studio.import.shareDialogue"),
            url: body.dialogue.url ?? url,
            messages: body.dialogue.messages,
            snapshotId: body.snapshotId ?? null,
          },
        });
        return;
      }
      const err = body?.error ?? `采集失败（HTTP ${res.status}）`;
      setState({
        kind: "error",
        url,
        message:
          err === "platform_unreachable"
            ? t("import.unreachable")
            : err === "parse_failed"
              ? t("import.parseFailed")
              : err === "too_short"
                ? t("import.tooShort")
                : err === "share_unavailable"
                  ? t("import.shareUnavailable")
                  : err === "unsupported_platform"
                    ? t("import.unsupported")
                    : err === "share_collect_unreachable"
                      ? t("import.collectUnreachable")
                      : err,
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        auth.expireSession();
        return;
      }
      setState({ kind: "error", url, message: e instanceof Error ? e.message : t("studio.networkError") });
    } finally {
      setBusy(false);
    }
  };

  /** 生成脚本：创建创作容器（user × snapshot 唯一）→ 宿主跳编辑页 */
  const createPolish = async () => {
    const s = state();
    if (s.kind !== "success" || busy()) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.request("/v1/polishes/new", {
        method: "POST",
        body: JSON.stringify({ snapshotId: s.dialogue.snapshotId, title: s.dialogue.title }),
      });
      const body = (await res.json().catch(() => null)) as { polishId?: string; error?: string } | null;
      if ((res.ok || res.status === 409) && body?.polishId) {
        props.onGenerated?.(body.polishId, s.dialogue);
        return;
      }
      if (res.status === 403) {
        setActionError(t("studio.channelNotActivated"));
      } else {
        setActionError(body?.error ?? `入库失败（HTTP ${res.status}），请重试`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        auth.expireSession();
        return;
      }
      setActionError(e instanceof Error ? e.message : t("studio.networkError"));
    } finally {
      setBusy(false);
    }
  };

  const backToIdle = () => {
    setState({ kind: "idle" });
    setActionError(null);
    setShareUrl("");
    setUrlHint(null);
  };

  return (
    <div {...stylex.props(styles.card)}>
      <Show when={state().kind !== "loading"} fallback={
        <div {...stylex.props(styles.center)}>{t("import.collecting")}</div>
      }>
        <Show
          when={state().kind === "idle"}
          fallback={
            <Show
              when={state().kind === "success"}
              fallback={
                // ---- 失败态 ----
                <div>
                  <div {...stylex.props(styles.title)}>{t("importer.failed")}</div>
                  <div {...stylex.props(styles.meta)}>
                    {t("importer.url")}: <a {...stylex.props(styles.source)} href={(state() as Extract<State, { kind: "error" }>).url} target="_blank">{(state() as Extract<State, { kind: "error" }>).url}</a>
                    <br />
                    {t("importer.reason")}: {(state() as Extract<State, { kind: "error" }>).message}
                  </div>
                  <Button block onClick={() => { props.onAck?.(); backToIdle(); }}>{t("importer.ack")}</Button>
                </div>
              }
            >
              {/* ---- 成功态：导入预览 ---- */}
              <div>
                <div {...stylex.props(styles.title)}>{t("importer.successTitle")}</div>
                <div {...stylex.props(styles.meta)}>
                  {t("importer.field.title")}: {(state() as Extract<State, { kind: "success" }>).dialogue.title || t("studio.unnamed")}
                  <br />
                  {t("importer.field.turns")}: {(state() as Extract<State, { kind: "success" }>).dialogue.messages.filter((m) => m.role === "user").length}
                  <br />
                  {t("importer.field.messages")}: {(state() as Extract<State, { kind: "success" }>).dialogue.messages.length}
                  <br />
                  {t("importer.field.url")}: <a {...stylex.props(styles.source)} href={(state() as Extract<State, { kind: "success" }>).dialogue.url} target="_blank">{(state() as Extract<State, { kind: "success" }>).dialogue.url}</a>
                  <br />
                  {t("importer.field.platform")}: {t(PLATFORM_LABEL[(state() as Extract<State, { kind: "success" }>).dialogue.platform] as never) ?? t("studio.import.other")}
                </div>
                <div {...stylex.props(styles.actions)}>
                  <Button block disabled={busy()} onClick={createPolish}>{busy() ? t("studio.import.creating") : t("importer.generate")}</Button>
                  <Button block appear="ghost" disabled={busy()} onClick={() => { props.onCancel?.(); backToIdle(); }}>{t("common.cancel")}</Button>
                </div>
                <Show when={actionError()}>
                  <div {...stylex.props(styles.error)}>{actionError()}</div>
                </Show>
              </div>
            </Show>
          }
        >
          {/* ---- 默认态：输入 + 导入按钮 ---- */}
          <div {...stylex.props(styles.title)}>{t("studio.import.title")}</div>
          <div {...stylex.props(styles.meta)}>{t("importer.hint")}</div>
          <input
            type="url"
            placeholder="https://claude.ai/share/…"
            value={shareUrl()}
            onInput={(e) => onUrlInput((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void collectFromUrl();
            }}
            {...stylex.props(styles.input)}
          />
          <Show when={urlHint()?.message}>
            <div {...stylex.props(styles.error)}>{urlHint()!.message}</div>
          </Show>
          <Show when={actionError()}>
            <div {...stylex.props(styles.error)}>{actionError()}</div>
          </Show>
          <Button
            block
            disabled={!shareUrl().trim() || !validateUrl(shareUrl()).ok || busy()}
            onClick={() => void collectFromUrl()}
          >
            {t("studio.import.collect")}
          </Button>
        </Show>
      </Show>
    </div>
  );
}

const styles = stylex.create({
  card: {
    padding: dimensions.spacing6,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
  },
  center: {
    textAlign: "center",
    color: colors.neutral,
    padding: dimensions.spacing8,
  },
  title: {
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing2,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    lineHeight: "1.8",
    marginBottom: dimensions.spacing4,
  },
  source: {
    color: colors.primary,
    wordBreak: "break-all",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    marginBottom: dimensions.spacing3,
  },
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
  },
  error: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing2,
    lineHeight: "1.5",
  },
});
