import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { api } from "../lib/client";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { getCollect, deleteCollect, closeCurrentTab, type CachedCollect } from "../lib/ext-bridge";

// /import?collectId=<id>：扩展采集确认入库页——展示本地缓存，用户确认才入库（存 R2 + 建草稿）
// 是否登录/开通频道由 app 的 auth provider 负责（未登录 → 登录锁定；入库 403 → 频道引导提示）
// 取消 → 删除本地缓存回来源页；入库 → 跳编辑页（ScriptEditor 自动触发润色/质量检测）

const PLATFORM_LABEL: Record<string, string> = {
  deepseek: "DeepSeek",
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  kimi: "Kimi",
  doubao: "豆包",
  tongyi: "通义",
  plain: "其他",
};

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
  warn: {
    backgroundColor: "#fffbeb",
    color: "#92400e",
    border: `1px solid #fde68a`,
    borderRadius: dimensions.radiusMd,
    padding: dimensions.spacing3,
    fontSize: dimensions.fontSizeSm,
    lineHeight: "1.5",
    marginBottom: dimensions.spacing4,
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
  | { kind: "ready"; dialogue: CachedCollect };

/** importer 下发的平台校验规则（单一来源，前端本地预检） */
interface PlatformRule {
  id: string;
  label: string;
  sharePattern: string;
}

export default function CollectPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const collectId = typeof params.collectId === "string" ? params.collectId : null;
  const [state, setState] = createSignal<State>({ kind: "loading" });
  const [busy, setBusy] = createSignal(false);
  const [actionError, setActionError] = createSignal<string | null>(null);
  const [shareUrl, setShareUrl] = createSignal("");
  const [rules, setRules] = createSignal<PlatformRule[] | null>(null);
  const [urlHint, setUrlHint] = createSignal<{ ok: boolean; label?: string; message?: string } | null>(null);

  /** 拉取 importer 校验规则（失败不阻塞——采集时服务端仍会校验） */
  const loadRules = async () => {
    try {
      const res = await api.request("/api/importer/platforms");
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
    if (!/^https?:\/\//.test(trimmed)) return { ok: false, message: "链接需以 http(s):// 开头" };
    const rs = rules();
    if (!rs) return { ok: true }; // 规则未就绪：放行，服务端校验
    for (const r of rs) {
      try {
        if (new RegExp(r.sharePattern).test(trimmed)) return { ok: true, label: r.label };
      } catch {
        /* 规则异常跳过 */
      }
    }
    return { ok: false, message: "不是有效的分享页链接（支持：Claude / ChatGPT / DeepSeek / Gemini / Kimi / 豆包）" };
  };

  const onUrlInput = (value: string) => {
    setShareUrl(value);
    setUrlHint(validateUrl(value));
    setActionError(null);
  };

  // 扩展模式：页面生命周期兜底，关窗/导航离开时自动清缓存（扩展侧 tab 关闭监听是主保险，
  // 此处双保险——极端情况下扩展 SW 未及时处理也能清掉）
  window.addEventListener("pagehide", () => {
    if (collectId) void deleteCollect(collectId);
  });

  onMount(async () => {
    void loadRules();
    if (!collectId) {
      // 无 collectId = 分享链接模式：显示输入框，用户粘贴分享链接后采集
      setState({ kind: "input" });
      return;
    }
    const dialogue = await getCollect(collectId);
    if (!dialogue) {
      setState({
        kind: "error",
        message: "未找到本地采集缓存（可能已过期，或当前浏览器未安装扩展）。请回到对话页重新采集。",
      });
      return;
    }
    setState({ kind: "ready", dialogue });
  });

  /** 分享链接采集：本地预检 → 调 API 转发 → importer 服务 → 预览确认 */
  const collectFromUrl = async () => {
    const url = shareUrl().trim();
    if (!url || busy()) return;
    // 前端预检（规则来自 importer，非法链接直接拦截，不发请求）
    const hint = validateUrl(url);
    if (!hint.ok) {
      setActionError(hint.message ?? "请输入完整的分享链接（https://…）");
      return;
    }
    setBusy(true);
    setActionError(null);
    setState({ kind: "loading" });
    try {
      const res = await api.request("/api/importer/collect", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            platform?: string;
            conversationId?: string;
            title?: string;
            url?: string;
            messages?: CachedCollect["messages"];
            error?: string;
          }
        | null;
      if (res.ok && body?.messages?.length) {
        setState({
          kind: "ready",
          dialogue: {
            platform: body.platform ?? "plain",
            conversationId: body.conversationId ?? url,
            title: body.title ?? "分享对话",
            url: body.url ?? url,
            messages: body.messages,
            unitCount: Math.floor(body.messages.length / 2),
          },
        });
        return;
      }
      const err = body?.error ?? `采集失败（HTTP ${res.status}）`;
      setState({
        kind: "error",
        message:
          err === "platform_unreachable"
            ? "该平台暂时不可达（可能被反爬拦截）。请稍后重试，或换一个平台的分享链接。"
            : err === "parse_failed"
              ? "无法解析该分享页（页面结构可能已变化）。请确认链接有效后重试。"
              : err === "unsupported_platform"
                ? "暂不支持该平台/链接格式。支持：Claude / ChatGPT / DeepSeek / Gemini / Kimi / 豆包 分享链接。"
                : err === "share_collect_unreachable"
                  ? "采集服务暂不可用，请稍后重试。"
                  : err,
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        auth.expireSession();
        return;
      }
      setState({ kind: "error", message: e instanceof Error ? e.message : "网络错误，请重试" });
    } finally {
      setBusy(false);
    }
  };

  /** 确认入库：POST /api/imports（存 R2 + 建草稿）→ 清本地缓存 → 进编辑页（自动触发润色/质量检测） */
  const confirm = async () => {
    const s = state();
    if (s.kind !== "ready" || busy()) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.request("/api/imports", { method: "POST", body: JSON.stringify(s.dialogue) });
      const body = (await res.json().catch(() => null)) as { episodeId?: string; error?: string } | null;
      if (res.ok && body?.episodeId) {
        if (collectId) void deleteCollect(collectId);
        navigate(`/episodes/${body.episodeId}`);
        return;
      }
      if (res.status === 409) {
        // 已采集过：清本地缓存，直接跳已有草稿（无 episodeId 的并发竞态路径回列表）
        if (collectId) void deleteCollect(collectId);
        navigate(body?.episodeId ? `/episodes/${body.episodeId}` : "/episodes");
        return;
      }
      if (res.status === 403) {
        setActionError("频道未开通——请先到「初始化频道」完成邀请码 + 录音，再回来确认入库。");
      } else {
        setActionError(body?.error ?? `入库失败（HTTP ${res.status}），请重试`);
      }
    } catch (e) {
      // 会话失效（页面停留期间过期/被登出）：清本地状态 → 登录锁定自动出现（URL 不变，
      // 本地缓存未删——重新登录后回到同一 collectId 可继续确认）
      if (e instanceof ApiError && e.status === 401) {
        auth.expireSession();
        return;
      }
      setActionError(e instanceof Error ? e.message : "网络错误，请重试");
    } finally {
      setBusy(false);
    }
  };

  /** 取消：扩展模式清本地缓存关标签；分享链接模式直接回工作台 */
  const cancel = async () => {
    if (collectId) {
      await deleteCollect(collectId);
      // 扩展关标签（绕开 window.close 限制）；扩展未装时回退原生 close，被拦截则回列表页
      const closed = await closeCurrentTab();
      if (!closed) {
        window.close();
        setTimeout(() => navigate("/episodes"), 300);
      }
      return;
    }
    navigate("/episodes");
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
          fallback={<div {...stylex.props(styles.meta)}>{collectId ? "读取采集缓存…" : "采集分享页…"}</div>}
        >
          <Show
            when={state().kind === "input"}
            fallback={
              <Show
                when={ready()}
                fallback={
                  <>
                    <div {...stylex.props(styles.title)}>无法确认采集</div>
                    <div {...stylex.props(styles.meta)}>{errorMessage()}</div>
                    <Button block onClick={() => navigate("/episodes")}>回工作台</Button>
                  </>
                }
              >
                <div {...stylex.props(styles.title)}>确认采集「{ready()!.dialogue.title || "未命名对话"}」</div>
                <Show when={ready()!.dialogue.lowConfidence}>
                  <div {...stylex.props(styles.warn)}>
                    未能按对话结构解析（站点改版或规则未覆盖），已保存页面全文——可能包含导航等噪音。
                    请确认内容后再入库，或取消后重试。
                  </div>
                </Show>
                <div {...stylex.props(styles.meta)}>
                  平台：{PLATFORM_LABEL[ready()!.dialogue.platform] ?? "其他"}
                  {" "}· 共 {ready()!.dialogue.messages.length} 条消息
                  {ready()!.dialogue.unitCount != null && (
                    <> · {ready()!.dialogue.unitCount} 个问答单元</>
                  )}
                  <br />
                  来源：<a {...stylex.props(styles.source)} href={ready()!.dialogue.url} target="_blank">
                    {ready()!.dialogue.url}
                  </a>
                  <br />
                  确认后将对话存入你的工作台并进入编辑（自动进行质量检测）。
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
                  <Button block disabled={busy()} onClick={confirm}>{busy() ? "入库中…" : "确认入库"}</Button>
                  <Button block appear="ghost" disabled={busy()} onClick={cancel}>取消</Button>
                </div>
                <Show when={actionError()}>
                  <div {...stylex.props(styles.error)}>{actionError()}</div>
                </Show>
              </Show>
            }
          >
            {/* 分享链接模式：粘贴链接 → 采集 → 预览确认 */}
            <div {...stylex.props(styles.title)}>从分享链接导入对话</div>
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
                {busy() ? "采集中…" : "采集对话"}
              </Button>
              <Button block appear="ghost" disabled={busy()} onClick={cancel}>回工作台</Button>
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
