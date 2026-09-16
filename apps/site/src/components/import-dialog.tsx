// 导入弹框：URL 输入 → 可达性检测 → 确认投稿（可触达后跳 /import?url=… 进入第二步）
// 状态机：input（输入框）→ checking（检测中）→ error（检测失败）
// 打开方式：openImportDialog()（如首页 CTA；未登录场景由 use:auth 守卫先拦截）
import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Button, Dialog, TextInput } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { confirmLoggedIn } from "../lib/auth-guard";
import { checkUrlAndStore, isSubmittedUrl } from "../lib/url-check";
import { ENABLED_SAMPLE_LANGUAGES } from "../lib/languages";
import { ZonePicker } from "./zone-picker";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions, typography } from "@dailogues/ui/theme.stylex";

type DialogState = "input" | "checking" | "error" | "duplicate" | "zone";

/** 服务端 check 返回的单区状态（zones[zone]） */
interface ZoneState {
  submitted: boolean;
  status: string | null;
  hasSample: boolean;
  canSubmit: boolean;
  submissionId: string | null;
  episode: { slug?: string; title?: string | null } | null;
}

/** 支持的 AI 对话平台分享链接（仅这些平台的分享页 URL 才算合法投稿链接） */
const SHARE_HOSTS = [
  "chat.deepseek.com", "claude.ai", "chatgpt.com", "chat.openai.com",
  "gemini.google.com", "share.gemini.google", "kimi.moonshot.cn", "doubao.com", "www.doubao.com",
  "tongyi.aliyun.com", "perplexity.ai", "x.com", "twitter.com",
];

/** 专用分享子域：整个域名只承载分享页（如 share.gemini.google/<id>），任意非根路径即分享页 */
const SHARE_SUBDOMAINS = ["share.gemini.google"];

/** 平台分享链接识别：host 白名单 + 分享路径（/share/ 或 /s/ 或非根路径） */
export function isShareUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (!SHARE_HOSTS.includes(host)) return false;
    const path = url.pathname.replace(/\/+$/, "");
    if (path.length <= 1) return false;
    // 专用分享子域（share.gemini.google/<shareId>）：路径即分享 ID，任意非根路径都算分享页
    if (SHARE_SUBDOMAINS.includes(host)) return true;
    // 分享页：/share/xxx、/s/xxx，或至少是具体内容路径（非首页）
    return path.includes("/share/") || path.includes("/s/") || path.split("/").length > 2;
  } catch {
    return false;
  }
}


// —— 全局单例（AppShell 挂载；openImportDialog 打开）——
const [dialogOpen, setDialogOpen] = createSignal(false);
// 弹框内部状态（打开时自动预填/重置用）
let setDialogUrl: ((v: string) => void) | null = null;
let setDialogState: ((s: DialogState) => void) | null = null;
let setDialogFail: ((v: string) => void) | null = null;

/** 打开导入弹框 */
export function openImportDialog(): void {
  setDialogOpen(true);
}

// —— submissions 重复检测本地缓存 ——
// 同一 URL 不重复请求 check 端点：已投稿 24h / 未投稿 10min（投稿状态不回退，未投稿
// 可能随后被投）。localStorage 持久（跨刷新）+ 内存 Map（快读）。
interface CheckCacheEntry {
  /** 归属：self=自己的对话（可投未占用的区）/ other=他人的（一律拒绝）/ none=尚无投稿 */
  owner: "self" | "other" | "none";
  /** 各投稿区占用与采样就绪（zone → 状态） */
  zones: Record<string, ZoneState>;
  existing: boolean;
  submissionId?: string;
  episode?: { slug?: string; title?: string | null } | null;
  ts: number;
}
const CHECK_CACHE_KEY = "dailog.submissionCheck";
const CHECK_TTL_EXISTING = 24 * 60 * 60 * 1000;
const CHECK_TTL_NONE = 10 * 60 * 1000;
const CHECK_CACHE_MAX = 100;
const checkCache = new Map<string, CheckCacheEntry>();

function readCheckStore(): Record<string, CheckCacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(CHECK_CACHE_KEY) ?? "{}") as Record<string, CheckCacheEntry>;
  } catch {
    return {};
  }
}
function writeCheckStore(store: Record<string, CheckCacheEntry>): void {
  try {
    localStorage.setItem(CHECK_CACHE_KEY, JSON.stringify(store));
  } catch {
    // 存储不可用（隐私模式等）：仅内存缓存
  }
}

