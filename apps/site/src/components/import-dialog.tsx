// 导入弹框：URL 输入 → 可达性检测 → 确认投稿（可触达后跳 /import?url=… 进入第二步）
// 状态机：input（输入框）→ checking（检测中）→ error（检测失败）
// 打开方式：openImportDialog()（如首页 CTA；未登录场景由 use:auth 守卫先拦截）
import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Button, Dialog } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { isLoggedIn } from "../lib/auth-guard";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";

type DialogState = "input" | "checking" | "error" | "duplicate";

/** 支持的 AI 对话平台分享链接（仅这些平台的分享页 URL 才算合法投稿链接） */
const SHARE_HOSTS = [
  "chat.deepseek.com", "claude.ai", "chatgpt.com", "chat.openai.com",
  "gemini.google.com", "kimi.moonshot.cn", "doubao.com", "www.doubao.com",
  "tongyi.aliyun.com", "perplexity.ai",
];

/** 平台分享链接识别：host 白名单 + 分享路径（/share/ 或 /s/ 或非根路径） */
export function isShareUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (!SHARE_HOSTS.includes(host)) return false;
    const path = url.pathname.replace(/\/+$/, "");
    // 分享页：/share/xxx、/s/xxx，或至少是具体内容路径（非首页）
    return path.length > 1 && (path.includes("/share/") || path.includes("/s/") || path.split("/").length > 2);
  } catch {
    return false;
  }
}


// —— 全局单例（AppShell 挂载；openImportDialog 打开）——
const [dialogOpen, setDialogOpen] = createSignal(false);
// 弹框内部状态（打开时自动预填/重置用）
let setDialogUrl: ((v: string) => void) | null = null;
let setDialogState: ((s: DialogState) => void) | null = null;
let setDialogFail: ((v: string) => void) | null = null;

/** 打开导入弹框 */
export function openImportDialog(): void {
  setDialogOpen(true);
}

// —— submissions 重复检测本地缓存 ——
// 同一 URL 不重复请求 check 端点：已投稿 24h / 未投稿 10min（投稿状态不回退，未投稿
// 可能随后被投）。localStorage 持久（跨刷新）+ 内存 Map（快读）。
interface CheckCacheEntry {
  existing: boolean;
  submissionId?: string;
  episode?: { slug?: string; title?: string | null } | null;
  ts: number;
}
const CHECK_CACHE_KEY = "dailog.submissionCheck";
const CHECK_TTL_EXISTING = 24 * 60 * 60 * 1000;
const CHECK_TTL_NONE = 10 * 60 * 1000;
const CHECK_CACHE_MAX = 100;
const checkCache = new Map<string, CheckCacheEntry>();

function readCheckStore(): Record<string, CheckCacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(CHECK_CACHE_KEY) ?? "{}") as Record<string, CheckCacheEntry>;
  } catch {
    return {};
  }
}
function writeCheckStore(store: Record<string, CheckCacheEntry>): void {
  try {
    localStorage.setItem(CHECK_CACHE_KEY, JSON.stringify(store));
  } catch {
    // 存储不可用（隐私模式等）：仅内存缓存
  }
}

/** 重复检测（带本地缓存）：命中缓存不请求端点 */
async function checkSubmission(url: string): Promise<CheckCacheEntry> {
  const cached = checkCache.get(url) ?? readCheckStore()[url];
  if (cached) {
    const ttl = cached.existing ? CHECK_TTL_EXISTING : CHECK_TTL_NONE;
    if (Date.now() - cached.ts < ttl) return cached;
  }
  try {
    const res = await fetch("/v1/submissions/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json().catch(() => null)) as {
      existing?: boolean;
      submissionId?: string;
      episode?: { slug?: string; title?: string | null } | null;
    } | null;
    const entry: CheckCacheEntry = {
      existing: !!data?.existing,
      submissionId: data?.submissionId ?? undefined,
      episode: data?.episode ?? null,
      ts: Date.now(),
    };
    checkCache.set(url, entry);
    const store = readCheckStore();
    const keys = Object.keys(store);
    if (keys.length >= CHECK_CACHE_MAX) {
      // 超上限：清掉最旧的一半（按 ts）
      keys.sort((a, b) => (store[a]?.ts ?? 0) - (store[b]?.ts ?? 0));
      for (const k of keys.slice(0, Math.floor(CHECK_CACHE_MAX / 2))) delete store[k];
    }
    store[url] = entry;
    writeCheckStore(store);
    return entry;
  } catch {
    return { existing: false, ts: 0 }; // 检测失败：不缓存（调用方走兜底）
  }
}

