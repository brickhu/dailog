// 全局播放器（PlaybackContext）：封面即播放器，跨路由/跨状态常驻。
//  - queue：推荐队列（进入站点拉取；播完自动切下一期，循环）
//  - 单例 Audio 元素管理：切节目自动播放（解锁后）、进度节流、完播判定 + 统计上报
//  - 统计上报（play/completion）从单集页迁入——全局播放器统一埋点，sessionStorage 去重
//  - 自动播放策略：setQueue 只加载不播放（等用户点击封面解锁）；用户交互后 next/play 自动连播
import { createContext, createEffect, createResource, createSignal, onCleanup, useContext, type ParentProps } from "solid-js";
import { useI18n } from "@dailogues/i18n";
import { apiBaseForFetch, env } from "./env";

/** 队列节目（来自 /v1/public/episodes/recommended） */
export interface QueueEpisode {
  id: string;
  slug: string;
  title: string | null;
  description: string | null;
  coverUrl: string | null;
  /** 音频地址（null = 无音源——按钮区显示警告，不提供播放） */
  audioUrl: string | null;
  language: string;
  durationSeconds: number | null;
  publishedAt: Date | null;
  username: string;
  displayName: string;
  callName: string | null;
  transcript: string | null;
  sourceUrl: string | null;
}

/** 公开音频端点 URL（音频在 storage，非 API 路径——同单集页逻辑） */
export function episodeAudioUrl(id: string): string {
  return `${env.apiBaseUrlPublic ?? env.apiBaseUrl}/v1/public/episodes/${id}/audio`;
}

export interface PlaybackContextValue {
  queue: () => QueueEpisode[];
  /** 当前节目（封面/详情渲染用） */
  current: () => QueueEpisode | null;
  playing: () => boolean;
  /** 当前节目音源加载失败（audio error 事件；切歌时重置）——按钮区显示警告 */
  audioError: () => boolean;
  /** 缓冲/加载中（audio waiting 事件；canplay/playing/seeked/error 时清除）——播放按钮禁用 */
  buffering: () => boolean;
  /** 点击卡片 play 后预加载失败的目标节目 id（音频不存在/加载失败）——该卡片显示警告 */
  preloadError: () => string | null;
  /** 当前进度（秒）与总时长（秒）——封面进度条用 */
  progress: () => number;
  duration: () => number;
  /** 已缓冲进度（秒）：audio buffered 中覆盖当前位置那段的最大 end——播放条缓冲层用 */
  buffered: () => number;
  /** 播放指定节目（加入队列定位到它；自动播放 + 上报 play） */
  play: (ep: QueueEpisode) => void;
  toggle: () => void;
  /** 临时暂停（如录音场景防串音）；恢复时仅在暂停前正在播放时续播 */
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  /** 设置进度（秒）——拖动进度条 */
  seek: (sec: number) => void;
  /** 替换队列（推荐刷新/语言切换）；只加载首期不播放（等用户点击解锁） */
  setQueue: (eps: QueueEpisode[]) => void;
  /** 用户是否主动选择过节目（play/toggle 触发）——播放条只在激活后显示 */
  activated: () => boolean;
  /** 全局推荐队列数据源（provider 统一按语言拉取、全局灌入）——首页推荐滚屏共用，不再各自 fetch */
  recommended: () => QueueEpisode[] | null;
  recommendedLoading: () => boolean;
}

const PlaybackContext = createContext<PlaybackContextValue>();

// 完播阈值：进度 ≥95% 记为完播（ended 事件 + timeupdate 双保险）
const COMPLETE_RATIO = 0.95;
// buffering 兜底超时：waiting 后这么久仍未就绪（文件缺失/R2 挂起/网络黑洞）→ 视为加载失败，
// 清缓冲并置 audioError（否则 spinner 无限转 = 用户看到"一直 loading"）
const BUFFERING_TIMEOUT_MS = 10_000;

/** 统计上报（0036 恢复；每 session 每期每事件一次；sessionStorage 去重——隐私模式静默）
 *  去重 key 在 POST **成功**后才写入：若首次上报失败（网络/CORS/服务端 404），
 *  该 session 内后续播放可重试，不会因失败残留的 key 永久短路（播放多次但统计恒 0 的隐患）。
 *  key 带 v2 版本前缀：旧版（无前缀，先写 key 后发请求）残留的短路 key 自动失效，
 *  无需用户手动清 sessionStorage */
function reportStat(id: string, type: "play" | "completion") {
  const key = `dailog-stat-v2-${id}-${type}`;
  try {
    if (sessionStorage.getItem(key)) return;
  } catch { /* 隐私模式 */ }
  void fetch(`${env.apiBaseUrlPublic ?? env.apiBaseUrl}/v1/public/episodes/${id}/stats/${type}`, { method: "POST" })
    .then((r) => {
      if (r.ok) {
        try { sessionStorage.setItem(key, "1"); } catch { /* 隐私模式 */ }
      }
    })
    .catch(() => {});
}

