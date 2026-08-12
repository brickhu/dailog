import { createSignal, onCleanup, onMount, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { findShareUrl, type PlatformRule } from "../lib/clipboard";

// 剪贴板检测：全站监听——剪贴板/粘贴内容包含受支持的分享链接时，
// 弹层询问是否导入投稿（确认 → /submit?url=… 预填）；同一会话只询问一次。
// 注意：navigator.clipboard.readText() 需要用户手势/授权（被拒静默），
// 可靠路径是 paste 事件（用户主动粘贴 = 用户手势）——两者都接。

const styles = stylex.create({
  overlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  card: {
    maxWidth: "480px",
    width: "calc(100% - 48px)",
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    padding: dimensions.spacing5,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
  },
  title: {
    fontSize: dimensions.fontSizeLg,
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
  },
  desc: {
    fontSize: dimensions.fontSizeSm,
    color: colors.neutral,
    margin: 0,
  },
  link: {
    fontSize: dimensions.fontSizeSm,
    color: colors.brandStrong,
    wordBreak: "break-all",
    margin: 0,
  },
  actions: {
    display: "flex",
    gap: dimensions.spacing3,
    alignItems: "center",
  },
});

export function ClipboardDetector() {
  const { t } = useI18n();
  const [detectedUrl, setDetectedUrl] = createSignal<string | null>(null);
  const [asking, setAsking] = createSignal(false);

  // 平台规则（sharePattern 单一来源在 importer）；拉取失败静默——不弹层也不影响任何功能
  const getRules = async (): Promise<PlatformRule[]> => {
    try {
      const res = await fetch("/v1/importer/platforms");
      if (!res.ok) return [];
      const data = (await res.json()) as { platforms?: PlatformRule[] } | PlatformRule[] | null;
      return Array.isArray(data) ? data : data?.platforms ?? [];
    } catch {
      return [];
    }
  };

  /** 从文本中找出第一个受支持的分享链接；无 → null */
  const maybeAsk = (url: string | null) => {
    if (!url) return;
    if (sessionStorage.getItem("dailog.clipboard.asked")) return;
    setDetectedUrl(url);
    setAsking(true);
  };

  const goSubmit = () => {
    sessionStorage.setItem("dailog.clipboard.asked", "1");
    window.location.href = `/submit?url=${encodeURIComponent(detectedUrl() ?? "")}`;
  };

  const dismiss = () => {
    sessionStorage.setItem("dailog.clipboard.asked", "1");
    setAsking(false);
  };

  onMount(() => {
    let rules: PlatformRule[] = [];
    void (async () => {
      rules = await getRules();
      if (rules.length === 0) return;
      // 页面加载时尝试读剪贴板（可能被浏览器拒绝——静默，paste 兜底）
      try {
        const text = await navigator.clipboard.readText();
        maybeAsk(findShareUrl(text, rules));
      } catch { /* 无权限/被拒：依赖 paste 事件 */ }
    })();
    // 用户粘贴（有手势，浏览器保证可读）→ 实时检测
    const onPaste = async (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? "";
      maybeAsk(findShareUrl(text, rules));
    };
    document.addEventListener("paste", onPaste);
    onCleanup(() => document.removeEventListener("paste", onPaste));
  });

  return (
    <Show when={asking() && detectedUrl()}>
      <div {...stylex.props(styles.overlay)} role="dialog" aria-label={t("clipboard.detectTitle")}>
        <div {...stylex.props(styles.card)}>
          <p {...stylex.props(styles.title)}>{t("clipboard.detectTitle")}</p>
          <p {...stylex.props(styles.desc)}>{t("clipboard.detectDesc")}</p>
          <p {...stylex.props(styles.link)}>{detectedUrl()}</p>
          <div {...stylex.props(styles.actions)}>
            <Button onClick={goSubmit}>{t("clipboard.import")}</Button>
            <Button appear="ghost" onClick={dismiss}>{t("clipboard.later")}</Button>
          </div>
        </div>
      </div>
    </Show>
  );
}