// —— 剪贴板实时监控 ——
// 剪贴板含合法 URL（且弹框未开）→ 自动打开弹框并预填 URL。
// 轮询（3s）+ 页面重新可见时检测；权限拒绝/不可用静默（有权限的浏览器生效）。
// 去重：同一 URL 只自动弹一次（用户关闭后不重复打扰；新 URL 才再弹）。
let lastClipboardUrl = "";

async function tryOpenFromClipboard(): Promise<void> {
  if (dialogOpen()) return; // 弹框已开：不打断用户操作
  // 剪贴板自动弹框仅登录用户生效（未登录走 use:auth 登录引导，不自动打扰）
  if (!(await isLoggedIn())) return;
  try {
    const text = await navigator.clipboard.readText();
    const url = text.trim();
    // 只对合法平台分享链接自动弹（不要什么 URL 都弹）
    if (!url || !isShareUrl(url) || url === lastClipboardUrl) return;
    lastClipboardUrl = url; // 记录（无论是否弹，避免重复检测/重复打扰）
    // 已投稿过的 URL（重复导入）→ 不弹（弹框内确认投稿时仍有重复兜底；本地缓存命中不请求）
    const check = await checkSubmission(url);
    if (check.existing) return;
    setDialogUrl?.(url);
    setDialogState?.("input");
    setDialogFail?.("");
    setDialogOpen(true);
  } catch {
    // 剪贴板权限拒绝/API 不可用：静默（不打扰）
  }
}

if (typeof document !== "undefined") {
  setInterval(() => void tryOpenFromClipboard(), 3000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void tryOpenFromClipboard();
  });
}

