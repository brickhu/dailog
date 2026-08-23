import { A, cache, createAsync, useParams } from "@solidjs/router";
import { For, Show, Suspense } from "solid-js";
import { Title } from "@solidjs/meta";
import { listEpisodesByTag, type EpisodeSummary } from "../../lib/db";
import { episodeCoverUrl } from "../../lib/env";
import { ListSkeleton } from "../../components/page-skeletons";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

// 标签检索页：/tag/<tag>（tag 为 URL 编码段——中文标签即 percent-encoded，路由 param 不解码，
// 页面内 decodeURIComponent 还原）。详情页 tags 胶囊链接到此，检索含该标签的全部公开节目（发布时间倒序）。
const styles = stylex.create({
  header: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
    marginBottom: dimensions.spacing6,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
  },
  sub: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  card: {
    display: "block",
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    marginBottom: dimensions.spacing3,
    textDecoration: "none",
    color: "inherit",
    overflow: "hidden",
  },
  thumb: {
    width: "48px",
    height: "48px",
    borderRadius: dimensions.radiusSm,
    objectFit: "cover",
    float: "left",
    marginRight: dimensions.spacing3,
  },
  epTitle: {
    fontWeight: dimensions.fontWeightMedium,
    marginBottom: dimensions.spacing1,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  empty: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
});

function fmtDate(d: Date | null): string {
  return d ? new Date(d).toLocaleDateString("zh-CN") : "";
}

function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function TagPage() {
  const { t } = useI18n();
  const params = useParams<{ tag: string }>();
  // 路由 param 是 URL 编码段（中文标签 percent-encoded）——解码为真实标签名用于查询/展示；
  // 个别字符解码失败（如含非法 % 序列）时回退原始段，避免整页崩溃
  const tag = () => {
    try {
      return decodeURIComponent(params.tag);
    } catch {
      return params.tag;
    }
  };
  // cache：客户端导航间复用（公开数据），减少重复 DB 查询（不同标签参数 → 不同缓存条目）
  const getByTagCached = cache((name: string) => listEpisodesByTag(name), "tag-episodes");
  const episodes = createAsync<EpisodeSummary[]>(() => getByTagCached(tag()));

  return (
    <div {...stylex.props(layouts.page)}>
      <div {...stylex.props(layouts.containerSm)}>
        <div {...stylex.props(layouts.fullRow)}>
          <Title>{t("tag.title", { tag: tag() })} · dailog</Title>
          <Suspense fallback={<ListSkeleton />}>
            <div {...stylex.props(styles.header)}>
              <h1 {...stylex.props(styles.title)}>#{tag()}</h1>
              <Show when={episodes()}>
                <p {...stylex.props(styles.sub)}>{t("tag.count", { count: episodes()!.length })}</p>
              </Show>
            </div>
            <Show
              when={episodes() && episodes()!.length > 0}
              fallback={<div {...stylex.props(styles.empty)}>{t("tag.empty")}</div>}
            >
              <For each={episodes()}>
                {(ep) => (
                  <A href={`/episode/${ep.slug}`} {...stylex.props(styles.card)}>
                    <Show when={episodeCoverUrl(ep.id, ep.coverUrl)}>
                      <img src={episodeCoverUrl(ep.id, ep.coverUrl)!} alt={ep.title || ""} {...stylex.props(styles.thumb)} />
                    </Show>
                    <div {...stylex.props(styles.epTitle)}>{ep.title || t("common.unnamed")}</div>
                    <div {...stylex.props(styles.meta)}>
                      {ep.displayName ?? `@${ep.username}`}
                      {ep.publishedAt ? ` · ${fmtDate(ep.publishedAt)}` : ""}
                      {ep.durationSeconds ? ` · ${fmtDuration(ep.durationSeconds)}` : ""}
                    </div>
                  </A>
                )}
              </For>
            </Show>
          </Suspense>
        </div>
      </div>
    </div>
  );
}
