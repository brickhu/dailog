// 全局内容搜索弹窗（命令面板式）。
// - 打开方式：导航栏搜索按钮（openSearchDialog）、Cmd/Ctrl+K、"/"（非表单输入态）
// - 数据：站内搜索服务 searchContent（../lib/search，Postgres ILIKE）——按字段命中
//   节目（标题/简介/台本/嘉宾/主播名）、嘉宾、主播，分组返回
// - 自动补全：输入防抖 220ms + 请求序号防竞态（只采纳最后一次输入）；分组展示
//   （节目/嘉宾/主播）+ 关键词高亮；↑↓/Enter 键盘导航（IME 组合输入安全）；Esc 关闭
//   （Dialog 分层 Escape，单次只关最上层）
// - 移动优先：<640 底部弹层（3/4 屏高、顶角圆角）；≥640 居中弹窗（560px，70vh 封顶）
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { Dialog, Icon, Spinner } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions, fontfamilies } from "@dailogues/ui/theme.stylex";
import {
  searchContent,
  type SearchEpisode,
  type SearchGuest,
  type SearchHost,
  type SearchResults,
} from "../lib/search";
import { episodeCoverUrl } from "../lib/env";

const DEBOUNCE_MS = 220;
const MAX_QUERY_LEN = 64;
// 居中断点（与 theme.stylex.ts 的 TABLET 同值——stylex 不支持跨文件常量解析）
const CENTERED_QUERY = "(min-width: 640px)";
const CENTERED = "@media (min-width: 640px)";

type SearchStatus = "idle" | "loading" | "done" | "error";
interface FlatItem {
  kind: "episode" | "guest" | "host";
  href: string;
}

const styles = stylex.create({
  // 弹窗外形：移动优先底部弹层（3/4 屏高、顶角圆角）→ ≥640 居中圆角面板
  sheet: {
    borderTopLeftRadius: "20px",
    borderTopRightRadius: "20px",
    borderBottomLeftRadius: "0px",
    borderBottomRightRadius: "0px",
    overflow: "hidden",
    height: "75dvh",
    [CENTERED]: {
      borderTopLeftRadius: dimensions.radiusXl,
      borderTopRightRadius: dimensions.radiusXl,
      borderBottomLeftRadius: dimensions.radiusXl,
      borderBottomRightRadius: dimensions.radiusXl,
      height: "auto",
    },
  },
  body: {
    display: "flex",
    flexDirection: "column",
    // 弹窗高度取确定值（移动端 75dvh 底部弹层 / 桌面 70vh 居中面板，均与 dialog 实际高度一致）：
    // 结果区（flex:1 + overflow-y:auto）在 body 内滚动，输入行/快捷键提示固定。
    // 不能用 height:100%——iOS WebKit 对 fit-content/auto 高度父级的高度百分比解析为 0，
    // 结果区会塌成不可见的 0 高度
    height: "75dvh",
    minHeight: 0,
    // 桌面面板实际高度恒为 70vh（dialog 触及 max-height，Chrome/WebKit 均如此），
    // body 直接取 70vh 与 dialog 对齐——比 min(70vh, 520px) 更贴合实际渲染，无底部空隙
    [CENTERED]: {
      height: "70vh",
    },
  },
  inputRow: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    padding: `${dimensions.spacing3} ${dimensions.spacing4}`,
    flexShrink: 0,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "color-mix(in srgb, currentColor 12%, transparent)",
  },
  searchIcon: {
    display: "inline-flex",
    color: colors.neutral,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    minWidth: 0,
    borderStyle: "none",
    outlineStyle: "none",
    backgroundColor: "transparent",
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    "::placeholder": { color: colors.neutralWeak },
  },
  clearBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    borderRadius: dimensions.radiusSm,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: colors.neutral,
    cursor: "pointer",
    flexShrink: 0,
    ":hover": {
      color: colors.foreground,
      backgroundColor: "color-mix(in srgb, currentColor 10%, transparent)",
    },
  },
  results: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    paddingBlock: dimensions.spacing1,
  },
  stateRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: dimensions.spacing2,
    padding: `${dimensions.spacing10} ${dimensions.spacing4}`,
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textAlign: "center",
  },
  groupHeader: {
    padding: `${dimensions.spacing3} ${dimensions.spacing4} ${dimensions.spacing1}`,
    fontSize: dimensions.fontSize2xs,
    fontWeight: dimensions.fontWeightSemiBold,
    color: colors.neutralWeak,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    width: "100%",
    padding: `${dimensions.spacing2} ${dimensions.spacing4}`,
    borderRadius: dimensions.radiusMd,
    textDecoration: "none",
    color: "inherit",
    cursor: "pointer",
  },
  rowActive: {
    backgroundColor: `color-mix(in srgb, ${colors.primary} 10%, transparent)`,
  },
  thumb: {
    width: "40px",
    height: "40px",
    borderRadius: dimensions.radiusSm,
    objectFit: "cover",
    flexShrink: 0,
  },
  thumbFallback: {
    width: "40px",
    height: "40px",
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.surfaceWeak,
    color: colors.neutral,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatar: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    objectFit: "cover",
    flexShrink: 0,
  },
  avatarFallback: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    backgroundColor: colors.ink,
    color: colors.foreground,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: dimensions.fontSizeLg,
    flexShrink: 0,
  },
  rowText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
    flex: 1,
  },
  rowTitle: {
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightMedium,
    color: colors.foreground,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  rowSub: {
    fontSize: dimensions.fontSizeSm,
    color: colors.neutral,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  numberTag: {
    display: "inline-flex",
    marginRight: dimensions.spacing2,
    padding: "1px 6px",
    borderRadius: dimensions.radiusSm,
    backgroundColor: `color-mix(in srgb, ${colors.brand} 18%, transparent)`,
    color: colors.foreground,
    fontSize: dimensions.fontSize2xs,
    fontWeight: dimensions.fontWeightMedium,
    verticalAlign: "1px",
  },
  mark: {
    backgroundColor: `color-mix(in srgb, ${colors.brand} 32%, transparent)`,
    color: "inherit",
    borderRadius: "2px",
    padding: "0 1px",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dimensions.spacing3,
    padding: `${dimensions.spacing2} ${dimensions.spacing4}`,
    flexShrink: 0,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: "color-mix(in srgb, currentColor 12%, transparent)",
    color: colors.neutral,
    fontSize: dimensions.fontSize2xs,
  },
  footerKbd: {
    fontFamily: fontfamilies.code,
    fontSize: "10px",
    lineHeight: 1,
    padding: "2px 5px",
    borderRadius: dimensions.radiusSm,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "color-mix(in srgb, currentColor 20%, transparent)",
  },
});