const styles = stylex.create({
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing4,
    padding: `${dimensions.spacing2} 0`,
  },
  title: {
    fontSize: dimensions.fontSizeXl,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
  },
  desc: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
    lineHeight: 1.6,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: `${dimensions.spacing3} ${dimensions.spacing4}`,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.neutralWeak}`,
    fontSize: dimensions.fontSizeMd,
    backgroundColor: colors.background,
    color: colors.foreground,
    outline: "none",
    ":focus": {
      borderColor: colors.brand,
    },
  },
  inputError: {
    borderColor: colors.danger,
  },
  fieldError: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    margin: `${dimensions.spacing1} 0 0`,
  },
  actions: {
    display: "flex",
    gap: dimensions.spacing3,
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
  fail: {
    color: colors.danger,
    fontSize: dimensions.fontSizeMd,
    margin: 0,
    lineHeight: 1.6,
  },
});

/** 导入弹框（URL 输入 + 可达性检测 + 确认投稿） */
export function ImportDialog() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [state, setState] = createSignal<DialogState>("input");
  const [url, setUrl] = createSignal("");
  const [failMsg, setFailMsg] = createSignal("");
  // 重复投稿信息（已投稿 → 提示 + 跳转投稿详情 /submission/<id>）
  const [dupSubmissionId, setDupSubmissionId] = createSignal<string | null>(null);
  const [dupEpisode, setDupEpisode] = createSignal<{ slug: string; title: string | null } | null>(null);
  // 剪贴板监控预填通道（组件挂载期间生效）
  setDialogUrl = setUrl;
  setDialogState = setState;
  setDialogFail = setFailMsg;

  // 输入校验：空 → 禁用确认；非平台分享链接 → 非法提示（输入框下方）
  const urlInvalid = () => url().trim().length > 0 && !isShareUrl(url().trim());
  const canSubmit = () => url().trim().length > 0 && !urlInvalid();

  const close = () => {
    setDialogOpen(false);
    setState("input");
    setUrl("");
    setFailMsg("");
    setDupSubmissionId(null);
    setDupEpisode(null);
  };
  const backToInput = () => {
    setState("input");
    setFailMsg("");
  };

  // 确认投稿：重复检测（已投稿直接提示跳转）→ 可达性检测 → 可触达跳 /submit?url=…（第二步）
  const handleConfirm = async () => {
    setState("checking");
    try {
      // 1) 重复检测：URL 已投稿过 → 提示 + 跳转投稿详情（不再走导入；本地缓存命中不请求）
      const checkData = await checkSubmission(url().trim());
      if (checkData.existing) {
        setDupSubmissionId(checkData.submissionId ?? null);
        const ep = checkData.episode;
        setDupEpisode(ep && ep.slug ? { slug: ep.slug, title: ep.title ?? null } : null);
        setState("duplicate");
        return;
      }
      // 2) 可达性检测
      const res = await fetch("/v1/submissions/reachable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url().trim() }),
      });
      if (res.ok) {
        const target = url().trim();
        close();
        navigate(`/submit?url=${encodeURIComponent(target)}`);
        return;
      }
      const data = (await res.json().catch(() => null)) as { detail?: string } | null;
      setFailMsg(typeof data?.detail === "string" ? data.detail : t("importDialog.unreachable"));
      setState("error");
    } catch {
      setFailMsg(t("importDialog.unreachable"));
      setState("error");
    }
  };

  // 跳转投稿详情：/submission/<id>（公开详情页；拿不到 id 时回退节目页/我的投稿）
  const goSubmission = () => {
    const target = dupSubmissionId()
      ? `/submission/${dupSubmissionId()}`
      : dupEpisode()?.slug
        ? `/episode/${dupEpisode()!.slug}`
        : "/me/submits";
    close();
    navigate(target);
  };

  return (
    <Dialog isOpen={dialogOpen()} onOpenChange={(v) => !v && close()} width={480} purpose="form">
      <div {...stylex.props(styles.wrap)}>
        <Show
          when={state() === "duplicate"}
          fallback={
            <Show
              when={state() !== "error"}
              fallback={
                <>
                  <p {...stylex.props(styles.title)}>{t("submit.import")}</p>
                  <p {...stylex.props(styles.fail)} role="alert">{failMsg()}</p>
                  <div {...stylex.props(styles.actions)}>
                    <Button onClick={backToInput}>{t("importDialog.retry")}</Button>
                    <Button variant="neutral" appear="ghost" onClick={close}>
                      {t("common.cancel")}
                    </Button>
                  </div>
                </>
              }
            >
              <p {...stylex.props(styles.title)}>{t("submit.import")}</p>
              <p {...stylex.props(styles.desc)}>{t("submit.step1Desc")}</p>
              <div>
                <input
                  type="url"
                  value={url()}
                  disabled={state() === "checking"}
                  placeholder={t("submit.urlPlaceholder")}
                  onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && canSubmit() && state() === "input") void handleConfirm(); }}
                  {...stylex.props(styles.input, urlInvalid() && styles.inputError)}
                />
                <Show when={urlInvalid()}>
                  <p {...stylex.props(styles.fieldError)}>{t("submit.urlUnsupported")}</p>
                </Show>
              </div>
              <p {...stylex.props(styles.desc)}>{t("submit.urlHint")}</p>
              <div {...stylex.props(styles.actions)}>
                <Button variant="neutral" appear="ghost" onClick={close}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={() => void handleConfirm()}
                  disabled={!canSubmit() || state() === "checking"}
                  isLoading={state() === "checking"}
                >
                  {t("submit.import")}
                </Button>
              </div>
            </Show>
          }
        >
          {/* duplicate：URL 已投稿 → 提示 + 查看投稿详情 */}
          <p {...stylex.props(styles.title)}>{t("importDialog.duplicate")}</p>
          <p {...stylex.props(styles.desc)}>{t("importDialog.duplicateHint")}</p>
          <Show when={dupEpisode()}>
            <p {...stylex.props(styles.fail)}>{dupEpisode()!.title}</p>
          </Show>
          <div {...stylex.props(styles.actions)}>
            <Button onClick={goSubmission}>{t("importDialog.viewSubmission")}</Button>
            <Button variant="neutral" appear="ghost" onClick={close}>
              {t("common.cancel")}
            </Button>
          </div>
        </Show>
      </div>
    </Dialog>
  );
}
