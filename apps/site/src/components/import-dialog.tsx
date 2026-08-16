// 导入弹框：URL 输入 → 可达性检测 → 确认投稿（可触达后跳 /import?url=… 进入第二步）
// 状态机：input（输入框）→ checking（检测中）→ error（检测失败）
// 打开方式：openImportDialog()（如首页 CTA；未登录场景由 use:auth 守卫先拦截）
import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Button, Dialog } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";

type DialogState = "input" | "checking" | "error";

/** 前端基本校验：http/https + 有域名（后端仍会做完整合法性 + 触达性检查） */
function isUrlLike(input: string): boolean {
  try {
    const url = new URL(input);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
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

// —— 剪贴板实时监控 ——
// 剪贴板含合法 URL（且弹框未开）→ 自动打开弹框并预填 URL。
// 轮询（3s）+ 页面重新可见时检测；权限拒绝/不可用静默（有权限的浏览器生效）。
// 去重：同一 URL 只自动弹一次（用户关闭后不重复打扰；新 URL 才再弹）。
let lastClipboardUrl = "";

async function tryOpenFromClipboard(): Promise<void> {
  if (dialogOpen()) return; // 弹框已开：不打断用户操作
  try {
    const text = await navigator.clipboard.readText();
    const url = text.trim();
    if (url && isUrlLike(url) && url !== lastClipboardUrl) {
      lastClipboardUrl = url;
      setDialogUrl?.(url);
      setDialogState?.("input");
      setDialogFail?.("");
      setDialogOpen(true);
    }
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
  // 剪贴板监控预填通道（组件挂载期间生效）
  setDialogUrl = setUrl;
  setDialogState = setState;
  setDialogFail = setFailMsg;

  const urlInvalid = () => url().trim().length > 0 && !isUrlLike(url().trim());
  const canSubmit = () => url().trim().length > 0 && !urlInvalid();

  const close = () => {
    setDialogOpen(false);
    setState("input");
    setUrl("");
    setFailMsg("");
  };
  const backToInput = () => {
    setState("input");
    setFailMsg("");
  };

  // 确认投稿：可达性检测 → 可触达跳 /import?url=…（第二步，URL 输入那一步已跳过）
  const handleConfirm = async () => {
    setState("checking");
    try {
      const res = await fetch("/v1/submissions/reachable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url().trim() }),
      });
      if (res.ok) {
        const target = url().trim();
        close();
        navigate(`/import?url=${encodeURIComponent(target)}`);
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

  return (
    <Dialog isOpen={dialogOpen()} onOpenChange={(v) => !v && close()} width={480} purpose="form">
      <div {...stylex.props(styles.wrap)}>
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
            {/* 非法 URL 提示（输入框下方） */}
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
      </div>
    </Dialog>
  );
}
