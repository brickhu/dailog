// 节目卡片滚屏容器（推荐/列表共用）：
// - 不包含标题行（调用方自行渲染）；必须放在 containerLg 网格内
// - subgrid 继承 containerLg 轨道：根 1/-1 → 卡片 span 3(≥1025)/span 2（8 列 4 张一行、4 列 2×2）
// - 屏们重叠在同一行（grid-row: 1），切换 = 每屏自身 translateX((i-cur)*100%) 平移
// - 数据由调用方传入（null = 加载中显示骨架屏）；分页/播放/预取/灰块补齐内置
import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Button, Icon } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { usePlayback, type QueueEpisode } from "../lib/playback";
import { getEpisodeCached } from "../lib/episode-cache";
import { EpisodeCard } from "./episode-card";


// 断点标签（值同 theme.stylex.const.ts——stylex babel 插件不支持跨文件常量解析，
// 本地定义保持一致；改断点请同步 theme.stylex.const.ts）
const DESKTOP = "@media (width >= 1024px)";
const TABLET = "@media (640px <= width < 1024px)";

const styles = stylex.create({
  // subgrid 只能继承直接父 grid 的轨道 → 链路每层都必须是 grid + subgrid：
  // 根(1/-1) → viewport(1/-1) → 屏(1/-1, grid-row:1 重叠) → 卡片(span 3/2/2)。
  // （subgrid 与横向 auto-flow 互斥——auto-flow 会把子项塞进单列轨道）
  root: {
    gridColumn: "1 / -1", // 占满 containerLg 全部轨道（12/8/4 列均生效）
    display: "grid",
    gridTemplateColumns: "subgrid",
    position: "relative", // 外侧翻页按钮的定位容器
  },
  viewport: {
    gridColumn: "1 / -1",
    display: "grid",
    gridTemplateColumns: "subgrid",
    overflow: "hidden",
    // 滑动切换的交互区域（触摸/拖动）；卡片点击（进详情）不受影响
    touchAction: "pan-y", // 横向手势归本组件（纵向滚动交给页面）
    userSelect: "none",
  },
  // 外侧翻页按钮：hover 容器时淡入，垂直居中于容器中线。
  // 完全位于容器之外：-52px = 按钮宽 40px + 距容器边缘 12px（按钮右/左缘贴 12px 间距）
  sideNav: {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: 2,
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: "0.2s",
    transitionTimingFunction: "ease",
    // 触摸设备无 hover + 窄视口（容器贴边时外侧按钮会被裁剪）→ 不显示（滑动/拖动替代）。
    // 1280 视口下容器居中（1128 宽），按钮 -52px 两侧仍可见；1279 及以下贴边才隐藏
    "@media (hover: none)": { display: "none" },
    "@media (max-width: 1279px)": { display: "none" },
  },
  sideNavVisible: {
    opacity: 1,
  },
  sideNavPrev: {
    left: "-52px", // 按钮右缘距容器左缘 12px
  },
  sideNavNext: {
    right: "-52px", // 按钮左缘距容器右缘 12px
  },
  // ---- 底部圆点指示器（可点击跳转；纯圆点，无箭头） ----
  dots: {
    gridColumn: "1 / -1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: dimensions.spacing2,
    paddingTop: dimensions.spacing4,
  },
  dot: {
    width: "8px",
    height: "8px",
    padding: 0,
    borderRadius: dimensions.radiusFull,
    backgroundColor: colors.surfaceStrong,
    cursor: "pointer",
    ":hover": { backgroundColor: colors.neutral },
  },
  dotActive: {
    backgroundColor: colors.brand,
    ":hover": { backgroundColor: colors.brand },
  },
  pagePane: {
    gridColumn: "1 / -1",
    gridRow: "1", // 所有屏重叠在同一行（多屏切换靠各自 transform 平移）
    minWidth: "100%",
    display: "grid",
    gridTemplateColumns: "subgrid", // 卡片直接继承 containerLg 轨道（columnGap 也继承）
    rowGap: dimensions.spacing4, // subgrid 只继承列轨道；行 gap 需显式（2×2 时行间距）
    transition: "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
  },
  // 节目卡片/灰块：12 列占 3（4 张一行）、8 列占 2（4 张一行）、4 列占 2（2×2）
  cardSpan: {
    gridColumn: "span 2",
[DESKTOP]: {
      gridColumn: "span 3",
    },
  },
  grayBlock: {
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface, // 与卡片同底色的灰块占位
    // 固定高度：2×2 时第二行可能全是灰块（没有卡片撑起行高，空 div 高度 0 会塌陷）；
    // 高度按对应断点卡片高度取整（封面 aspect 1:1 + 标题/meta/按钮 ≈ +100px）
    minHeight: "270px",
[TABLET]: {
      minHeight: "310px",
    },
[DESKTOP]: {
      minHeight: "370px",
    },
  },
  // ---- 骨架屏（异步加载占位）：subgrid 继承 containerLg 轨道，卡片同真实卡片 span ----
  skeletonGrid: {
    gridColumn: "1 / -1",
    display: "grid",
    gridTemplateColumns: "subgrid",
    rowGap: dimensions.spacing4,
  },
  skeletonCard: {
    // 复用 card 的底板/内边距，仅占位不可点击
  },
  skeletonBlock: {
    backgroundColor: colors.surface,
    animationName: stylex.keyframes({
      from: { opacity: 0.55 },
      to: { opacity: 1 },
    }),
    animationDuration: "0.9s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
    animationDirection: "alternate",
  },
  skeletonCover: {
    width: "100%",
    aspectRatio: "1 / 1",
    borderRadius: dimensions.radiusSm,
  },
  skeletonLine: {
    height: "14px",
    borderRadius: dimensions.radiusSm,
  },
  skeletonLineTitle: {
    width: "70%",
  },
  skeletonBtn: {
    width: "56px",
    height: "24px",
    borderRadius: dimensions.radiusFull,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    padding: dimensions.spacing3,
    cursor: "pointer",
    alignSelf: "flex-start", // 卡片不被网格行拉伸：不同高度的分页互不影响，避免空卡片被撑成大片空白
    ":hover": { borderColor: colors.primary },
  },
  cover: {
    width: "100%",
    aspectRatio: "1 / 1",
    objectFit: "cover",
    borderRadius: dimensions.radiusSm,
  },
  // 无封面节目：封面占位块（灰底 + 播客图标），保持卡片结构完整
  coverFallback: {
    width: "100%",
    aspectRatio: "1 / 1",
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.surfaceStrong,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "40px",
    color: colors.neutral,
    userSelect: "none",
  },
  title: {
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  playBtn: {
    alignSelf: "flex-start",
    padding: `${dimensions.spacing1} ${dimensions.spacing4}`,
    borderRadius: dimensions.radiusFull,
    backgroundColor: "transparent",
    color: colors.brandStrong,
    fontSize: dimensions.fontSizeSm,
    cursor: "pointer",
  },
  playBtnActive: {
    backgroundColor: colors.brand,
    color: colors.onBrand,
  },
  cardActions: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    flexWrap: "wrap",
  },
  playingTime: {
    color: colors.neutral,
    fontSize: "12px",
    fontVariantNumeric: "tabular-nums",
  },
  empty: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
});

