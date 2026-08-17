// 分享（统一按钮 + 弹窗）：ShareButton 一体化（外部触发按钮 + ShareDialog 弹窗），
// 所有分享渠道收进弹窗：X / Facebook / 微博 / Telegram / WhatsApp + 复制链接 +
// 系统分享（Web Share API）+ 微信二维码（朋友圈场景）。
// 封面展示依赖节目页 OG 标签（og:image），各平台抓取分享卡片。
import { For, Show, createSignal, onMount } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button, Dialog, Icon } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
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
  // —— 弹窗内容 ——
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing4,
  },
  title: {
    fontSize: dimensions.fontSizeLg,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: dimensions.spacing2,
  },
  // 渠道项：圆形图标 + 名字（竖排）
  target: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: dimensions.spacing1,
    padding: `${dimensions.spacing2} ${dimensions.spacing1}`,
    borderRadius: dimensions.radiusMd,
    backgroundColor: "transparent",
    border: "none",
    color: colors.foreground,
    cursor: "pointer",
    textDecoration: "none",
    fontSize: dimensions.fontSizeSm,
    ":hover": { backgroundColor: colors.surfaceStrong },
  },
  targetIcon: {
    width: "44px",
    height: "44px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    backgroundColor: colors.surface,
    fontSize: "20px",
  },
  // 微信二维码（弹窗内联展开）
  qr: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: dimensions.spacing2,
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
  },
  qrImg: {
    width: "200px",
    height: "200px",
    backgroundColor: "#fff",
    borderRadius: "8px",
    padding: "4px",
  },
  qrUrl: {
    color: colors.neutral,
    fontSize: "12px",
    wordBreak: "break-all",
    textAlign: "center",
    margin: 0,
    maxWidth: "240px",
  },
  hint: {
    color: colors.neutral,
    fontSize: "13px",
    textAlign: "center",
    margin: 0,
  },
  actionRow: {
    display: "flex",
    gap: dimensions.spacing2,
  },
});

/** 分享目标（平台列表） */
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

/**
 * 分享弹窗（受控）：所有分享渠道收进弹窗。外部用 ShareButton 触发；
 * 需要自定义触发方式的场景可单独使用本组件（isOpen/onOpenChange 受控）。
 */
export function ShareDialog(props: {
  episode: QueueEpisode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => unknown;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = createSignal(false);
  // 微信二维码（朋友圈场景：网页无法直接唤起，二维码长按识别/保存发圈）
  const [showWechat, setShowWechat] = createSignal(false);
  // Web Share API（移动端系统分享面板）——SSR 不能同步判断，onMount 后检测
  const [nativeSupported, setNativeSupported] = createSignal(false);
  onMount(() => {
    if (typeof navigator !== "undefined" && !!navigator.share) setNativeSupported(true);
  });

  const url = () => `${env.siteBaseUrl}/episode/${props.episode.slug}`;
  const text = () => props.episode.title || "dailog";

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

  return (
    <Dialog isOpen={props.isOpen} onOpenChange={props.onOpenChange} width={360} purpose="info">
      <div {...stylex.props(styles.wrap)}>
        <p {...stylex.props(styles.title)}>{t("episode.share")}</p>
        <div {...stylex.props(styles.grid)}>
          <For each={targets}>
            {(tgt) => (
              <a
                href={tgt.href(url(), text())}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={tgt.name}
                title={tgt.name}
                {...stylex.props(styles.target)}
              >
                <span {...stylex.props(styles.targetIcon)}>{tgt.icon}</span>
                {tgt.name}
              </a>
            )}
          </For>
          {/* 微信：二维码内联展开 */}
          <button type="button" {...stylex.props(styles.target)} onClick={() => setShowWechat((v) => !v)}>
            <span {...stylex.props(styles.targetIcon)}>微</span>
            微信
          </button>
        </div>
        <div {...stylex.props(styles.actionRow)}>
          <Button variant="neutral" appear="outline" onClick={copyLink}>
            {copied() ? t("episode.copied") : t("episode.copyLink")}
          </Button>
          <Show when={nativeSupported()}>
            <Button variant="neutral" appear="outline" onClick={nativeShare}>
              {t("episode.shareNative")}
            </Button>
          </Show>
        </div>
        <Show when={showWechat()}>
          <div {...stylex.props(styles.qr)}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(url())}`}
              alt=""
              width={200}
              height={200}
              {...stylex.props(styles.qrImg)}
            />
            <p {...stylex.props(styles.qrUrl)}>{url()}</p>
            <p {...stylex.props(styles.hint)}>{t("episode.wechatHint")}</p>
          </div>
        </Show>
      </div>
    </Dialog>
  );
}

/** 统一分享按钮：触发 ShareDialog（所有分享渠道在弹窗内） */
export function ShareButton(props: { episode: QueueEpisode }) {
  const { t } = useI18n();
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <Button
        variant="neutral"
        appear="outline"
        icon={<Icon icon="mdi:share-variant" width={16} />}
        onClick={() => setOpen(true)}
      >
        {t("episode.share")}
      </Button>
      <ShareDialog episode={props.episode} isOpen={open()} onOpenChange={setOpen} />
    </>
  );
}
