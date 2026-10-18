// 节目摘要卡（列表用）：小封面 + 标题 + 元信息（@主播 · 日期 · 时长 + 语言标）。
// 探索页（最新/热门区）与 /browse 检索页共用；纯链接卡片，点击进详情（不内嵌播放按钮）。
// EpisodeSummary 来自 lib/db（"use server"）——type-only import，编译期擦除不进客户端包。
import { Show } from "solid-js";
import { A } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { type StyleXStyles } from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { episodeCoverUrl } from "../lib/env";
import { fmtDate, fmtDuration } from "../lib/format";
import type { EpisodeSummary } from "../lib/db";

const styles = stylex.create({
  card: {
    display: "block",
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    textDecoration: "none",
    color: "inherit",
    overflow: "hidden",
    ":hover": { borderColor: colors.primary },
  },
  thumb: {
    width: "48px",
    height: "48px",
    borderRadius: dimensions.radiusSm,
    objectFit: "cover",
    float: "left",
    marginRight: dimensions.spacing3,
  },
  title: {
    fontWeight: dimensions.fontWeightMedium,
    marginBottom: dimensions.spacing1,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  langTag: {
    display: "inline-block",
    marginLeft: dimensions.spacing2,
    padding: "1px 6px",
    borderRadius: dimensions.radiusSm,
    fontSize: "11px",
    lineHeight: 1.4,
  },
});

export interface EpisodeSummaryCardProps {
  episode: EpisodeSummary;
  /** StyleX 外部样式：最后合并，可覆盖内部任意属性 */
  xstyle?: StyleXStyles;
}

export function EpisodeSummaryCard(props: EpisodeSummaryCardProps) {
  const { t } = useI18n();
  return (
    <A href={`/episode/${props.episode.slug}`} {...stylex.props(styles.card, props.xstyle)}>
      <Show when={episodeCoverUrl(props.episode.id, props.episode.coverUrl)}>
        <img
          src={episodeCoverUrl(props.episode.id, props.episode.coverUrl)!}
          alt={props.episode.title || ""}
          {...stylex.props(styles.thumb)}
        />
      </Show>
      <div {...stylex.props(styles.title)}>{props.episode.title || t("common.unnamed")}</div>
      <div {...stylex.props(styles.meta)}>
        @{props.episode.username} · {fmtDate(props.episode.publishedAt)} · {fmtDuration(props.episode.durationSeconds)}
        {props.episode.language ? (
          <span {...stylex.props(styles.langTag)}>{props.episode.language === "en" ? "EN" : "中"}</span>
        ) : null}
      </div>
    </A>
  );
}