const PAGE_SIZE = 4;
const MAX_PAGES = 5;

export function EpisodeCarousel(props: {
  /** 节目列表；null = 加载中（骨架屏占位）。数据更新自动回到第一屏 */
  episodes: QueueEpisode[] | null;
  /** 是否加载中（episodes 为 null 且 loading 时显示骨架屏；加载完仍空显示 empty） */
  loading: boolean;
}) {
  const { t } = useI18n();
  const playback = usePlayback();
  const navigate = useNavigate();
  const [page, setPage] = createSignal(0); // 当前屏
  const [hovered, setHovered] = createSignal(false); // 容器 hover（外侧翻页按钮显示）
  // 触摸设备（无 hover）：外侧翻页按钮直接不渲染（CSS hover:none 隐藏 + 组件层双保险）
  const [isTouch, setIsTouch] = createSignal(false);
  onMount(() => {
    setIsTouch((typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches) ?? false);
  });

  // 数据刷新（引用变化）→ 回到第一屏（clamp 保护）
  createEffect(() => {
    props.episodes;
    setPage(0);
  });

  // 当前播放中的节目（卡片三态按钮与播放条高亮用）
  const isCurrent = (id: string) => playback.current()?.id === id;
  // 分页：每屏 4 条、最多 5 屏；末屏不足 4 条由灰块补齐
  const pageCount = () =>
    props.episodes?.length ? Math.min(MAX_PAGES, Math.ceil(props.episodes.length / PAGE_SIZE)) : 0;
  const pageIndexes = () => Array.from({ length: pageCount() }, (_, i) => i);
  const pageItems = (i: number) => props.episodes!.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);
  const curPage = () => Math.max(0, Math.min(page(), pageCount() - 1));

  // ---- 滑动切换（触摸/拖动 + macOS 触控板 wheel）：横向手势跟随/累积，超阈值翻页 ----
  const SWIPE_THRESHOLD = 80; // px：超过才切换
  let paneRefs: (HTMLDivElement | undefined)[] = [];
  let dragStartX = 0;
  let dragging = false;
  let moved = false; // 是否已确认为拖动（超过 8px 才开始捕获指针/移动内容）
  // 触控板横向滚动（wheel deltaX）累积翻页；一次手势最多翻一屏：
  // 事件间隔超过 GESTURE_GAP_MS 视为新手势（重置累积与翻页标记）——
  // 大幅横扫的惯性事件流（连续触发）不会连续翻页
  // 触控板横向滚动（wheel deltaX）累积翻页；单次手势最多翻一屏：
  // 手势边界 = 事件流停顿（间隔 ≥ GESTURE_GAP 判定新手势，重置累积与翻页标记）。
  // 所有事件都刷新时间戳：惯性是连续事件流（间隔 8-16ms）永远不触发边界 → 不连翻；
  // 停顿后（无论多久）再滑必然触发边界 → 立即生效
  let wheelAccum = 0;
  let wheelLastTs = 0;
  let wheelGestured = false; // 当前手势是否已翻页
  const WHEEL_GESTURE_GAP_MS = 50;

  // 拖动中：所有屏统一加 delta 偏移（跟随手指）
  const applyDrag = (delta: number) => {
    for (let i = 0; i < paneRefs.length; i++) {
      const el = paneRefs[i];
      if (!el) continue;
      el.style.transform = `translateX(calc(${(i - curPage()) * 100}% + ${delta}px))`;
    }
  };
  // 弹回/复位：transition 已恢复 → 平滑回到各屏原位
  const resetDrag = () => {
    for (let i = 0; i < paneRefs.length; i++) {
      const el = paneRefs[i];
      if (!el) continue;
      el.style.transition = "";
      el.style.transform = `translateX(${(i - curPage()) * 100}%)`;
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (pageCount() <= 1) return;
    if (e.pointerType === "mouse" && e.button !== 0) return; // 仅左键/触摸
    dragging = true;
    dragStartX = e.clientX;
    moved = false;
    for (const el of paneRefs) if (el) el.style.transition = "none"; // 拖动中不跟过渡
    // 不立即捕获指针：纯点击（播放按钮等）保持正常 click——capture 后 pointerup
    // 重定向到视口，与按下目标不一致会吞掉 click
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const delta = e.clientX - dragStartX;
    // 确认是拖动（超过 8px）后才捕获：保证移出视口时手势不中断，同时纯点击不受影响
    if (!moved && Math.abs(delta) > 8) {
      moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    if (moved) applyDrag(delta);
  };
  const onPointerEnd = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    const delta = e.clientX - dragStartX;
    const canPrev = curPage() > 0;
    const canNext = curPage() < pageCount() - 1;
    // 恢复过渡（拖动中禁用）：翻页时 Solid 重渲染更新 transform，从拖动位置动画到目标屏；
    // 弹回时 resetDrag 手动复位（同样带过渡）
    for (const el of paneRefs) if (el) el.style.transition = "";
    // swipe 方向：从右往左拖（向左）→ 下一页；从左往右拖（向右）→ 上一页
    if (Math.abs(delta) >= SWIPE_THRESHOLD && delta < 0 && canNext) setPage(curPage() + 1);
    else if (Math.abs(delta) >= SWIPE_THRESHOLD && delta > 0 && canPrev) setPage(curPage() - 1);
    else resetDrag(); // 未达阈值或已在边界：弹回原点
    // 拖动超过 5px 视为手势：吞掉随后的 click（防止松手误触卡片进详情）
    if (Math.abs(delta) > 5) {
      const viewport = e.currentTarget as HTMLElement;
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        viewport.removeEventListener("click", swallow, true);
      };
      viewport.addEventListener("click", swallow, true);
    }
  };
  // macOS 触控板横扫 / 鼠标横向滚轮：wheel deltaX 累积，超阈值翻页（纵向滚动不拦截）。
  // 单次手势最多一屏：事件流停顿（GESTURE_GAP）即新手势边界
  const onWheel = (e: WheelEvent) => {
    if (pageCount() <= 1) return;
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) return; // 纵向意图（页面滚动）→ 放行
    const now = Date.now();
    if (now - wheelLastTs >= WHEEL_GESTURE_GAP_MS) {
      wheelAccum = 0;
      wheelGestured = false; // 事件流停顿 → 新手势（重置累积与翻页标记）
    }
    wheelLastTs = now; // 每次事件都刷新：惯性连续流不触发边界 → 不连翻
    if (wheelGestured) return; // 本次手势已翻页：后续（惯性）忽略
    wheelAccum += e.deltaX;
    const canPrev = curPage() > 0;
    const canNext = curPage() < pageCount() - 1;
    if (Math.abs(wheelAccum) >= SWIPE_THRESHOLD) {
      // 横扫方向与拖动一致：从右往左滑（deltaX 正）→ 下一页；从左往右滑（deltaX 负）→ 上一页
      if (wheelAccum > 0 && canNext) {
        setPage(curPage() + 1);
        wheelAccum = 0;
        wheelGestured = true;
      } else if (wheelAccum < 0 && canPrev) {
        setPage(curPage() - 1);
        wheelAccum = 0;
        wheelGestured = true;
      } else {
        wheelAccum = 0; // 边界：重置
      }
    }
    e.preventDefault(); // 阻止页面横向滚动（横向意图归本组件）
  };
  // 阻止原生拖拽（拖卡片图片会触发浏览器 drag ghost，打断 pointer 拖动）
  const onDragStart = (e: DragEvent) => {
    if (pageCount() > 1) e.preventDefault();
  };

  return (
    <div
      {...stylex.props(styles.root)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <Show
        when={props.episodes?.length}
        fallback={
          <Show when={props.loading} fallback={<div {...stylex.props(styles.empty)}>{t("common.empty")}</div>}>
            {/* 异步加载中：骨架屏占位（subgrid 继承容器轨道，卡片同真实卡片尺寸） */}
            <div {...stylex.props(styles.skeletonGrid)}>
              <For each={Array.from({ length: 4 })}>
                {() => (
                  <div {...stylex.props(styles.card, styles.skeletonCard, styles.cardSpan)}>
                    <div {...stylex.props(styles.skeletonBlock, styles.skeletonCover)} />
                    <div {...stylex.props(styles.skeletonBlock, styles.skeletonLine, styles.skeletonLineTitle)} />
                    <div {...stylex.props(styles.skeletonBlock, styles.skeletonLine)} />
                    <div {...stylex.props(styles.skeletonBlock, styles.skeletonBtn)} />
                  </div>
                )}
              </For>
            </div>
          </Show>
        }
      >
        {/* 滚屏：屏们重叠在同一行，各自 translateX 平移（当前屏居中，相邻屏从两侧滑入）。
            视口承载滑动手势（触摸/拖动）；卡片点击（进详情）由拖动距离判定不误触 */}
        <div
          {...stylex.props(styles.viewport)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onWheel={onWheel}
          onDragStart={onDragStart}
        >
          <For each={pageIndexes()}>
            {(i) => (
              <div
                {...stylex.props(styles.pagePane)}
                ref={(el) => (paneRefs[i] = el)}
                style={{ transform: `translateX(${(i - curPage()) * 100}%)` }}
              >
                <For each={pageItems(i)}>
                  {(ep) => (
                    // grid 模式节目卡片：封面三态按钮（hover 划入）+ 标题 + 时间 + 时长；
                    // hover 预取详情数据（点击进详情页即开）
                    <div {...stylex.props(styles.cardSpan)}>
                      <EpisodeCard
                        episode={ep}
                        playing={isCurrent(ep.id) && playback.playing()}
                        onPlay={() => playback.play(ep)}
                        onPause={() => playback.toggle()}
                        onClick={() => navigate(`/episode/${ep.slug}`)}
                        onHover={() => void getEpisodeCached(ep.slug)}
                        // 无音源判定用 !audioUrl（schema notNull：库里是空串 '' 而非 NULL，== null 永远 false）
                        // preloadError：点击 play 预加载失败（音频不存在）→ 该卡片显示警告
                        audioError={!ep.audioUrl || (isCurrent(ep.id) && playback.audioError()) || playback.preloadError() === ep.id}
                        buffering={isCurrent(ep.id) && playback.buffering()}
                      />
                    </div>
                  )}
                </For>
                {/* 末屏不足 4 条：灰块补齐，保持每屏等宽（同卡片 span） */}
                <For each={Array.from({ length: PAGE_SIZE - pageItems(i).length })}>
                  {() => <div {...stylex.props(styles.grayBlock, styles.cardSpan)} />}
                </For>
              </div>
            )}
          </For>
        </div>
        {/* 外侧翻页按钮：hover 容器时淡入（垂直居中于容器中线）；触摸设备不渲染 */}
        <Show when={pageCount() > 1 && !isTouch()}>
          <div {...stylex.props(styles.sideNav, styles.sideNavPrev, hovered() && styles.sideNavVisible)}>
            <Button
              round="full"
              size="lg"
              variant="neutral"
              appear="fill"
              isIconOnly
              isDisabled={curPage() === 0}
              icon={<Icon icon="mdi:chevron-left" width={20} />}
              label={t("home.recommended.prev")}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            />
          </div>
          <div {...stylex.props(styles.sideNav, styles.sideNavNext, hovered() && styles.sideNavVisible)}>
            <Button
              round="full"
              size="lg"
              variant="neutral"
              appear="fill"
              isIconOnly
              isDisabled={curPage() >= pageCount() - 1}
              icon={<Icon icon="mdi:chevron-right" width={20} />}
              label={t("home.recommended.next")}
              onClick={() => setPage((p) => Math.min(pageCount() - 1, p + 1))}
            />
          </div>
        </Show>
        {/* 底部圆点指示器：可点击跳转（多屏时显示） */}
        <Show when={pageCount() > 1}>
          <div {...stylex.props(styles.dots)}>
            <For each={pageIndexes()}>
              {(i) => (
                <button
                  {...stylex.props(styles.dot, i === curPage() && styles.dotActive)}
                  aria-label={t("home.recommended.page", { page: i + 1 })}
                  onClick={() => setPage(i)}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