export function PlaybackProvider(props: ParentProps) {
  const [queue, setQueueSignal] = createSignal<QueueEpisode[]>([]);
  const [index, setIndex] = createSignal(0);
  // 当前节目 = 音频元素实际加载的那期（loadEpisode 设置 src 时原子更新）——单一事实来源。
  // 不用 queue()[index()]：队列会被 focusEpisode/推荐灌队列修改，任何一次竞争脱节就会
  // "播放条显示旧节目、音频在播新节目"（卡片/播放条/按钮全部联动不一致）
  const [currentEp, setCurrentEp] = createSignal<QueueEpisode | null>(null);
  const [playing, setPlaying] = createSignal(false);
  const [audioError, setAudioError] = createSignal(false);
  // 缓冲/加载中（audio waiting 事件驱动；切歌/就绪/出错时清除）
  const [buffering, setBuffering] = createSignal(false);
  // 预加载失败目标 id（音频不存在/加载失败）——预加载探针已移除（play 直接切歌），
  // 此信号保留仅为上下文 API 兼容；音频错误统一走 audioError（当前节目加载失败即错误）
  const [preloadError, setPreloadError] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [buffered, setBuffered] = createSignal(0);
  // 用户主动选择（play/toggle）→ 激活播放条；setQueue 自动加载不激活
  const [activated, setActivated] = createSignal(false);
  // 临时暂停前是否在播（resume 只在原本在播时续播）
  const [wasPlaying, setWasPlaying] = createSignal(false);

  // buffering 兜底超时：进入缓冲后 10s 未就绪 → 清缓冲（避免 spinner 无限转）。
  // 注意：不置 audioError——慢速但最终成功的加载（R2 走代理 2-6s/次，大文件更久）
  // 会超过 10s，误置 audioError 会让"明明有音频"的节目显示警告图标。
  // audioError 只由 audio 元素真实的 error 事件驱动（404/解码失败等）。
  // 只在首次进入 buffering 时启动一次计时（!bufTimer 守卫）：waiting 若反复触发
  // （加载挂起重试），重置式计时会被无限推迟，兜底失效
  let bufTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    if (buffering()) {
      if (!bufTimer) {
        bufTimer = setTimeout(() => {
          setBuffering(false);
        }, BUFFERING_TIMEOUT_MS);
      }
    } else {
      clearTimeout(bufTimer);
      bufTimer = undefined;
    }
  });
  onCleanup(() => clearTimeout(bufTimer));

  // 单例音频元素（客户端 only）
  const [audio] = createSignal<HTMLAudioElement | null>(
    typeof document !== "undefined" ? new Audio() : null,
  );

  const current = () => currentEp();

  /**
   * 加载队列第 i 期：切 src；autoplay=true 时尝试播放（用户已解锁场景：play/next/prev）；
   * false 只加载不播（setQueue 首期——等用户点击封面解锁）。
   * 加载同时预载下一期音频（无缝连播）。
   * 统计上报不在加载处：play 统一由 audio "playing" 事件（真正出声）上报——覆盖
   * 封面/卡片 play()、播放条 toggle()、连播 next/prev 等全部入口（sessionStorage 去重）。
   */
  const loadEpisode = (i: number, opts: { autoplay?: boolean } = {}) => {
    const ep = queue()[i];
    const a = audio();
    if (!a || !ep) return;
    setIndex(i);
    setCurrentEp(ep); // 当前节目 = 实际加载进音频的这一期（与 a.src 原子一致）
    setProgress(0);
    setDuration(0);
    setBuffered(0); // 切节目：重置缓冲进度（progress 事件会按需重新写入）
    setAudioError(false); // 切节目：重置音源错误标记
    setBuffering(false); // 切节目：重置缓冲标记（waiting 事件会按需重新置 true）
    setPlaying(false); // 切节目：重置播放标记——旧节目在播时 playing 残留 true，
    // 会让播放按钮（playing 优先）显示暂停、而播放条（buffering 优先）还在转 spinner，
    // 两处状态不一致。切歌后 playing 只能由新音频真实的 "playing" 事件重新置 true
    setPreloadError(null); // 切节目：重置预加载失败标记（旧卡片警告失效）
    a.src = episodeAudioUrl(ep.id);
    a.load();
    if (opts.autoplay) {
      void a.play().catch(() => setPlaying(false)); // playing 由 "playing" 事件驱动（真正出声才置 true）；被拒（罕见）→ 停住等用户
    }
    // 预加载下一期（<link rel=preload as=audio>——只发起缓存下载，不创建 Audio 元素，
    // 不会触发自动播放；避免 new Audio()+preload=auto 在解锁页面真的开始播放导致双声）
    const nextEp = queue()[(i + 1) % queue().length];
    if (nextEp && typeof document !== "undefined") {
      document.querySelector("link[data-dailog-preload]")?.remove();
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "audio";
      link.href = episodeAudioUrl(nextEp.id);
      link.dataset.dailogPreload = "1";
      document.head.appendChild(link);
    }
  };

  // ---- 全局队列初始化（统一于此，页面不再各自拉 recommended）----
  // 推荐队列：provider 按语言拉取一次（SSR 服务端 fetch 序列化进 HTML，客户端 hydration 复用；
  // 语言切换自动重拉）。无论用户从哪个页面进入（含详情页深链），队列都统一初始化为推荐列表；
  // 未激活才灌入（不打断正在进行的播放）；只加载首期不播放（等用户点击封面解锁）。
  const { locale } = useI18n();
  // T 由 fetcher 返回类型推断（QueueEpisode[] | null），S（source key）由 () => locale() 推断
  const [recommendedList] = createResource(
    () => locale(),
    async (): Promise<QueueEpisode[] | null> => {
      const lang = locale() === "en" ? "en" : "zh";
      const r = await fetch(`${apiBaseForFetch}/v1/public/episodes/recommended?lang=${lang}&limit=20`);
      const eps: unknown = r.ok ? await r.json() : null;
      return Array.isArray(eps) && eps.length > 0 ? (eps as QueueEpisode[]) : null;
    },
  );
  createEffect(() => {
    const eps = recommendedList();
    if (eps && !activated()) replaceQueue(eps);
  });

  /** 替换队列：定位首项 + 加载首期（不播不报，封面展示播放按钮等用户点击） */
  const replaceQueue = (eps: QueueEpisode[]) => {
    setQueueSignal(eps);
    setIndex(0);
    if (eps.length > 0) loadEpisode(0);
  };

  // ---- 播放（点击封面/卡片/详情页按钮）----
  // 简化为直接切换：目标就是当前节目 → 直接 play()；否则 loadEpisode 切 src 播放。
  // 不设预加载探针——探针把真正切歌拖到异步 canplay（R2 2-6s），期间"播放条/卡片还显示
  // 旧节目、音频还在播旧的"，用户以为点了没反应/点错节目（标题链接露馅指向旧节目）。
  // loadEpisode 原子更新 currentEp + a.src → 播放条/卡片/按钮永远与实际音频一致。
  // 切歌成本：正在播的旧节目立即停止、新节目加载完成后出声（可接受，换确定性）
  const play = (ep: QueueEpisode) => {
    const a = audio();
    let i = queue().findIndex((q) => q.id === ep.id);
    setActivated(true); // 用户明确点击 → 激活播放条
    // 目标就是当前节目：已加载，直接播放（play 上报统一在 "playing" 事件，不在此重复——
    // 修复详情页封面播放当前集时不上报的漏记；sessionStorage 去重保证每 session 每期一次）
    if (i >= 0 && i === index()) {
      void a?.play().catch(() => setPlaying(false));
      return;
    }
    // 目标不在队列：先入队（signal 同步更新，随后即可定位）
    if (i < 0) {
      setQueueSignal((q) => [...q, ep]);
      i = queue().length - 1;
    }
    loadEpisode(i, { autoplay: true });
  };

  const toggle = () => {
    setActivated(true); // 用户点击播放/暂停（播放条/封面/卡片）→ 激活
    const a = audio();
    if (!a) return;
    if (a.paused) {
      void a.play().catch(() => setPlaying(false));
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  /** 临时暂停（录音/需要静音的交互场景）——记录暂停前状态，resume 按需续播 */
  const pause = () => {
    const a = audio();
    if (!a) return;
    setWasPlaying(!a.paused);
    a.pause();
    setPlaying(false);
  };

  /** 恢复播放：仅当 pause 前正在播放时续播 */
  const resume = () => {
    if (!wasPlaying()) return;
    const a = audio();
    if (!a) return;
    void a.play().catch(() => setPlaying(false));
  };

  const next = () => {
    const q = queue();
    if (q.length === 0) return;
    loadEpisode((index() + 1) % q.length, { autoplay: true }); // 队列循环：抖音流永续播放
  };

  const prev = () => {
    const q = queue();
    if (q.length === 0) return;
    loadEpisode((index() - 1 + q.length) % q.length, { autoplay: true });
  };

  const seek = (sec: number) => {
    const a = audio();
    if (!a) return;
    a.currentTime = sec;
    setProgress(sec);
  };

  // 音频事件绑定（客户端 only）
  createEffect(() => {
    const a = audio();
    if (!a) return;
    // 缓冲进度（秒）：取 buffered 中覆盖当前位置那段的最大 end；seek 后 currentTime
    // 可能暂时落在段外（缓冲未跟上），回退取所有段的最大 end。clamp 到 duration 防越界显示。
    const refreshBuffered = () => {
      try {
        const ranges = a.buffered;
        if (!ranges || ranges.length === 0) {
          setBuffered(0);
          return;
        }
        const t = a.currentTime;
        let end = 0;
        for (let i = 0; i < ranges.length; i++) {
          const s = ranges.start(i);
          const e = ranges.end(i);
          if (s <= t && t <= e) {
            end = e;
            break;
          }
        }
        if (end === 0) {
          for (let i = 0; i < ranges.length; i++) {
            end = Math.max(end, ranges.end(i));
          }
        }
        setBuffered(Math.min(end, a.duration || end));
      } catch {
        setBuffered(0);
      }
    };
    const onTime = () => {
      setProgress(a.currentTime);
      setDuration(a.duration || 0);
      // 缓冲范围随播放/下载推进（timeupdate 频率高于 progress 事件，保证拖动后尽快刷新）
      refreshBuffered();
      // 完播判定（进度 ≥95%，ended 之外的保险；统计上报 session 去重）
      if (a.duration > 0 && a.currentTime / a.duration >= COMPLETE_RATIO) {
        const ep = current();
        if (ep) reportStat(ep.id, "completion");
      }
    };
    // 下载推进时 buffered 范围变化（progress 事件周期性触发）
    const onProgress = () => refreshBuffered();
    const onEnded = () => {
      const ep = current();
      if (ep) reportStat(ep.id, "completion");
      next();
    };
    // playing 信号用 'playing' 事件驱动（实际开始渲染音频/出声）——'play' 事件在
    // play() 调用时即触发（缓冲中），会让封面按钮提前切到 pause（loading 未覆盖加载期）。
    // play 统计上报统一在此：每次真正开始播放即上报（sessionStorage 每 session 每期去重，
    // 暂停续播/连播切集不叠加）——覆盖详情页封面、首页卡片、播放条 toggle、next/prev 全部入口
    const onPlaying = () => {
      setPlaying(true);
      // 真正出声 = 不可能还在缓冲：清 buffering（事件顺序异常 waiting→playing
      // 时，canplay 不必然紧跟——不清会让"在播但按钮一直 loading"卡住）
      setBuffering(false);
      const ep = current();
      if (ep) reportStat(ep.id, "play");
    };
    const onPause = () => setPlaying(false);
    // 缓冲/加载中：waiting（播放因数据不足停住——初次加载/拖动 seek/断网续拉）→ true；
    // canplay（数据足够可播）/playing（真正出声）/seeked（拖动完成）/error（失败）→ false
    // 仅播放中（!paused）才置 buffering：setQueue→load() 预加载阶段（未播放）也会触发
    // waiting，但那不是"缓冲中"——否则打开页面没操作卡片就转 spinner
    const onWaiting = () => {
      if (!a.paused) setBuffering(true);
    };
    const onCanPlay = () => setBuffering(false);
    const onSeeked = () => setBuffering(false);
    // 音源加载失败（404/网络/解码）→ audioError（封面按钮区显示警告图标）；同时清缓冲，
    // 避免 waiting 后 error 把按钮卡在禁用态
    const onError = () => {
      setAudioError(true);
      setBuffering(false);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("progress", onProgress);
    a.addEventListener("ended", onEnded);
    a.addEventListener("playing", onPlaying);
    a.addEventListener("pause", onPause);
    a.addEventListener("waiting", onWaiting);
    a.addEventListener("canplay", onCanPlay);
    a.addEventListener("seeked", onSeeked);
    a.addEventListener("error", onError);
    onCleanup(() => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("progress", onProgress);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("playing", onPlaying);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("waiting", onWaiting);
      a.removeEventListener("canplay", onCanPlay);
      a.removeEventListener("seeked", onSeeked);
      a.removeEventListener("error", onError);
    });
  });

  const value: PlaybackContextValue = {
    queue,
    current,
    playing,
    audioError,
    buffering,
    preloadError,
    progress,
    duration,
    buffered,
    play,
    toggle,
    pause,
    resume,
    next,
    prev,
    seek,
    setQueue: replaceQueue,
    activated,
    recommended: () => recommendedList() ?? null,
    recommendedLoading: () => recommendedList.loading,
  };

  return <PlaybackContext.Provider value={value}>{props.children}</PlaybackContext.Provider>;
}

export function usePlayback(): PlaybackContextValue {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error("usePlayback 必须在 PlaybackProvider 内使用");
  return ctx;
}