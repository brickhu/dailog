import { createEffect, createResource, Show, For } from "solid-js";
import { A } from "@solidjs/router";
import { usePlayback, type QueueEpisode } from "../lib/playback";
import { apiBaseForFetch } from "../lib/env";
import { Faq } from "../components/faq";
import { EpisodeCarousel } from "../components/episode-carousel";
import { HeroFlow } from "../components/hero-flow";
import { Button, Icon } from "@dailogues/ui";
import * as stylex from "@stylexjs/stylex";
import { layouts, typography } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { auth } from "../lib/auth-guard";
import { openImportDialog } from "../components/import-dialog";
// use:auth 指令的作用域绑定（babel 编译转换需要；TS 不识 JSX 指令故 void 消除未使用误报）
void auth;

// 首页（传统博客式）：hero 品牌区 + 推荐节目滚屏（EpisodeCarousel 组件，subgrid 继承容器轨道）。
// 播放由全局播放条（PlayerBar）接管——点卡片播放按钮即入队连播，播完自动切下一期；
// 点卡片进详情页（/<episode_id>）。列表数据 = 推荐队列 API（热度分排序 + 语言优先）。
// 推荐区滚屏：每屏 4 条（移动端 2×2）、最多 5 屏（limit=20），末屏不足 4 条灰块补齐；
// 异步加载期间骨架屏占位（透明度脉冲，颜色跟随 surface token 自动适配暗色模式）。

const styles = stylex.create({

  hero: {
    position: "relative", // 动画背景（HeroFlow）绝对定位铺底
    display: "flex",
    flexDirection: "column",
    width: "100%",
    // 高度由内部 containerLg 内容撑开（无固定高度）
    paddingTop: dimensions.spacing12,
    paddingBottom: dimensions.spacing12,
  },
  heroInner: {
    position: "relative", // 叠加层盖在动画背景之上
    zIndex: 1,
  },
  heroText: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
    gridColumn: "1 / -1", // 手机 <640 占满
    // 互斥 range 断点（stylex media 输出顺序不稳定，重叠断点会错乱）
    "@media (640px <= width < 1024px)": {
      gridColumn: "span 5", // 平板 8 列占 5
    },
    "@media (width >= 1024px)": {
      gridColumn: "span 7", // 桌面 12 列占 7
    },
  },
  tagline: {
    margin: 0,
  },
  what: {
    color: colors.foreground,
    margin: 0,
  },
  ctaHint: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  ctaRow: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
    alignItems: "flex-start",
    flexWrap: "wrap",
    paddingTop: dimensions.spacing3,
  },
  cta: {
    display: "inline-flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    width: "fit-content",
    padding: `${dimensions.spacing3} ${dimensions.spacing6}`,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.brand,
    color: colors.onBrand,
    fontWeight: dimensions.fontWeightMedium,
    textDecoration: "none",
    fontSize: dimensions.fontSizeMd,
  },

  listTitleRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    // padding: `${dimensions.spacing8} ${dimensions.spacing8} ${dimensions.spacing4}`,
    "@media (max-width: 640px)": {
      // padding: `${dimensions.spacing6} ${dimensions.spacing4} ${dimensions.spacing3}`,
    },
  },
  listTitle: {
    fontSize: dimensions.fontSizeXl,
    fontWeight: dimensions.fontWeightBold,
  },
  moreLink: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    ":hover": { color: colors.primary },
  },
  statCards: {
    // subgrid 继承 containerLg 轨道：列数/列宽/columnGap 全继承（4/8/12 列断点自动跟随），
    // 不再自声明 gridTemplateColumns；rowGap 需显式（subgrid 只继承列轨道）。
    // 左右 padding 必须去掉——subgrid 轨道与容器轨道对齐，内缩 padding 会让卡片错位
    gridColumn: "1 / -1",
    display: "grid",
    gridTemplateColumns: "subgrid",
    rowGap: dimensions.spacing4,
    paddingBottom: dimensions.spacing8, // 与 FAQ 的间距（垂直方向不影响列轨道对齐）
    "@media (640px <= width < 1024px)": {
      paddingBottom: dimensions.spacing12,
    },
  },
  statCard: {
    gridColumn: "span 4", // 手机 4 列占满 → 单列堆叠
    "@media (640px <= width < 1024px)": {
      gridColumn: "span 2", // 平板 8 列占 2 → 3 张一行
    },
    "@media (width >= 1024px)": {
      gridColumn: "span 4", // 桌面 12 列占 4 → 3 张一行
    },
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: dimensions.spacing2,
    minHeight: "160px",
    padding: dimensions.spacing5,
    borderRadius: dimensions.radiusLg,
    backgroundColor: colors.surface, // 与节目卡片统一灰
    textDecoration: "none",
    color: "inherit",
    textAlign: "center",
    ":hover": { borderColor: colors.primary },
  },
  statTitle: {
    fontSize: "20px",
    fontWeight: dimensions.fontWeightBold,
    color: colors.foreground,
  },
  statLogo: {
    width: "52px",
    height: "52px",
    borderRadius: "50%",
    objectFit: "cover",
  },
  statLogoFallback: {
    width: "52px",
    height: "52px",
    borderRadius: "50%",
    backgroundColor: colors.ink,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "22px",
    color: colors.foreground,
  },
  statLogos: {
    display: "flex",
    gap: dimensions.spacing2,
    alignItems: "center",
  },
  statLogoSmall: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    objectFit: "cover",
  },
  statLogoFallbackSmall: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    backgroundColor: colors.ink,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "16px",
    color: colors.foreground,
  },
  statTags: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: dimensions.spacing2,
  },
  statTag: {
    padding: "2px 10px",
    borderRadius: dimensions.radiusFull,
    backgroundColor: colors.surface, // 与节目卡片同色（surface 底 + ink 描边）
    fontSize: "13px",
    color: colors.foreground,
  },
  statText: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
});