/** 重复检测（带本地缓存）：命中缓存不请求端点 */
async function checkSubmission(url: string): Promise<CheckCacheEntry> {
  const cached = checkCache.get(url) ?? readCheckStore()[url];
  if (cached) {
    const ttl = cached.existing ? CHECK_TTL_EXISTING : CHECK_TTL_NONE;
    if (Date.now() - cached.ts < ttl) {
      // 归一化：旧版缓存（本次改版前写入）没有 owner/zones 字段——按"已投稿=自己的"处理，
      // 不能留 undefined（下游会按区判断，解引用会炸）
      return {
        ...cached,
        owner: cached.owner ?? (cached.existing ? "self" : "none"),
        zones: cached.zones ?? {},
      };
    }
  }
  try {
    const res = await fetch("/v1/submissions/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json().catch(() => null)) as {
      existing?: boolean;
      owner?: "self" | "other" | "none";
      zones?: Record<string, ZoneState>;
      submissionId?: string;
      episode?: { slug?: string; title?: string | null } | null;
    } | null;
    const entry: CheckCacheEntry = {
      owner: data?.owner ?? "none",
      zones: data?.zones ?? {},
      existing: !!data?.existing,
      submissionId: data?.submissionId ?? undefined,
      episode: data?.episode ?? null,
      ts: Date.now(),
    };
    checkCache.set(url, entry);
    const store = readCheckStore();
    const keys = Object.keys(store);
    if (keys.length >= CHECK_CACHE_MAX) {
      // 超上限：清掉最旧的一半（按 ts）
      keys.sort((a, b) => (store[a]?.ts ?? 0) - (store[b]?.ts ?? 0));
      for (const k of keys.slice(0, Math.floor(CHECK_CACHE_MAX / 2))) delete store[k];
    }
    store[url] = entry;
    writeCheckStore(store);
    return entry;
  } catch {
    return { owner: "none", zones: {}, existing: false, ts: 0 }; // 检测失败：不缓存（调用方走兜底）
  }
}

// —— 剪贴板实时监控 ——
// 剪贴板含合法 URL（且弹框未开）→ 自动打开弹框并预填 URL。
// 轮询（3s）+ 页面重新可见时检测；权限拒绝/不可用静默（有权限的浏览器生效）。
// 去重：同一 URL 只自动弹一次（用户关闭后不重复打扰；新 URL 才再弹）。
let lastClipboardUrl = "";

async function tryOpenFromClipboard(): Promise<void> {
  if (dialogOpen()) return; // 弹框已开：不打断用户操作
  // /submit 路由（导入第二步）不检测剪贴板——URL 已由弹框检测并预填
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/submit")) return;
  // 剪贴板自动弹框仅登录用户生效（未登录走 use:auth 登录引导，不自动打扰）
  if (!(await confirmLoggedIn())) return;
  try {
    const text = await navigator.clipboard.readText();
    const url = text.trim();
    // 只对合法平台分享链接自动弹（不要什么 URL 都弹）；已提交过的 URL 不再弹
    if (!url || !isShareUrl(url) || url === lastClipboardUrl || isSubmittedUrl(url)) return;
    lastClipboardUrl = url; // 记录（无论是否弹，避免重复检测/重复打扰）
    // 该 URL 已无可投的区（本人两个区都投过 / 他人已投稿）→ 不弹；
    // 只投了部分区仍要弹——否则用户永远发现不了"还能补投另一个语言区"（本地缓存命中不请求）。
    // ts === 0 表示检测失败（无有效结果）：按可弹处理，走弹框内确认时的兜底判定。
    const check = await checkSubmission(url);
    if (check.ts !== 0 && (check.owner === "other" || !ENABLED_SAMPLE_LANGUAGES.some((z) => check.zones[z]?.canSubmit))) return;
    setDialogUrl?.(url);
    setDialogState?.("input");
    setDialogFail?.("");
    setDialogOpen(true);
  } catch {
    // 剪贴板权限拒绝/API 不可用：静默（不打扰）
  }
}

if (typeof document !== "undefined") {
  setInterval(() => void tryOpenFromClipboard(), 3000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void tryOpenFromClipboard();
  });
}

