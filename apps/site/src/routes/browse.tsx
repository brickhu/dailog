// 检索页 /browse?sort=new|hot&page=N：探索页「最新上线 / 热门节目」两区「更多」的落地页。
// 排序口径与探索页同源（lib/db 的 listDiscoverEpisodes），区别只是分页浏览（每页 20 条）。
// sort 参数非法/缺失一律按 new（不报错，直接给默认口径）；page 超出范围时夹到最后一页
// （URL 不改写，翻页链接一律用夹取后的「有效页码」生成）。
import { A, cache, createAsync, useSearchParams } from "@solidjs/router";
import { createEffect, For, on, Show, Suspense } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { countDiscoverEpisodes, listDiscoverEpisodes, type EpisodeSummary } from "../lib/db";
import { EpisodeSummaryCard } from "../components/episode-summary-card";
import { ListSkeleton } from "../components/page-skeletons";
import { Page } from "../layouts/page";
import { Block, Container } from "../layouts/container";

const PAGE_SIZE = 20;

interface BrowsePageData {
  items: EpisodeSummary[];
  total: number;
  /** 夹取后的有效页码（1 起） */
  page: number;
  pages: number;
}

const styles = stylex.create({
  header: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing1,
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
  empty: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
  pager: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: dimensions.spacing4,
    paddingTop: dimensions.spacing4,
  },
  pageLink: {
    padding: `${dimensions.spacing2} ${dimensions.spacing4}`,
    borderRadius: dimensions.radiusFull,
    backgroundColor: colors.surface,
    color: colors.foreground,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    ":hover": { borderColor: colors.primary },
  },
  // 边界页（无上一页/下一页）：保留占位，避免翻页按钮左右跳动
  pageLinkDisabled: {
    padding: `${dimensions.spacing2} ${dimensions.spacing4}`,
    borderRadius: dimensions.radiusFull,
    backgroundColor: colors.surface,
    color: colors.neutralWeak,
    fontSize: dimensions.fontSizeSm,
    cursor: "default",
  },
  pageInfo: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
});

export default function BrowsePage() {
  const { t, locale } = useI18n();
  const [params] = useSearchParams<{ sort?: string; page?: string }>();
  // 只有 new / hot 两个口径（其余值回落 new）；query 变化 → 信号变化 → createAsync 重取
  const sort = () => (params.sort === "hot" ? "hot" : "new");
  const rawPage = () => {
    const n = Number(params.page);
    return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
  };
  // 一页数据 + 总数：先取总数算出有效页码再取当页（页码越界 → 落在最后一页）
  const getPageData = cache(async (sort: "new" | "hot", page: number, lang: "zh" | "en"): Promise<BrowsePageData> => {
    const total = await countDiscoverEpisodes(sort);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const effective = Math.min(Math.max(1, page), pages);
    const items = await listDiscoverEpisodes(sort, PAGE_SIZE, lang, (effective - 1) * PAGE_SIZE);
    return { items, total, page: effective, pages };
  }, "browse-page");
  const data = createAsync<BrowsePageData>(() => getPageData(sort(), rawPage(), locale() === "zh" ? "zh" : "en"));
  const heading = () => t(sort() === "hot" ? "discover.hotTitle" : "discover.newTitle");
  const pageHref = (page: number) => `/browse?sort=${sort()}&page=${page}`;

  // 翻页后回到列表顶部（同 pathname 不同 query 不重挂载，onMount 不重跑——用 createEffect 响应 page；
  // defer 跳过首屏，避免从探索页进来时被强制滚到顶部）
  let listTop: HTMLElement | undefined;
  createEffect(
    on(rawPage, () => listTop?.scrollIntoView({ block: "start" }), { defer: true }),
  );

  return (
    <>
      <Title>{heading()} · dailog</Title>
      <Page>
        <Container>
          <Block xstyle={styles.header}>
            <h1 ref={(el) => (listTop = el)} {...stylex.props(styles.title)}>{heading()}</h1>
          </Block>
          <Suspense fallback={<Block><ListSkeleton /></Block>}>
            <Show when={data()}>
              {(page) => (
                <>
                  <Block>
                    <p {...stylex.props(styles.sub)}>
                      {t("discover.browseCount", { count: page().total })}
                    </p>
                  </Block>
                  <Show
                    when={page().items.length}
                    fallback={<Block><div {...stylex.props(styles.empty)}>{t("discover.empty")}</div></Block>}
                  >
                    <For each={page().items}>
                      {(ep) => (
                        <Block cols="1/2">
                          <EpisodeSummaryCard episode={ep} />
                        </Block>
                      )}
                    </For>
                  </Show>
                  {/* 翻页条：单页时整条不渲染 */}
                  <Show when={page().pages > 1}>
                    <Block xstyle={styles.pager}>
                      <Show
                        when={page().page > 1}
                        fallback={<span {...stylex.props(styles.pageLinkDisabled)}>{t("browse.prev")}</span>}
                      >
                        <A href={pageHref(page().page - 1)} {...stylex.props(styles.pageLink)}>
                          {t("browse.prev")}
                        </A>
                      </Show>
                      <span {...stylex.props(styles.pageInfo)}>
                        {t("browse.pager", { page: page().page, pages: page().pages })}
                      </span>
                      <Show
                        when={page().page < page().pages}
                        fallback={<span {...stylex.props(styles.pageLinkDisabled)}>{t("browse.next")}</span>}
                      >
                        <A href={pageHref(page().page + 1)} {...stylex.props(styles.pageLink)}>
                          {t("browse.next")}
                        </A>
                      </Show>
                    </Block>
                  </Show>
                </>
              )}
            </Show>
          </Suspense>
        </Container>
      </Page>
    </>
  );
}
