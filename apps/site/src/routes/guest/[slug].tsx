import { A, cache, createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { getGuest } from "../../lib/db";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

// 嘉宾详情页：/guest/<id>（id = platform 枚举值，chatgpt/claude/...）
// 头像 + 名称/平台/简介 + 平台链接 + 参与的节目列表
const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing8,
  },
  header: {
    padding: `${dimensions.spacing8} ${dimensions.spacing4}`,
    marginBottom: dimensions.spacing6,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: dimensions.spacing3,
    textAlign: "center",
  },
  avatar: {
    width: "96px",
    height: "96px",
    borderRadius: "50%",
    objectFit: "cover",
    border: "none",
  },
  avatarFallback: {
    width: "96px",
    height: "96px",
    borderRadius: "50%",
    backgroundColor: colors.ink,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "40px",
    color: colors.background,
  },
  name: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
  },
  platform: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  intro: {
    color: colors.neutral,
    lineHeight: 1.7,
    margin: 0,
    maxWidth: "560px",
  },
  link: {
    display: "inline-block",
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusFull,
    backgroundColor: colors.surface,
    color: colors.primaryStrong,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    ":hover": { opacity: 0.8 },
  },
  listTitle: {
    fontSize: dimensions.fontSizeXl,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing4,
  },
  card: {
    display: "block",
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    marginBottom: dimensions.spacing3,
    textDecoration: "none",
    color: "inherit",
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
    padding: dimensions.spacing8,
  },
  notFound: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
});

function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function GuestPage() {
  const { t } = useI18n();
  const params = useParams<{ slug: string }>();
  // 嘉宾不存在 → 渲染 notFound（200，与频道页「用户不存在」行为一致；
  // SolidStart 流式渲染下依赖异步数据的 404 状态码无法在 flush 前设置）
  // cache：客户端导航间复用嘉宾数据（公开数据），减少重复 DB 查询
  const getGuestCached = cache((slug: string) => getGuest(slug), "guest");
  const data = createAsync<Awaited<ReturnType<typeof getGuest>>>(() => getGuestCached(params.slug));

  return (
    <div {...stylex.props(layouts.page)}>
      <div {...stylex.props(layouts.containerSm)}>
        <div {...stylex.props(layouts.fullRow)}>
        <Show
          when={data()}
          fallback={<div {...stylex.props(styles.notFound)}>{t("guest.notFound")}</div>}
        >
          <div {...stylex.props(styles.header)}>
            <Show when={data()!.avatar} fallback={<div {...stylex.props(styles.avatarFallback)}>{data()!.name.slice(0, 1)}</div>}>
              <img src={data()!.avatar!} alt="" {...stylex.props(styles.avatar)} />
            </Show>
            <div {...stylex.props(styles.name)}>{data()!.name}</div>
            <div {...stylex.props(styles.platform)}>{data()!.platform}</div>
            <Show when={data()!.intro}>
              <p {...stylex.props(styles.intro)}>{data()!.intro}</p>
            </Show>
            <Show when={data()!.url}>
              <a href={data()!.url!} target="_blank" rel="noopener noreferrer" {...stylex.props(styles.link)}>
                {data()!.platform} ↗
              </a>
            </Show>
          </div>
          <div {...stylex.props(styles.listTitle)}>{t("guest.episodes")}</div>
          <Show
            when={data()!.episodes.length > 0}
            fallback={<div {...stylex.props(styles.empty)}>{t("guest.noEpisodes")}</div>}
          >
            <For each={data()!.episodes}>
              {(ep) => (
                <A href={`/episode/${ep.slug}`} {...stylex.props(styles.card)}>
                  <div {...stylex.props(styles.epTitle)}>{ep.title || t("common.unnamed")}</div>
                  <div {...stylex.props(styles.meta)}>
                    {ep.displayName ?? `@${ep.username}`}
                    {ep.publishedAt ? ` · ${new Date(ep.publishedAt).toLocaleDateString("zh-CN")}` : ""}
                    {ep.durationSeconds ? ` · ${fmtDuration(ep.durationSeconds)}` : ""}
                  </div>
                </A>
              )}
            </For>
          </Show>
        </Show>
        </div>
      </div>
    </div>
  );
}
