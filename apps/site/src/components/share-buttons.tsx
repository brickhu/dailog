// 分享按钮（客户端）：X / Facebook / 微博 / Telegram / WhatsApp + 复制链接 + 系统分享。
// 封面展示依赖节目页 OG 标签（og:image），各平台抓取分享卡片。
import { For, Show, createSignal, onMount } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { env } from "../lib/env";
import type { QueueEpisode } from "../lib/playback";

interface ShareTarget {
  name: string;
  icon: string;
  /** 分享 URL 模板：{url} = 页面 URL，{text} = 分享文案（已编码） */
  href: (url: string, text: string) => string;
}

const styles = stylex.create({
  row: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  label: {
    color: colors.neutral,
    fontSize: "13px",
  },
  iconLink: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    backgroundColor: "transparent",
    color: colors.foreground,
    textDecoration: "none",
    fontSize: "15px",
    ":hover": { backgroundColor: colors.surfaceStrong },
  },
  copyBtn: {
    padding: "6px 12px",
    borderRadius: "999px",
    backgroundColor: "transparent",
    color: colors.neutral,
    fontSize: "13px",
    cursor: "pointer",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modal: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px",
    padding: "20px",
    borderRadius: "12px",
    backgroundColor: colors.surface,
    maxWidth: "80vw",
  },
  qrImg: {
    width: "220px",
    height: "220px",
    backgroundColor: "#fff",
    borderRadius: "8px",
    padding: "4px",
  },
  modalUrl: {
    color: colors.neutral,
    fontSize: "12px",
    wordBreak: "break-all",
    textAlign: "center",
    margin: 0,
    maxWidth: "260px",
  },
  modalHint: {
    color: colors.neutral,
    fontSize: "13px",
    textAlign: "center",
    margin: 0,
  },
  closeBtn: {
    position: "absolute",
    top: "8px",
    right: "10px",
    background: "none",
    border: "none",
    color: colors.neutral,
    fontSize: "16px",
    cursor: "pointer",
  },
});

export function ShareButtons(props: { episode: QueueEpisode }) {
  const { t } = useI18n();
  const [copied, setCopied] = createSignal(false);
  // 微信二维码弹层（朋友圈场景：网页无法直接唤起，二维码长按识别/保存发圈）
  const [showWechat, setShowWechat] = createSignal(false);
  const url = () => `${env.siteBaseUrl}/episode/${props.episode.slug}`;
  const text = () => props.episode.title || "dailog";
  // 是否支持 Web Share API（移动端系统分享面板）。
  // ⚠️ 不能 SSR 同步判断（SSR 无 navigator）→ 初始 false 与 SSR 一致，
  // onMount（hydration 完成后）再检测追加按钮，避免 Hydration Mismatch。
  const [nativeSupported, setNativeSupported] = createSignal(false);
  onMount(() => {
    if (typeof navigator !== "undefined" && !!navigator.share) setNativeSupported(true);
  });

  const targets: ShareTarget[] = [
    {
      name: "X", icon: "𝕏",
      href: (u, tx) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(u)}&text=${encodeURIComponent(tx)}`,
    },
    {
      name: "Facebook", icon: "f",
      href: (u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`,
    },
    {
      name: "微博", icon: "微",
      href: (u, tx) => `https://service.weibo.com/share/share.php?url=${encodeURIComponent(u)}&title=${encodeURIComponent(tx)}`,
    },
    {
      name: "Telegram", icon: "✈",
      href: (u, tx) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(tx)}`,
    },
    {
      name: "WhatsApp", icon: "🟢",
      href: (u, tx) => `https://wa.me/?text=${encodeURIComponent(`${tx} ${u}`)}`,
    },
  ];

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板不可用静默 */
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title: text(), url: url() });
    } catch {
      /* 用户取消分享静默 */
    }
  };

  // 打开微信弹层（二维码用外部 QR API 图片，避免 qrcode 包的 Node 依赖污染客户端 bundle）
  const openWechat = () => setShowWechat(true);

  return (
    <div {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.label)}>{t("episode.share")}</span>
      <For each={targets}>
        {(tgt) => (
          <a
            href={tgt.href(url(), text())}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={tgt.name}
            title={tgt.name}
            {...stylex.props(styles.iconLink)}
          >
            {tgt.icon}
          </a>
        )}
      </For>
      <button type="button" {...stylex.props(styles.copyBtn)} onClick={copyLink}>
        {copied() ? t("episode.copied") : t("episode.copyLink")}
      </button>
      <Show when={nativeSupported()}>
        <button type="button" {...stylex.props(styles.copyBtn)} onClick={nativeShare}>
          {t("episode.shareNative")}
        </button>
      </Show>
      {/* 微信：二维码弹层（朋友圈场景） */}
      <button type="button" {...stylex.props(styles.iconLink)} aria-label="微信" title="微信" onClick={openWechat}>
        微
      </button>
      <Show when={showWechat()}>
        <div {...stylex.props(styles.overlay)} onClick={() => setShowWechat(false)}>
          <div {...stylex.props(styles.modal)} onClick={(e) => e.stopPropagation()}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(url())}`}
              alt=""
              width={220}
              height={220}
              {...stylex.props(styles.qrImg)}
            />
            <p {...stylex.props(styles.modalUrl)}>{url()}</p>
            <p {...stylex.props(styles.modalHint)}>{t("episode.wechatHint")}</p>
            <button type="button" {...stylex.props(styles.copyBtn)} onClick={copyLink}>
              {copied() ? t("episode.copied") : t("episode.copyLink")}
            </button>
            <button type="button" {...stylex.props(styles.closeBtn)} onClick={() => setShowWechat(false)}>
              ✕
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
