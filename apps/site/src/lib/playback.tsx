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

/** 统计上报（每 session 每期每事件一次；sessionStorage 去重——隐私模式静默） */
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
  const [progress, setProgress] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  // 用户主动选择（play/toggle）→ 激活播放条；setQueue 自动加载不激活
  const [activated, setActivated] = createSignal(false);
  // 临时暂停前是否在播（resume 只在原本在播时续播）
  const [wasPlaying, setWasPlaying] = createSignal(false);

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
    a.src = episodeAudioUrl(ep.id);
    a.load();
    if (opts.autoplay) {
      void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); // 被拒（罕见）→ 停住等用户
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

  const play = (ep: QueueEpisode) => {
    setActivated(true); // 用户选择节目 → 显示播放条
    const i = queue().findIndex((q) => q.id === ep.id);
    if (i >= 0) {
      if (i === index()) {
        // 当前期：直接播放（不重复上报 play——同 session 已去重）
        void audio()?.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      } else {
        loadEpisode(i, { autoplay: true });
      }
      return;
    }
    // 追加进队列并定位（rAF 后 signal 已更新，loadEpisode 读到新数组）
    const newIdx = queue().length;
    setQueueSignal((q) => [...q, ep]);
    requestAnimationFrame(() => loadEpisode(newIdx, { autoplay: true }));
  };

  const toggle = () => {
    setActivated(true); // 用户点击播放/暂停（播放条/封面/卡片）→ 激活
    const a = audio();
    if (!a) return;
    if (a.paused) {
      void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
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
    void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
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
      // 完播判定（进度 ≥95%，ended 之外的保险；reportStat 内部 session 去重）
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
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnded);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    onCleanup(() => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    });
  });

  const value: PlaybackContextValue = {
    queue,
    current,
    playing,
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
