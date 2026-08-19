// 全局播放器（PlaybackContext）：封面即播放器，跨路由/跨状态常驻。
//  - queue：推荐队列（进入站点拉取；播完自动切下一期，循环）
//  - 单例 Audio 元素管理：切节目自动播放（解锁后）、进度节流、完播判定 + 统计上报
//  - 统计上报（play/completion）从单集页迁入——全局播放器统一埋点，sessionStorage 去重
//  - 自动播放策略：setQueue 只加载不播放（等用户点击封面解锁）；用户交互后 next/play 自动连播
import { createContext, createEffect, createSignal, onCleanup, useContext, type ParentProps } from "solid-js";
import { env } from "./env";

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
}

const PlaybackContext = createContext<PlaybackContextValue>();

// 完播阈值：进度 ≥95% 记为完播（ended 事件 + timeupdate 双保险）
const COMPLETE_RATIO = 0.95;
// buffering 兜底超时：waiting 后这么久仍未就绪（文件缺失/R2 挂起/网络黑洞）→ 视为加载失败，
// 清缓冲并置 audioError（否则 spinner 无限转 = 用户看到"一直 loading"）
const BUFFERING_TIMEOUT_MS = 10_000;

/** 统计上报（0036 恢复；每 session 每期每事件一次；sessionStorage 去重——隐私模式静默） */
function reportStat(id: string, type: "play" | "completion") {
  const key = `dailog-stat-${id}-${type}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch { /* 隐私模式 */ }
  void fetch(`${env.apiBaseUrlPublic ?? env.apiBaseUrl}/v1/public/episodes/${id}/stats/${type}`, { method: "POST" }).catch(() => {});
}

export function PlaybackProvider(props: ParentProps) {
  const [queue, setQueueSignal] = createSignal<QueueEpisode[]>([]);
  const [index, setIndex] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [audioError, setAudioError] = createSignal(false);
  // 缓冲/加载中（audio waiting 事件驱动；切歌/就绪/出错时清除）
  const [buffering, setBuffering] = createSignal(false);
  // 点击卡片 play 后预加载失败的目标节目 id（音频不存在/加载失败）——该卡片显示警告；
  // 与 audioError 分开：audioError 是当前播放节目的错误，preloadError 是"想播但没加载起来"的
  const [preloadError, setPreloadError] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
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

  const current = () => queue()[index()] ?? null;

  /**
   * 加载队列第 i 期：切 src；autoplay=true 时尝试播放并上报 play（用户已解锁场景：
   * play/next/prev）；false 只加载不播不报（setQueue 首期——等用户点击封面解锁）。
   * 加载同时预载下一期音频（无缝连播）。
   */
  const loadEpisode = (i: number, opts: { autoplay?: boolean } = {}) => {
    const ep = queue()[i];
    const a = audio();
    if (!a || !ep) return;
    setIndex(i);
    setProgress(0);
    setDuration(0);
    setAudioError(false); // 切节目：重置音源错误标记
    setBuffering(false); // 切节目：重置缓冲标记（waiting 事件会按需重新置 true）
    setPreloadError(null); // 切节目：重置预加载失败标记（旧卡片警告失效）
    a.src = episodeAudioUrl(ep.id);
    a.load();
    if (opts.autoplay) {
      void a.play().catch(() => setPlaying(false)); // playing 由 "playing" 事件驱动（真正出声才置 true）；被拒（罕见）→ 停住等用户
      reportStat(ep.id, "play");
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

  // ---- 预加载后切换（点击节目卡 play）----
  // 点击卡片 → 用独立 Audio 元素预加载目标节目（不打断当前播放）；canplay（数据足够
  // 开始播放）后才切换主播放器。场景：
  //   1. 播放条播放中：原节目继续播，新节目 ready 后才切歌（无卡顿断音）
  //   2. 播放条未出现：加载期间播放条不展开，ready 后展开播放
  // 预加载失败（404/解码）→ preloadError(目标 id) → 该卡片显示警告，当前播放不受影响
  let probe: HTMLAudioElement | null = null;
  let probeGuard = 0; // 预加载换代标记：旧预加载的异步回调（canplay/error）失效
  const abortPreload = () => {
    probeGuard++;
    if (probe) {
      probe.removeAttribute("src");
      probe.load(); // 释放资源
      probe = null;
    }
    setPreloadError(null);
  };
  onCleanup(() => abortPreload());

  const play = (ep: QueueEpisode) => {
    const a = audio();
    const i = queue().findIndex((q) => q.id === ep.id);
    // 目标就是当前节目：已加载，直接播放（不重复上报 play——同 session 已去重）
    if (i >= 0 && i === index()) {
      setActivated(true);
      abortPreload();
      void a?.play().catch(() => setPlaying(false));
      return;
    }
    // 预加载期间不 setActivated：播放条未出现时保持隐藏（"加载完成展开播放器"）；
    // 播放中场景 activated 已是 true，播放条继续显示原节目。ready 后（finish）再激活
    // 目标不在队列：先入队（finish 后 loadEpisode 定位；signal 同步更新，无需 rAF）
    if (i < 0) {
      setQueueSignal((q) => [...q, ep]);
    }
    // 取消上一次未完成的预加载
    abortPreload();
    const guard = probeGuard;
    const probeEl = new Audio();
    probeEl.preload = "auto";
    probeEl.src = episodeAudioUrl(ep.id);
    probe = probeEl;
    const finish = () => {
      if (guard !== probeGuard) return; // 已被更新的预加载取代
      abortPreload();
      setActivated(true); // 加载完成 → 激活播放条（场景 2：此时才展开）
      // 队列可能已被 setQueue 替换（预加载期间 activated 未置 true，理论上首页 setQueue
      // 只在 list 变化时触发、不会发生；此处重新定位兜底）
      const idx = queue().findIndex((q) => q.id === ep.id);
      if (idx >= 0) {
        loadEpisode(idx, { autoplay: true });
      } else {
        const n = queue().length;
        setQueueSignal((q) => [...q, ep]);
        requestAnimationFrame(() => loadEpisode(n, { autoplay: true }));
      }
    };
    const fail = () => {
      if (guard !== probeGuard) return;
      abortPreload();
      setPreloadError(ep.id);
    };
    probeEl.addEventListener("canplay", finish);
    probeEl.addEventListener("error", fail);
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
    const onTime = () => {
      setProgress(a.currentTime);
      setDuration(a.duration || 0);
      // 完播判定（进度 ≥95%，ended 之外的保险；统计上报 session 去重）
      if (a.duration > 0 && a.currentTime / a.duration >= COMPLETE_RATIO) {
        const ep = current();
        if (ep) reportStat(ep.id, "completion");
      }
    };
    const onEnded = () => {
      const ep = current();
      if (ep) reportStat(ep.id, "completion");
      next();
    };
    // playing 信号用 'playing' 事件驱动（实际开始渲染音频/出声）——'play' 事件在
    // play() 调用时即触发（缓冲中），会让封面按钮提前切到 pause（loading 未覆盖加载期）
    const onPlaying = () => setPlaying(true);
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
    a.addEventListener("ended", onEnded);
    a.addEventListener("playing", onPlaying);
    a.addEventListener("pause", onPause);
    a.addEventListener("waiting", onWaiting);
    a.addEventListener("canplay", onCanPlay);
    a.addEventListener("seeked", onSeeked);
    a.addEventListener("error", onError);
    onCleanup(() => {
      a.removeEventListener("timeupdate", onTime);
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
    play,
    toggle,
    pause,
    resume,
    next,
    prev,
    seek,
    setQueue: (eps) => {
      setQueueSignal(eps);
      setIndex(0);
      if (eps.length > 0) loadEpisode(0); // 加载首期（不播不报；封面展示播放按钮等用户点击）
    },
    activated,
  };

  return <PlaybackContext.Provider value={value}>{props.children}</PlaybackContext.Provider>;
}

export function usePlayback(): PlaybackContextValue {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error("usePlayback 必须在 PlaybackProvider 内使用");
  return ctx;
}
