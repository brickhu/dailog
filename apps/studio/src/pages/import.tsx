import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { api } from "../lib/client";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "@dailogues/i18n";

// /import（根路径 = 导入页）：粘贴 AI 对话分享链接 → 采集预览 → 确认入库（存 R2 + 建草稿）。
// 是否登录/开通频道由 app 的 auth provider 负责（未登录 → 登录锁定；入库 403 → 频道引导提示）
// 取消 → 回节目列表；入库 → 跳编辑页（ScriptEditor 自动触发润色/质量检测）

const PLATFORM_LABEL: Record<string, string> = {
  deepseek: "DeepSeek",
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  kimi: "Kimi",
  doubao: "studio.import.doubao",
  tongyi: "studio.import.tongyi",
  plain: "studio.import.other",
};

interface DialogueMessage {
  role: "user" | "assistant";
  content: string;
}

interface Dialogue {
  platform: string;
  conversationId: string;
  title: string;
  url: string;
  messages: DialogueMessage[];
  snapshotId?: string | null;
}

/** importer 下发的平台校验规则（单一来源，前端本地预检） */
interface PlatformRule {
  id: string;
  label: string;
  sharePattern: string;
}

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    color: colors.foreground,
    padding: dimensions.spacing4,
  },
  card: {
    width: "100%",
    maxWidth: "560px",
    padding: dimensions.spacing8,
    borderRadius: dimensions.radiusXl,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
  },
  title: {
    fontSize: dimensions.fontSizeLg,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing2,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing4,
    lineHeight: "1.6",
  },
  source: {
    color: colors.primary,
    wordBreak: "break-all",
  },
  messages: {
    // 滚动容器展示采集全文（注意：StyleX 不支持 min()/calc() 函数值，编译期会静默丢弃——
    // 只能用纯长度，否则 maxHeight 消失、内容撑开页面、永远不会出现滚动条）
    maxHeight: "480px",
    overflowY: "auto",
    border: `1px solid ${colors.ink}`,
    borderRadius: dimensions.radiusMd,
    padding: dimensions.spacing3,
    marginBottom: dimensions.spacing4,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
  },
  msg: {
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusMd,
    fontSize: dimensions.fontSizeSm,
    lineHeight: "1.5",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  msgUser: {
    background: colors.primary,
    color: colors.onPrimary,
    alignSelf: "flex-end",
    maxWidth: "85%",
  },
  msgAssistant: {
    background: colors.background,
    border: `1px solid ${colors.ink}`,
    alignSelf: "flex-start",
    maxWidth: "85%",
  },
  actions: {
    display: "flex",
    gap: dimensions.spacing3,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing2,
  },
  urlHint: {
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing4,
    lineHeight: "1.5",
  },
  urlHintOk: {
    color: "#15803d",
  },
  urlHintBad: {
    color: colors.danger,
  },
  error: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing3,
    lineHeight: "1.5",
  },
});

type State =
  | { kind: "loading" }
  | { kind: "input" }
  | { kind: "error"; message: string }
  | { kind: "ready"; dialogue: Dialogue };