const styles = stylex.create({
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing4,
    padding: `${dimensions.spacing2} 0`,
  },
  title: {
    fontSize: dimensions.fontSizeXl,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
  },
  desc: {
    margin: 0,
  },
  actions: {
    display: "flex",
    gap: dimensions.spacing3,
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
  fail: {
    color: colors.danger,
    fontSize: dimensions.fontSizeMd,
    margin: 0,
    lineHeight: 1.6,
  },
});

/** 导入弹框（URL 输入 + 可达性检测 + 确认投稿） */
export function ImportDialog() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [state, setState] = createSignal<DialogState>("input");
  const [url, setUrl] = createSignal("");
  const [failMsg, setFailMsg] = createSignal("");
  // 重复投稿信息（已投稿 → 提示 + 跳转投稿详情 /submission/<id>）
  const [dupSubmissionId, setDupSubmissionId] = createSignal<string | null>(null);
  const [dupEpisode, setDupEpisode] = createSignal<{ slug: string; title: string | null } | null>(null);
  // 投稿区占用（zone → 状态）：进 zone 态后渲染选择器
  const [zoneInfo, setZoneInfo] = createSignal<Record<string, ZoneState> | null>(null);
  // 他人已投稿：**不做跳转**（也不暴露对方的投稿/节目信息），只在 URL 输入框下方给状态提示
  const [blockedMsg, setBlockedMsg] = createSignal<string | null>(null);
  // 剪贴板监控预填通道（组件挂载期间生效）
  setDialogUrl = setUrl;
  setDialogState = setState;
  setDialogFail = setFailMsg;

  // 输入校验：空 → 禁用确认；非平台分享链接 → 非法提示（输入框下方）
  const urlInvalid = () => url().trim().length > 0 && !isShareUrl(url().trim());
  const canSubmit = () => url().trim().length > 0 && !urlInvalid();

  const close = () => {
    setDialogOpen(false);
    setState("input");
    setUrl("");
    setFailMsg("");
    setDupSubmissionId(null);
    setDupEpisode(null);
    setZoneInfo(null);
    setBlockedMsg(null);
  };
  const backToInput = () => {
    setState("input");
    setFailMsg("");
  };

  // 确认投稿：归属判定 + 投稿区占用（可靠门槛）→ 选投稿区 → 存检测结果 → 跳 /submit?id=…&zone=…（第二步）。
  // 可达性**不阻断**：格式已由 isShareUrl 校验（可靠门槛），链接有效性由编辑端采集时验证；
  // 可达性探测受 CORP/网络/反爬影响会误判，不能当作投稿门槛（后端投稿端点也不校验可达性）。
  const handleConfirm = async () => {
    setState("checking");
    setBlockedMsg(null);
    try {
      const checkData = await checkSubmission(url().trim());
      // 0) 检测无有效结果（网络失败 / 未登录 401）：不拦——格式已本地校验，改由 /submit 的权威 check 把关
      if (checkData.ts === 0) {
        setZoneInfo({});
        setState("zone");
        return;
      }
      // 1) 他人已投稿：同一对话的投递权归首个投稿人 → 不跳转，输入框下方内联提示（不暴露对方信息）
      if (checkData.owner === "other") {
        setBlockedMsg(t("importDialog.claimed"));
        setState("input");
        return;
      }
      // 2) 自己的对话（或首次投稿）：还有可投的区 → 选投稿区；全部已投 → 重复提示
      const free = ENABLED_SAMPLE_LANGUAGES.filter((z) => checkData.zones[z]?.canSubmit);
      if (free.length === 0) {
        setDupSubmissionId(checkData.submissionId ?? null);
        const ep = checkData.episode;
        setDupEpisode(ep && ep.slug ? { slug: ep.slug, title: ep.title ?? null } : null);
        setState("duplicate");
        return;
      }
      setZoneInfo(checkData.zones);
      setState("zone");
    } catch {
      setFailMsg(t("importDialog.unreachable"));
      setState("error");
    }
  };

  /** 选定投稿区 → 存检测结果（localStorage，key = 确定性投稿 ID）→ 跳 /submit?id=…&zone=… */
  const pickZone = async (zone: string) => {
    try {
      const { id } = await checkUrlAndStore(url().trim());
      close();
      const target = `/submit?id=${encodeURIComponent(id)}&zone=${encodeURIComponent(zone)}`;
      if (window.location.pathname.startsWith("/submit")) {
        // 已在 /submit（如 empty 态点 Submit again）：整页刷新，
        // 重新挂载并读取 localStorage 中的检测结果（客户端 navigate 不重跑 onMount）
        window.location.href = target;
      } else {
        navigate(target);
      }
    } catch {
      setFailMsg(t("importDialog.unreachable"));
      setState("error");
    }
  };

  // 跳转投稿详情：/submission/<id>（公开详情页；拿不到 id 时回退节目页/我的投稿）
  const goSubmission = () => {
    const target = dupSubmissionId()
      ? `/submission/${dupSubmissionId()}`
      : dupEpisode()?.slug
        ? `/episode/${dupEpisode()!.slug}`
        : "/me/submits";
    close();
    navigate(target);
  };

  return (
    <Dialog isOpen={dialogOpen()} onOpenChange={(v) => !v && close()} width={480} purpose="form">
      <div {...stylex.props(styles.wrap)}>
        <Show
          when={state() === "zone"}
          fallback={
            <Show
          when={state() === "duplicate"}
          fallback={
            <Show
              when={state() !== "error"}
              fallback={
                <>
                  <p {...stylex.props(styles.title)}>{t("submit.import")}</p>
                  <p {...stylex.props(styles.fail)} role="alert">{failMsg()}</p>
                  <div {...stylex.props(styles.actions)}>
                    <Button onClick={backToInput}>{t("importDialog.retry")}</Button>
                    <Button variant="neutral" appear="ghost" onClick={close}>
                      {t("common.cancel")}
                    </Button>
                  </div>
                </>
              }
            >
              <p {...stylex.props(styles.title)}>{t("submit.import")}</p>
              <p {...stylex.props(styles.desc)}>{t("submit.step1Desc")}</p>
              <TextInput
                label={t("submit.urlLabel")}
                type="url"
                size="lg"
                value={url()}
                onChange={(v) => { setUrl(v); setBlockedMsg(null); }}
                placeholder={t("submit.urlPlaceholder")}
                isDisabled={state() === "checking"}
                hasClear
                status={
                  // 他人已投稿的内联状态优先（改 URL 即清除）
                  blockedMsg() ? { type: "error", message: blockedMsg()! }
                    : urlInvalid() ? { type: "error", message: t("submit.urlUnsupported") }
                    : undefined
                }
                onEnter={() => { if (canSubmit() && state() === "input") void handleConfirm(); }}
                statusVariant="attached"
              />
              <p {...stylex.props(styles.desc, typography.caption)}>{t("submit.urlHint")}</p>
              <div {...stylex.props(styles.actions)}>
                <Button appear="ghost" onClick={close}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={() => void handleConfirm()}
                  disabled={!canSubmit() || state() === "checking"}
                  isLoading={state() === "checking"}
                >
                  {t("submit.import")}
                </Button>
              </div>
            </Show>
          }
        >
          {/* duplicate：本人已投过该 URL 的可投区 → 提示 + 查看投稿详情 */}
          <p {...stylex.props(styles.title)}>{t("importDialog.duplicate")}</p>
          <p {...stylex.props(styles.desc)}>{t("importDialog.duplicateHint")}</p>
          <Show when={dupEpisode()}>
            <p {...stylex.props(styles.fail)}>{dupEpisode()!.title}</p>
          </Show>
          <div {...stylex.props(styles.actions)}>
            <Button onClick={goSubmission}>{t("importDialog.viewSubmission")}</Button>
            <Button variant="neutral" appear="ghost" onClick={close}>
              {t("common.cancel")}
            </Button>
          </div>
            </Show>
          }
        >
          {/* zone：选择投稿区（一投稿 = 一语言区 = 一期节目；已投过的区 disabled） */}
          <p {...stylex.props(styles.title)}>{t("importDialog.zone")}</p>
          <p {...stylex.props(styles.desc)}>{t("importDialog.zoneDesc")}</p>
          <ZonePicker
            options={ENABLED_SAMPLE_LANGUAGES.map((z) => ({
              zone: z,
              label: t(`lang.${z}` as never),
              taken: !!zoneInfo()?.[z]?.submitted,
            }))}
            value=""
            takenLabel={t("submit.zoneTaken")}
            onChange={(z) => void pickZone(z)}
          />
          <div {...stylex.props(styles.actions)}>
            <Button variant="neutral" appear="ghost" onClick={backToInput}>
              {t("common.cancel")}
            </Button>
          </div>
        </Show>
      </div>
    </Dialog>
  );
}