export default function HomePage() {
  const { t, locale } = useI18n();
  const playback = usePlayback();

  // 数据加载统一 createResource（内置 loading/error 状态，各自独立并行）：
  // 推荐队列（热度分 + 语言优先，每屏 4 条 × 最多 5 屏 → limit=20）
  // 推荐队列：SSR 时服务端 fetch（http 基址，数据序列化进 HTML），客户端 hydration 直接用
  const [list] = createResource(async () => {
    const lang = locale() === "en" ? "en" : "zh";
    const r = await fetch(`${apiBaseForFetch}/v1/public/episodes/recommended?lang=${lang}&limit=20`);
    const eps: unknown = r.ok ? await r.json() : null;
    return Array.isArray(eps) && eps.length > 0 ? (eps as QueueEpisode[]) : null;
  });
  // 播放器队列：数据到达时初始化（未激活才灌入，不打断播放）
  createEffect(() => {
    const eps = list();
    if (eps && !playback.activated()) playback.setQueue(eps);
  });
  // 站点头部数据（三个统计卡片）
  const [stats] = createResource(async () => {
    const r = await fetch(`${apiBaseForFetch}/v1/public/stats`);
    return r.ok ? await r.json() : null;
  });
  const [guestLogos] = createResource(async () => {
    const r = await fetch(`${apiBaseForFetch}/v1/public/guests`);
    const d: unknown = r.ok ? await r.json() : null;
    return Array.isArray(d) ? (d as Array<{ name: string; avatar: string | null }>).slice(0, 4) : [];
  });

  return (
    <div {...stylex.props(layouts.page)}>
      {/* 首页全屏动画背景（fixed 视口铺满，z -1 位于内容之下） */}
      <HeroFlow />
      {/* 首屏 hero：内容容器叠加在全屏背景上 */}
      <section {...stylex.props(styles.hero)}>
        <div {...stylex.props(layouts.containerLg, styles.heroInner)}>
          <div {...stylex.props(styles.heroText)}>
            <h1 {...stylex.props(typography.displayMd, styles.tagline)}>{t("home.hero.tagline")}</h1>
            <p {...stylex.props(typography.bodyXl, styles.what)}>{t("home.hero.what")}</p>
            <div {...stylex.props(styles.ctaRow)}>
              <Button
                use:auth={true}
                size="xl"
                icon={<Icon icon="mdi:send" width={16} />}
                onClick={openImportDialog}
              >
                {t("home.hero.submit")}
              </Button>
              {/* <A href="/submit" {...stylex.props(styles.cta)}><Icon icon="mdi:send" width={16} />{t("home.hero.submit")}</A> */}
              <p {...stylex.props(styles.ctaHint)}>{t("home.hero.ctaHint")}</p>
            </div>
          </div>
        </div>
      </section>

      <div {...stylex.props(layouts.containerLg)}>
      <div {...stylex.props(layouts.fullRow, styles.listTitleRow)}>
        <div {...stylex.props(styles.listTitle)}>{t("home.recommended")}</div>
        <A href="/discover" {...stylex.props(styles.moreLink)}>{t("home.hero.browse")}</A>
      </div>

      <EpisodeCarousel episodes={list() ?? null} loading={list.loading} />

      {/* 站点头部统计卡片：主播 / AI 嘉宾 / 访谈期数（subgrid 继承容器轨道，等宽等高灰色区块） */}
      <Show when={stats()}>
        <div {...stylex.props(styles.statCards)}>
          <A href="/hosts" {...stylex.props(styles.statCard)}>
            <div {...stylex.props(styles.statTitle)}>{t("home.statHosts", { count: stats()!.hostCount, plural: stats()!.hostCount === 1 ? "" : "s" })}</div>
            <Show when={stats()!.topHostAvatar} fallback={<div {...stylex.props(styles.statLogoFallback)}>{stats()!.topHost?.slice(0, 1) || "?"}</div>}>
              <img src={stats()!.topHostAvatar!} alt="" {...stylex.props(styles.statLogo)} />
            </Show>
            <div {...stylex.props(styles.statText)}>{stats()!.topHost || ""}</div>
          </A>
          <A href="/guests" {...stylex.props(styles.statCard)}>
            <div {...stylex.props(styles.statTitle)}>{t("home.statGuests", { count: stats()!.guestCount, plural2: stats()!.guestCount === 1 ? "" : "s" })}</div>
            <div {...stylex.props(styles.statLogos)}>
              <For each={guestLogos() ?? []}>
                {(g) => (
                  <Show when={g.avatar} fallback={<div {...stylex.props(styles.statLogoFallbackSmall)}>{g.name.slice(0, 1)}</div>}>
                    <img src={g.avatar!} alt={g.name} {...stylex.props(styles.statLogoSmall)} />
                  </Show>
                )}
              </For>
            </div>
            <div {...stylex.props(styles.statText)}>{t("home.statGuestsSub")}</div>
          </A>
          <A href="/discover" {...stylex.props(styles.statCard)}>
            <div {...stylex.props(styles.statTitle)}>{t("home.statEpisodes", { count: stats()!.episodeCount, plural3: stats()!.episodeCount === 1 ? "" : "s" })}</div>
            <div {...stylex.props(styles.statTags)}>
              <For each={stats()!.topTags}>
                {(tag) => <span {...stylex.props(styles.statTag)}>{tag}</span>}
              </For>
            </div>
            <div {...stylex.props(styles.statText)}>{t("home.statEpisodesSub")}</div>
          </A>
        </div>
      </Show>

      {/* 常见问题（互斥手风琴，双语跟随语言切换） */}
      <div {...stylex.props(layouts.fullRow)}>
      <Faq />
      </div>
      </div>
      </div>
  );
}
