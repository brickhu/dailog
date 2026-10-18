import { A, cache, createAsync } from "@solidjs/router";
import { For, Show, Suspense } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions, global, typography } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { listDiscoverEpisodes, listTopTags, type EpisodeSummary, type TagCount } from "../lib/db";
import { EpisodeSummaryCard } from "../components/episode-summary-card";
import { PickedBanner, PickedBannerSkeleton } from "../components/picked-banner";
import { ListSkeleton } from "../components/page-skeletons";
import { Page } from "../layouts/page";
import { Block, Container } from "../layouts/container";

// 探索页（PRD §5 /discover）：单页四个区域（无 tab 切换）
// ① 精选 banner：picked 池轮播，池空则整个区域不显示
// ② 最新上线的节目：new 口径 10 条 + 「更多」进 /browse?sort=new
// ③ 热门节目：hot 口径（累计播放量）10 条 + 「更多」进 /browse?sort=hot
// ④ 探索更多：节目数最多的标签（前 50），点击进标签检索页 /tag/<tag>
// 数据口径全部在 lib/db 的 listDiscoverEpisodes / listTopTags（与检索页同源）
const SECTION_LIMIT = 10;
/** 精选 banner 最多几张（封面大图较重，池子再大也只取前 N） */
const BANNER_LIMIT = 10;
const TAGS_LIMIT = 50;

const styles = stylex.create({
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
  },
  // 区标题行：标题左、 「更多」右（与首页推荐区同一排版约定）
  sectionTitleRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: dimensions.spacing3,
  },
  sectionTitle: {
    fontSize: dimensions.fontSizeXl,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
  },
  empty: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
  tagList: {
    display: "flex",
    flexWrap: "wrap",
    gap: dimensions.spacing2,
  },
  tag: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: dimensions.spacing1,
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusFull,
    backgroundColor: colors.surface,
    color: colors.foreground,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    ":hover": { borderColor: colors.primary },
  },
  tagCount: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeXs,
  },
});

export default function DiscoverPage() {
  const { t, locale } = useI18n();
  const lang = (): "zh" | "en" => (locale() === "zh" ? "zh" : "en");
  // cache：客户端导航间复用（公开数据无新鲜度问题），减少重复 DB 查询；按 (口径, lang) 分键缓存
  const getEpisodesCached = cache(
    (tab: "new" | "hot" | "picked", limit: number, lang: "zh" | "en") => listDiscoverEpisodes(tab, limit, lang),
    "discover-episodes",
  );
  const picked = createAsync<EpisodeSummary[]>(() => getEpisodesCached("picked", BANNER_LIMIT, lang()));
  const newest = createAsync<EpisodeSummary[]>(() => getEpisodesCached("new", SECTION_LIMIT, lang()));
  const hot = createAsync<EpisodeSummary[]>(() => getEpisodesCached("hot", SECTION_LIMIT, lang()));
  const tags = createAsync<TagCount[]>(() => listTopTags(TAGS_LIMIT));

  return (
    <>
      <Title>{t("discover.title")} · dailog</Title>
      <Page>
        <Container>
          <Block><h1 {...stylex.props(styles.title)}>{t("discover.title")}</h1></Block>
        </Container>

        {/* ① 精选 banner（picked 池空 → 整个区域不渲染） */}
        <Suspense fallback={<Container><Block><PickedBannerSkeleton /></Block></Container>}>
          <Show when={picked()?.length}>
            <Container>
              <Block>
                <PickedBanner episodes={picked()!} />
              </Block>
            </Container>
          </Show>
        </Suspense>

        {/* ② 最新上线的节目 */}
        <Container>
          <Block xstyle={styles.sectionTitleRow}>
            <h2 {...stylex.props(styles.sectionTitle)}>{t("discover.newTitle")}</h2>
            <A href="/browse?sort=new" {...stylex.props(global.linkText, typography.bodyMd)}>
              {t("discover.more")}
            </A>
          </Block>
          <Suspense fallback={<Block><ListSkeleton /></Block>}>
            <Show
              when={newest()?.length}
              fallback={<Block><div {...stylex.props(styles.empty)}>{t("discover.empty")}</div></Block>}
            >
              <For each={newest()}>
                {(ep) => (
                  <Block cols="1/2">
                    <EpisodeSummaryCard episode={ep} />
                  </Block>
                )}
              </For>
            </Show>
          </Suspense>
        </Container>

        {/* ③ 热门节目（累计播放量） */}
        <Container>
          <Block xstyle={styles.sectionTitleRow}>
            <h2 {...stylex.props(styles.sectionTitle)}>{t("discover.hotTitle")}</h2>
            <A href="/browse?sort=hot" {...stylex.props(global.linkText, typography.bodyMd)}>
              {t("discover.more")}
            </A>
          </Block>
          <Suspense fallback={<Block><ListSkeleton /></Block>}>
            <Show
              when={hot()?.length}
              fallback={<Block><div {...stylex.props(styles.empty)}>{t("discover.empty")}</div></Block>}
            >
              <For each={hot()}>
                {(ep) => (
                  <Block cols="1/2">
                    <EpisodeSummaryCard episode={ep} />
                  </Block>
                )}
              </For>
            </Show>
          </Suspense>
        </Container>

        {/* ④ 探索更多：节目数最多的标签（空 → 整个区域不渲染） */}
        <Suspense fallback={<Container><Block><ListSkeleton /></Block></Container>}>
          <Show when={tags()?.length}>
            <Container>
              <Block xstyle={styles.sectionTitleRow}>
                <h2 {...stylex.props(styles.sectionTitle)}>{t("discover.tagsTitle")}</h2>
              </Block>
              <Block xstyle={styles.tagList}>
                <For each={tags()}>
                  {(item) => (
                    <A href={`/tag/${encodeURIComponent(item.tag)}`} {...stylex.props(styles.tag)}>
                      #{item.tag}
                      <span {...stylex.props(styles.tagCount)}>({item.count})</span>
                    </A>
                  )}
                </For>
              </Block>
            </Container>
          </Show>
        </Suspense>
      </Page>
    </>
  );
}
