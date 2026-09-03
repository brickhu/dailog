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

/** 公开音频端点 URL（音频在 storage，非 API 路径——同单集页逻辑）。
 *  version（节目 publishedAt）会拼成 ?v=：URL 随内容变化——重新发布即换 URL，
 *  浏览器/中间层缓存里的旧副本自然失效；服务端也才敢对带版本的 URL 长缓存。
 *  不带版本的裸 URL 服务端按"每次校验"处理（见 api app.ts 的 Cache-Control）——
 *  否则一旦本地缓存里存下一份"读到某字节就断"的坏副本，用户会被钉死一周。 */
export function episodeAudioUrl(id: string, version?: string | Date | null): string {
  const base = `${env.apiBaseUrlPublic ?? env.apiBaseUrl}/v1/public/episodes/${id}/audio`;
  if (!version) return base;
  const v = version instanceof Date ? version.getTime() : (Date.parse(version) || version);
  return `${base}?v=${encodeURIComponent(String(v))}`;
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
// ---- 卡死看门狗（分片请求挂起/丢失时的自愈）----
// 症状背景：音频按 Range 分片下载，某一片请求挂住时浏览器既不报 error、也不发 pause，
// 只是 currentTime 停住（networkState=LOADING）——UI 看到的是"暂停图标 + 时间不动"，
// 像是"播到一半自己停了"。只靠 waiting 事件 + 超时清 spinner 不解决问题，必须主动自愈。
// 判定：播放中（!paused）连续这么久没有推进 = 卡死
const STALL_TIMEOUT_MS = 8_000;
// 自愈分级：前 N 次只做 seek 微调（不丢缓冲、不重下整集），之后才换 URL 重载
const STALL_NUDGE_RETRIES = 2;
// 自愈总次数上限：全部失败才判定音源不可用（显示警告 + 停在真实位置）
const STALL_MAX_RETRIES = 4;
// 缓冲空洞跳过上限（秒）：当前位置落在空洞里且下一段缓冲在这么近，直接跳过去续播
const STALL_GAP_SKIP_SEC = 30;
// 自愈后连续正常播放这么久 → 重置重试计数（长播过程中的偶发卡顿不累计到上限）
const STALL_RESET_MS = 30_000;
// 看门狗轮询间隔
const STALL_TICK_MS = 1_000;

/** 统计上报（0036 恢复；每 session 每期每事件一次；sessionStorage 去重——隐私模式静默）
 *  去重 key 在 POST **成功**后才写入：若首次上报失败（网络/CORS/服务端 404），
 *  该 session 内后续播放可重试，不会因失败残留的 key 永久短路（播放多次但统计恒 0 的隐患）。
 *  key 带 v2 版本前缀：旧版（无前缀，先写 key 后发请求）残留的短路 key 自动失效，
 *  无需用户手动清 sessionStorage */
// 单例 <audio> 提到模块级：provider 万一被重建（dev 热更新等），复用同一个元素而不是
// new 出第二个——否则老元素没人 pause 仍在播，页面上会出现"声音照常、播放条却不动"的分裂状态
let audioSingleton: HTMLAudioElement | null = null;
function ensureAudio(): HTMLAudioElement | null {
  if (typeof document === "undefined") return null; // SSR：无音频元素
  audioSingleton ??= new Audio();
  return audioSingleton;
}

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

  // buffering 的清除不再靠固定超时（超时只是把 spinner 关掉，卡死依旧）：
  // 统一交给下方「卡死看门狗」——有推进就清、久不推进就自愈重试、反复失败才置 audioError。

  // 单例音频元素（客户端 only；模块级复用，见 ensureAudio 注释）
  const [audio] = createSignal<HTMLAudioElement | null>(ensureAudio());

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
    a.src = episodeAudioUrl(ep.id, ep.publishedAt);
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
      link.href = episodeAudioUrl(nextEp.id, nextEp.publishedAt);
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
    // 播放中途的错误（分片 404/416、网络中断、解码失败）先走一次自愈（换 URL 重载 + 回原位），
    // 反复失败才判定音源不可用。实现挂在下面看门狗区块（同一次 effect 内同步赋值，
    // 事件触发时必然已就绪）；尚未开播（pos=0）的错误直接判失败，不做无谓重试
    let recoverFromError: ((pos: number) => void) | null = null;
    const onError = () => {
      setBuffering(false);
      const pos = a.currentTime;
      if (pos > 0 && recoverFromError) {
        recoverFromError(pos);
        return;
      }
      setAudioError(true);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("progress", onProgress);
    a.addEventListener("ended", onEnded);
    a.addEventListener("playing", onPlaying);
    a.addEventListener("pause", onPause);
    a.addEventListener("waiting", onWaiting);
    a.addEventListener("stalled", onWaiting); // 数据迟迟不来（分片请求挂起）：同 waiting 处理
    a.addEventListener("canplay", onCanPlay);
    a.addEventListener("seeked", onSeeked);
    a.addEventListener("error", onError);

    // ---- 卡死看门狗：播放中进度长时间不推进 → 同 src 重新 load 并 seek 回原位 ----
    // 浏览器对"某个 Range 分片请求挂住"不报错（不发 error/pause，只是停住），
    // 所以只能自己盯进度。有推进即清 buffering；卡住先如实显示加载中，超时后自愈重试；
    // 连续 STALL_MAX_RETRIES 次仍无推进才置 audioError（真·音源不可用）
    let lastSrc = a.src;
    let lastTime = -1;
    let lastAdvanceAt = Date.now();
    let retries = 0;
    let lastRetryAt = 0;
    /** 自愈第一档：seek 微调。不丢缓冲、不重下整集——只是让浏览器就"当前位置"重发
     *  它需要的那段 Range 请求。若当前位置正好落在缓冲空洞里，直接跳到下一段已缓冲区间的
     *  起点（空洞多半是某个分片没拿到，硬等只会一直等） */
    const nudge = () => {
      const t = a.currentTime;
      let target = t + 0.05;
      for (let i = 0; i < a.buffered.length; i++) {
        const s = a.buffered.start(i);
        if (s > t && s - t <= STALL_GAP_SKIP_SEC) { // 空洞在可接受范围内 → 跳过去
          target = s + 0.01;
          break;
        }
      }
      try {
        a.currentTime = Math.min(target, (a.duration || target) - 0.01);
      } catch { /* readyState 太低时 seek 会抛：交给下一档 */ }
      void a.play().catch(() => {});
    };

    /** 自愈第二档：换 URL 重载 + 回到原位。URL 上带一次性 retry 参数——
     *  音频响应是 7 天强缓存，浏览器自身可能存着一份"读到某个字节就断"的坏副本，
     *  用原 URL 重载只会一遍遍读回同一份坏数据（实测：同一 Range 请求重复三次、
     *  每次都停在同一秒）。换 URL 才能真正绕开本地缓存/中间层 */
    const reloadFrom = (pos: number) => {
      const ep = current();
      const base = ep ? episodeAudioUrl(ep.id, ep.publishedAt) : a.src.split("?")[0];
      const url = `${base}${base.includes("?") ? "&" : "?"}retry=${retries}`;
      const resume = () => {
        try {
          if (pos > 0) a.currentTime = pos;
        } catch { /* 忽略：seek 失败时下面的 play 仍会从头播，好过卡死 */ }
        setProgress(a.currentTime); // UI 立刻回到真实位置，不留幻影值
        void a.play().catch(() => {});
      };
      a.addEventListener("loadedmetadata", resume, { once: true });
      a.src = url;
      lastSrc = a.src; // 自愈换 URL 不算"切节目"，别触发状态重置
      a.load();
    };

    // error 事件的自愈入口（与看门狗共用同一套重试预算）
    recoverFromError = (pos: number) => {
      if (retries >= STALL_MAX_RETRIES) {
        setAudioError(true);
        return;
      }
      retries += 1;
      lastRetryAt = Date.now();
      lastAdvanceAt = Date.now();
      reloadFrom(pos);
    };

    const watchdog = setInterval(() => {
      // ① 无条件同步：播放条永远等于音频元素的真实状态。
      // 这是硬约束——"进度条钉死在 70%/0"的假象正是 UI 与元素脱节造成的：
      // 元素在 197.9s，播放条却停在别处。每拍同步后，UI 不可能再显示幻影值。
      // 例外：自愈重载的一瞬间元素被清空（readyState=0 且 currentTime=0），
      // 这时同步 0 会让进度条闪回起点——保持显示卡住位置，等 resume 校正即可
      // （正常切节目由 loadEpisode 显式置 0，不受此守卫影响）
      if (a.readyState > 0 || a.currentTime > 0) {
        setProgress(a.currentTime);
        setDuration(a.duration || 0);
      }

      if (a.src !== lastSrc) { // 切节目：看门狗状态整体重置
        lastSrc = a.src;
        lastTime = -1;
        lastAdvanceAt = Date.now();
        retries = 0;
        return;
      }
      if (!a.src || a.paused || a.ended) { // 未播放/已结束：不判卡死
        lastAdvanceAt = Date.now();
        return;
      }
      const t = a.currentTime;
      if (Math.abs(t - lastTime) > 0.05) { // 正常推进
        lastTime = t;
        lastAdvanceAt = Date.now();
        setBuffering(false); // 有推进 = 不在缓冲（waiting 之后未必跟 canplay）
        if (retries > 0 && Date.now() - lastRetryAt > STALL_RESET_MS) retries = 0;
        return;
      }
      setBuffering(true); // 停住了：如实显示加载中（不是"暂停图标 + 时间不动"）
      if (Date.now() - lastAdvanceAt < STALL_TIMEOUT_MS) return;
      if (retries >= STALL_MAX_RETRIES) {
        // 分级自愈全部失败 = 这个音源在这个位置就是拿不到数据（服务端/网络/本地坏缓存）。
        // 明确报错并停在**真实位置**：宁可让用户看到"出错了"，也不要假装还在播
        setAudioError(true);
        setBuffering(false);
        a.pause();
        setProgress(a.currentTime);
        return;
      }
      retries += 1;
      lastRetryAt = Date.now();
      lastAdvanceAt = Date.now(); // 给这次自愈留出时间窗
      // 分级：有元数据 + 有缓冲数据时，前 STALL_NUDGE_RETRIES 次只做 seek 微调
      // （代价小、不丢缓冲）；仍不动才升级为换 URL 重载（绕开坏缓存）。
      // 元数据都没拿到（readyState=0，例如 moov 在文件尾、那个尾部请求恰好挂住）时
      // 微调毫无意义——直接重载，别白白多等两轮
      const canNudge = a.readyState >= 1 && a.buffered.length > 0;
      if (canNudge && retries <= STALL_NUDGE_RETRIES) nudge();
      else reloadFrom(a.currentTime);
    }, STALL_TICK_MS);

    onCleanup(() => {
      clearInterval(watchdog);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("progress", onProgress);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("playing", onPlaying);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("waiting", onWaiting);
      a.removeEventListener("stalled", onWaiting);
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