// —— 关键词高亮：把命中的子串包进 <mark>（大小写不敏感；转义正则元字符）——
interface HighlightPart { text: string; hit: boolean; }

function splitHighlight(text: string, query: string): HighlightPart[] {
  const q = query.trim();
  if (!q) return [{ text, hit: false }];
  let re: RegExp;
  try {
    re = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
  } catch {
    return [{ text, hit: false }];
  }
  return text.split(re).map((part, i) => ({ text: part, hit: i % 2 === 1 }));
}

function Highlighted(props: { text: string | null; query: string }) {
  const parts = splitHighlight(props.text ?? "", props.query);
  return (
    <For each={parts}>
      {(part) => (part.hit ? <mark {...stylex.props(styles.mark)}>{part.text}</mark> : part.text)}
    </For>
  );
}

// —— 全局单例（AppShell 挂载；openSearchDialog/closeSearchDialog 打开/关闭）——
const [open, setOpen] = createSignal(false);
export function openSearchDialog(): void {
  setOpen(true);
}
export function closeSearchDialog(): void {
  setOpen(false);
}

export function SearchDialog() {
  const { t } = useI18n();
  const navigate = useNavigate();

  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<SearchResults | null>(null);
  const [status, setStatus] = createSignal<SearchStatus>("idle");
  const [active, setActive] = createSignal(0);
  const [centered, setCentered] = createSignal(false);

  let resultsEl: HTMLDivElement | undefined;
  const rowEls: (HTMLElement | null)[] = [];

  // 断点监听：<640 底部弹层；≥640 居中（窗口变化时实时切换）
  onMount(() => {
    const mq = window.matchMedia(CENTERED_QUERY);
    const update = () => setCentered(mq.matches);
    update();
    mq.addEventListener("change", update);
    onCleanup(() => mq.removeEventListener("change", update));
  });

  // 全局快捷键：Cmd/Ctrl+K（输入态也生效——命令面板惯例）；"/"（非表单输入态才触发）
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key !== "/" || open()) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // 打开时重置为干净搜索态
  createEffect(on(open, (o) => {
    if (!o) return;
    setQuery("");
    setResults(null);
    setStatus("idle");
    setActive(0);
  }));

  // 防抖自动补全 + 请求序号防竞态（只采纳最后一次输入的结果）
  let seq = 0;
  // 浏览器端计时器（window.setTimeout 返回 number；避免与 @types/node 的 setTimeout 冲突）
  let timer: number | undefined;
  const runSearch = async (raw: string) => {
    const q = raw.trim();
    const mine = ++seq;
    if (!q) {
      setResults(null);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    try {
      const res = await searchContent(q);
      if (mine !== seq) return;
      setResults(res);
      setStatus("done");
    } catch {
      if (mine !== seq) return;
      setResults(null);
      setStatus("error");
    }
  };
  createEffect(on(query, (q) => {
    // 清理放 effect 内：effect 只在客户端运行（SSR 不执行），避免组件体裸 onCleanup
    // 在 SSR 渲染后执行到 window.* 崩溃（dev 启动即炸）
    onCleanup(() => window.clearTimeout(timer));
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void runSearch(q);
    }, DEBOUNCE_MS);
  }));

  // 新查询把结果区滚回顶部（结果整体刷新）
  createEffect(on(query, () => {
    if (resultsEl) resultsEl.scrollTop = 0;
  }));

  // 扁平可选项（键盘导航索引 = 展示顺序：节目 → 嘉宾 → 主播）
  const flat = createMemo<FlatItem[]>(() => {
    const r = results();
    if (!r) return [];
    const items: FlatItem[] = [];
    for (const ep of r.episodes) items.push({ kind: "episode", href: "/episode/" + ep.slug });
    for (const g of r.guests) items.push({ kind: "guest", href: "/guest/" + g.id });
    for (const h of r.hosts) items.push({ kind: "host", href: "/@" + h.username });
    return items;
  });
  createEffect(on(flat, () => setActive(0)));

  // 激活项滚动可见（键盘导航跟随）
  createEffect(() => {
    const el = rowEls[active()];
    el?.scrollIntoView({ block: "nearest" });
  });

  const go = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const len = flat().length;
    if (len === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((v) => (v + 1) % len);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((v) => (v - 1 + len) % len);
    } else if (e.key === "Enter") {
      // IME 组合输入（中文候选）的 Enter 是选字，不触发跳转
      if (e.isComposing || e.keyCode === 229) return;
      const item = flat()[active()];
      if (item) {
        e.preventDefault();
        go(item.href);
      }
    }
  };

  const epsCount = createMemo(() => results()?.episodes.length ?? 0);
  const guestCount = createMemo(() => results()?.guests.length ?? 0);

  return (
    <Dialog
      isOpen={open()}
      onOpenChange={setOpen}
      purpose="info"
      padding={0}
      width={centered() ? 560 : "100%"}
      maxHeight={centered() ? "70vh" : "75dvh"}
      position={centered() ? undefined : { bottom: 0 }}
      style={centered() ? undefined : { "max-width": "100vw" }}
      xstyle={styles.sheet}
      aria-label={t("search.title")}
    >
      <div {...stylex.props(styles.body)}>
        {/* 输入行 */}
        <div {...stylex.props(styles.inputRow)}>
          <span {...stylex.props(styles.searchIcon)}>
            <Icon icon="iconoir:search" width={20} />
          </span>
          <input
            data-autofocus
            value={query()}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value.slice(0, MAX_QUERY_LEN))}
            onKeyDown={handleKeyDown}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            {...stylex.props(styles.input)}
          />
          {/* 有输入 → 清空；无输入 → 关闭 */}
          <button
            type="button"
            onClick={() => (query() ? setQuery("") : setOpen(false))}
            aria-label={query() ? t("search.clear") : t("search.close")}
            {...stylex.props(styles.clearBtn)}
          >
            <Icon icon="iconoir:xmark" width={16} />
          </button>
        </div>

        {/* 结果区 */}
        <div ref={resultsEl} {...stylex.props(styles.results)}>
          <Show
            when={status() !== "idle"}
            fallback={
              <div {...stylex.props(styles.stateRow)}>
                <Icon icon="iconoir:search" width={16} />
                <span>{t("search.hint")}</span>
              </div>
            }
          >
            <Show when={status() === "loading"}>
              <div {...stylex.props(styles.stateRow)}>
                <Spinner size={18} />
                <span>{t("search.loading")}</span>
              </div>
            </Show>
            <Show when={status() === "error"}>
              <div {...stylex.props(styles.stateRow)}>{t("search.error")}</div>
            </Show>
            <Show when={status() === "done" && flat().length === 0}>
              <div {...stylex.props(styles.stateRow)}>{t("search.empty", { q: query().trim() })}</div>
            </Show>
            <Show when={status() === "done" && flat().length > 0}>
              <div role="listbox" aria-label={t("search.title")}>
                {/* 节目 */}
                <Show when={results()!.episodes.length > 0}>
                  <div {...stylex.props(styles.groupHeader)}>{t("search.episodes")}</div>
                  <For each={results()!.episodes}>
                    {(ep, i) => (
                      <A
                        href={"/episode/" + ep.slug}
                        role="option"
                        aria-selected={active() === i()}
                        onClick={() => setOpen(false)}
                        onMouseEnter={() => setActive(i())}
                        onFocus={() => setActive(i())}
                        ref={(el) => (rowEls[i()] = el)}
                        {...stylex.props(styles.row, active() === i() && styles.rowActive)}
                      >
                        <Show
                          when={episodeCoverUrl(ep.id, ep.coverUrl, 160)}
                          fallback={
                            <div {...stylex.props(styles.thumbFallback)}>
                              <Icon icon="iconoir:music-note" width={18} />
                            </div>
                          }
                        >
                          {(url) => <img src={url()} alt="" {...stylex.props(styles.thumb)} />}
                        </Show>
                        <span {...stylex.props(styles.rowText)}>
                          <span {...stylex.props(styles.rowTitle)}>
                            <Show when={ep.number}>
                              <span {...stylex.props(styles.numberTag)}>
                                {t("search.episodeNumber", { n: ep.number! })}
                              </span>
                            </Show>
                            <Highlighted text={ep.title} query={query()} />
                          </span>
                          <span {...stylex.props(styles.rowSub)}>
                            {[ep.hostName, ep.guestName].filter(Boolean).join(" × ")}
                          </span>
                        </span>
                      </A>
                    )}
                  </For>
                </Show>
                {/* 嘉宾 */}
                <Show when={results()!.guests.length > 0}>
                  <div {...stylex.props(styles.groupHeader)}>{t("search.guests")}</div>
                  <For each={results()!.guests}>
                    {(g, i) => {
                      const idx = epsCount() + i();
                      return (
                        <A
                          href={"/guest/" + g.id}
                          role="option"
                          aria-selected={active() === idx}
                          onClick={() => setOpen(false)}
                          onMouseEnter={() => setActive(idx)}
                          onFocus={() => setActive(idx)}
                          ref={(el) => (rowEls[idx] = el)}
                          {...stylex.props(styles.row, active() === idx && styles.rowActive)}
                        >
                          <Show
                            when={g.avatar}
                            fallback={<div {...stylex.props(styles.avatarFallback)}>{g.name.slice(0, 1)}</div>}
                          >
                            {(url) => <img src={url()} alt="" {...stylex.props(styles.avatar)} />}
                          </Show>
                          <span {...stylex.props(styles.rowText)}>
                            <span {...stylex.props(styles.rowTitle)}>
                              <Highlighted text={g.name} query={query()} />
                            </span>
                            <span {...stylex.props(styles.rowSub)}>
                              {g.platform}
                              {g.intro ? " · " + g.intro.slice(0, 40) : ""}
                            </span>
                          </span>
                        </A>
                      );
                    }}
                  </For>
                </Show>
                {/* 主播 */}
                <Show when={results()!.hosts.length > 0}>
                  <div {...stylex.props(styles.groupHeader)}>{t("search.hosts")}</div>
                  <For each={results()!.hosts}>
                    {(h, i) => {
                      const idx = epsCount() + guestCount() + i();
                      return (
                        <A
                          href={"/@" + h.username}
                          role="option"
                          aria-selected={active() === idx}
                          onClick={() => setOpen(false)}
                          onMouseEnter={() => setActive(idx)}
                          onFocus={() => setActive(idx)}
                          ref={(el) => (rowEls[idx] = el)}
                          {...stylex.props(styles.row, active() === idx && styles.rowActive)}
                        >
                          <Show
                            when={h.avatar}
                            fallback={<div {...stylex.props(styles.avatarFallback)}>{h.displayName.slice(0, 1)}</div>}
                          >
                            {(url) => <img src={url()} alt="" {...stylex.props(styles.avatar)} />}
                          </Show>
                          <span {...stylex.props(styles.rowText)}>
                            <span {...stylex.props(styles.rowTitle)}>
                              <Highlighted text={h.displayName} query={query()} />
                            </span>
                            <span {...stylex.props(styles.rowSub)}>
                              @{h.username} · {t("search.episodeCount", { n: h.episodeCount })}
                            </span>
                          </span>
                        </A>
                      );
                    }}
                  </For>
                </Show>
              </div>
            </Show>
          </Show>
        </div>

        {/* 底部快捷键提示 */}
        <div {...stylex.props(styles.footer)}>
          <span>{t("search.footer")}</span>
          <kbd {...stylex.props(styles.footerKbd)}>esc</kbd>
        </div>
      </div>
    </Dialog>
  );
}

export type { SearchEpisode, SearchGuest, SearchHost };
