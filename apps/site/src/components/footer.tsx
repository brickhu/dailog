// 全局页脚：最大宽度与内容区一致（1080px）——左侧版权，右侧 X / GitHub / RSS 图标。
// 挂载于根布局（与导航/播放条同级）；底部预留播放条高度（fixed 播放条不遮挡）。
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { A } from "@solidjs/router";

const styles = stylex.create({
  footer: {
    backgroundColor: colors.surface, // 通栏背景
    // stylex 不支持模板字符串内插 token（`1px solid ${colors.ink}` 会被静默丢弃），
    // 单边边框必须拆 longhand + 直接 token 引用
  },
  inner: {
    maxWidth: "1080px",
    margin: "0 auto",
    padding: `${dimensions.spacing6} ${dimensions.spacing8} 88px`, // 底部 88px 预留播放条
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dimensions.spacing4,
    "@media (max-width: 640px)": {
      padding: `${dimensions.spacing5} ${dimensions.spacing4} 88px`,
    },
  },
  copyright: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  links: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing4,
  },
  icon: {
    color: colors.neutral,
    display: "inline-flex",
    ":hover": { color: colors.primary },
  },
});

export function Footer() {
  return (
    <footer {...stylex.props(styles.footer)}>
      <div {...stylex.props(styles.inner)}>
        <p {...stylex.props(styles.copyright)}>© 2026 dailog.fm</p>
        <div {...stylex.props(styles.links)}>
        {/* X */}
        <a href="https://x.com/" target="_blank" rel="noopener noreferrer" {...stylex.props(styles.icon)} aria-label="X">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
        {/* GitHub */}
        <a href="https://github.com/" target="_blank" rel="noopener noreferrer" {...stylex.props(styles.icon)} aria-label="GitHub">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.67.8.56A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
          </svg>
        </a>
        {/* RSS（订阅） */}
        <A href="/feed.xml" {...stylex.props(styles.icon)} aria-label="RSS">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="6" cy="18" r="2.5" />
            <path d="M4 10.5a9.5 9.5 0 0 1 9.5 9.5h-2.6A6.9 6.9 0 0 0 4 13.1V10.5Z" />
            <path d="M4 4a16 16 0 0 1 16 16h-2.7A13.3 13.3 0 0 0 4 6.7V4Z" />
          </svg>
        </A>
        </div>
      </div>
    </footer>
  );
}
