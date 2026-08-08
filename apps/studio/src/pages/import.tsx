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
  | { kind: "error"; message: string }
  | { kind: "ready"; dialogue: CachedCollect };

export default function CollectPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const collectId = typeof params.collectId === "string" ? params.collectId : null;
  const [state, setState] = createSignal<State>({ kind: "loading" });
  const [busy, setBusy] = createSignal(false);
  const [actionError, setActionError] = createSignal<string | null>(null);

  onMount(async () => {
    if (!collectId) {
      setState({ kind: "error", message: "缺少采集 ID——请从扩展的「采集对话」进入本页。" });
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

  /** 取消：清本地缓存，直接关闭本标签页（不回 AI 对话页） */
  const cancel = async () => {
    if (collectId) await deleteCollect(collectId);
    // 扩展关标签（绕开 window.close 限制）；扩展未装时回退原生 close，被拦截则回列表页
    const closed = await closeCurrentTab();
    if (!closed) {
      window.close();
      setTimeout(() => navigate("/episodes"), 300);
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
          fallback={<div {...stylex.props(styles.meta)}>读取采集缓存…</div>}
        >
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
        </Show>
      </div>
    </div>
  );
}