export default function CollectPage() {
  const { t } = useI18n();
  const auth = useAuth();
  const navigate = useNavigate();
  const [state, setState] = createSignal<State>({ kind: "input" });
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

  /** 分享链接采集：本地预检 → 调 API 转发 → importer 服务 → 预览确认 */
  const collectFromUrl = async () => {
    const url = shareUrl().trim();
    if (!url || busy()) return;
    // 前端预检（规则来自 importer，非法链接直接拦截，不发请求）
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
            // /api/import 响应：dialogue + snapshotId（五层模型）
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
      // 已有容器：直接跳编辑页（继续创作）
      if (res.ok && body?.existing && body.polishId) {
        navigate(`/polish/${body.polishId}`);
        return;
      }
      if (res.ok && body?.dialogue?.messages?.length) {
        setState({
          kind: "ready",
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
      setState({ kind: "error", message: e instanceof Error ? e.message : t("studio.networkError") });
    } finally {
      setBusy(false);
    }
  };

  /** 确认入库：POST /api/imports（存 R2 + 建草稿）→ 进编辑页（自动触发润色/质量检测） */
  const confirm = async () => {
    const s = state();
    if (s.kind !== "ready" || busy()) return;
    setBusy(true);
    setActionError(null);
    try {
      // 创建创作容器（user × snapshot 唯一）；已存在 → 跳已有编辑页
      const res = await api.request("/v1/polishes/new", {
        method: "POST",
        body: JSON.stringify({ snapshotId: s.dialogue.snapshotId, title: s.dialogue.title }),
      });
      const body = (await res.json().catch(() => null)) as { polishId?: string; error?: string } | null;
      if (res.ok && body?.polishId) {
        navigate(`/polish/${body.polishId}`);
        return;
      }
      if (res.status === 409 && body?.polishId) {
        navigate(`/polish/${body.polishId}`);
        return;
      }
      if (res.status === 403) {
        setActionError(t("studio.channelNotActivated"));
      } else {
        setActionError(body?.error ?? `入库失败（HTTP ${res.status}），请重试`);
      }
    } catch (e) {
      // 会话失效（页面停留期间过期/被登出）：清本地状态 → 登录锁定自动出现
      if (e instanceof ApiError && e.status === 401) {
        auth.expireSession();
        return;
      }
      setActionError(e instanceof Error ? e.message : t("studio.networkError"));
    } finally {
      setBusy(false);
    }
  };

  const ready = (): Extract<State, { kind: "ready" }> | null =>
    state().kind === "ready" ? (state() as Extract<State, { kind: "ready" }>) : null;
  const errorMessage = () =>
    state().kind === "error" ? (state() as Extract<State, { kind: "error" }>).message : "";

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.card)}>
        <Show
          when={state().kind !== "loading"}
          fallback={<div {...stylex.props(styles.meta)}>{t("import.collecting")}</div>}
        >
          <Show
            when={state().kind === "input"}
            fallback={
              <Show
                when={ready()}
                fallback={
                  <>
                    <div {...stylex.props(styles.title)}>{t("import.failed")}</div>
                    <div {...stylex.props(styles.meta)}>{errorMessage()}</div>
                    <Button block onClick={() => navigate("/episodes")}>{t("import.back")}</Button>
                  </>
                }
              >
                <div {...stylex.props(styles.title)}>确认采集「{ready()!.dialogue.title || "未命名对话"}」</div>
                <div {...stylex.props(styles.meta)}>
                  平台：{t(PLATFORM_LABEL[ready()!.dialogue.platform] as never) ?? t("studio.import.other")}
                  {" "}· 共 {ready()!.dialogue.messages.length} 条消息
                  <br />
                  来源：<a {...stylex.props(styles.source)} href={ready()!.dialogue.url} target="_blank">
                    {ready()!.dialogue.url}
                  </a>
                  <br />
                  确认后创建你的创作容器并进入编辑（可多次润色生成脚本）。
                </div>
                <div {...stylex.props(styles.messages)}>
                  <For each={ready()!.dialogue.messages}>
                    {(m) => (
                      <div {...stylex.props(styles.msg, m.role === "user" ? styles.msgUser : styles.msgAssistant)}>
                        {m.content}
                      </div>
                    )}
                  </For>
                </div>
                <div {...stylex.props(styles.actions)}>
                  <Button block disabled={busy()} onClick={confirm}>{busy() ? t("studio.import.creating") : t("studio.import.confirmCreate")}</Button>
                  <Button block appear="ghost" disabled={busy()} onClick={() => navigate("/episodes")}>{t("common.cancel")}</Button>
                </div>
                <Show when={actionError()}>
                  <div {...stylex.props(styles.error)}>{actionError()}</div>
                </Show>
              </Show>
            }
          >
            {/* 分享链接模式：粘贴链接 → 采集 → 预览确认 */}
            <div {...stylex.props(styles.title)}>{t("studio.import.title")}</div>
            <div {...stylex.props(styles.meta)}>
              粘贴 Claude / ChatGPT / DeepSeek / Gemini / Kimi / 豆包 的对话分享链接，
              采集后确认入库。
            </div>
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
            <Show when={urlHint() && shareUrl().trim().length > 0}>
              <div
                {...stylex.props(
                  styles.urlHint,
                  urlHint()!.ok ? styles.urlHintOk : styles.urlHintBad,
                )}
              >
                {urlHint()!.ok
                  ? `✓ 检测到 ${urlHint()!.label} 分享链接`
                  : urlHint()!.message}
              </div>
            </Show>
            <div {...stylex.props(styles.actions)}>
              <Button
                block
                disabled={busy() || (!!urlHint() && !urlHint()!.ok)}
                onClick={collectFromUrl}
              >
                {busy() ? t("studio.import.collecting") : t("studio.import.collect")}
              </Button>
              <Button block appear="ghost" disabled={busy()} onClick={() => navigate("/episodes")}>{t("studio.myEpisodes")}</Button>
            </div>
            <Show when={actionError()}>
              <div {...stylex.props(styles.error)}>{actionError()}</div>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
