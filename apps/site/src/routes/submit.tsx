import { A, useSearchParams } from "@solidjs/router";
import { createSignal, createEffect, Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { AuthGate } from "../components/auth-gate";
import { isShareUrl } from "../components/import-dialog";
import { getUrlCheck, markSubmitted, probeReachable, type Reachability } from "../lib/url-check";
import { ENABLED_SAMPLE_LANGUAGES, isSupportedSampleLanguage } from "../lib/languages";
import { ZonePicker } from "../components/zone-picker";
import { env } from "../lib/env";
import { openImportDialog } from "../components/import-dialog";
import VoiceSamplePreview from "../components/voice-sample-preview";
import VoiceSampleRecorderDialog, { type SavedSample } from "../components/voice-sample-recorder-dialog";

// 投稿流程（本质版，2026-08-13）：
//   input   输入态：分享链接（前端基本 http/https 校验）→ [继续]
//   confirm 确认投稿态：人设（可选）+ 声音采样（必填）→ [确认投稿]
//   done    提交成功 → 等待审核（跳转投稿详情 /submission/<id>）
// 服务端只做 URL 合法性 + 触达性检查，不做内容采集；制作由编辑本地 Agent 完成。
// 端点在 site 站内代理（/v1/*），会话经 cookie；未登录跳统一登录页

type Step = "confirm" | "done";

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  content: {
    maxWidth: "640px",
    margin: "0 auto",
    padding: dimensions.spacing8,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing5,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
  },
  card: {
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    padding: dimensions.spacing5,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
  },
  stepTitle: {
    fontSize: dimensions.fontSizeLg,
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
  },
  stepDesc: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
  },
  label: {
    fontSize: dimensions.fontSizeSm,
    color: colors.neutral,
  },
  hint: {
    fontSize: dimensions.fontSizeSm,
    color: colors.neutral,
    margin: 0,
  },
  cardBlock: {
    marginBottom: dimensions.spacing3,
  },
  urlCard: {
    backgroundColor: colors.surface,
    borderRadius: dimensions.radiusMd,
    padding: `${dimensions.spacing4}`,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
  },
  urlRow: {
    display: "flex",
    gap: dimensions.spacing3,
    alignItems: "baseline",
    flexWrap: "wrap",
  },
  urlLabel: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeXs,
    margin: 0,
    minWidth: "64px",
  },
  urlValue: {
    color: colors.foreground,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
    wordBreak: "break-all",
  },
  error: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  ok: {
    color: colors.brandStrong,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  success: {
    fontSize: dimensions.fontSizeLg,
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
  },
  actions: {
    display: "flex",
    gap: dimensions.spacing3,
    alignItems: "center",
  },
  // 重复投稿：已生成节目横条（封面缩略图 + 标题 + 期号，点击进详情）
  epBar: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    textDecoration: "none",
    color: colors.foreground,
    ":hover": { borderColor: colors.primary },
  },
  epTitle: {
    fontWeight: dimensions.fontWeightMedium,
    fontSize: dimensions.fontSizeMd,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  epMeta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  epText: {
    minWidth: "0", // 标题省略号生效前提（flex 子项允许收缩）
  },
  epListen: {
    textDecoration: "underline",
  },
});

export default function SubmitPage() {
  const { t } = useI18n();
  const [params] = useSearchParams<{ id?: string; url?: string; zone?: string }>();
  const [step, setStep] = createSignal<Step>("confirm");
  const [url, setUrl] = createSignal("");
  // 当前检测结果 id（localStorage 的 json key；用于展示检测信息区块）
  const [checkId, setCheckId] = createSignal<string | null>(null);
  // URL 本地检测（防绕过弹框手动构造 ?url=）：格式非法 → 导入按钮置灰
  // 状态：checking（检测中）/ ok（格式合法）/ invalid（非平台链接）/ unreachable（探测未确认）/ empty（缺失）
  // 可达性探测仅供参考，不阻断投稿（探测受 CORP/网络影响会误判；后端投稿端点不校验可达性）
  const [urlState, setUrlState] = createSignal<"checking" | "ok" | "invalid" | "unreachable" | "empty">("checking");
  // 门槛：格式合法即可提交；仅明确 404（页面不存在）才拦截——其余（可达/无法确认）均可提交
  const urlReady = () => (urlState() === "ok" || urlState() === "unreachable") && reachable() !== "notfound";
  // 可达性探测结果（仅展示，不阻断投稿）：null = 检测中 / reachable = 存在 / notfound = 404 / unknown = 无法确认
  const [reachable, setReachable] = createSignal<Reachability | null>(null);
  const [existing, setExisting] = createSignal<string | null>(null);
  // 重复投稿响应的附属信息：已有投稿 id（详情链接）+ 已生成节目（published 才返回）
  const [existingId, setExistingId] = createSignal<string | null>(null);
  const [existingEpisode, setExistingEpisode] = createSignal<{ slug?: string; title?: string | null } | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  // 人设（可选）+ 采样（必填；已有采样自动填充可沿用）
  const [callName, setCallName] = createSignal("");   // callNameInEpisode：本次节目称呼（默认 displayName）
  const [suggestion, setSuggestion] = createSignal(""); // 节目建议（可选；仅供编辑部选题参考）
  const [hasVoiceSample, setHasVoiceSample] = createSignal(false);
  const [voiceLang, setVoiceLang] = createSignal("zh"); // 已有采样语种（展示用）
  const [sampleDuration, setSampleDuration] = createSignal(0); // 已有采样时长（预览条「XX秒」用）
  const [voiceSampleId, setVoiceSampleId] = createSignal<string | null>(null); // 采样 id（投稿记录用）
  const [recorderOpen, setRecorderOpen] = createSignal(false);
  const [recorderMode, setRecorderMode] = createSignal<"add" | "edit">("add");
  const [submitting, setSubmitting] = createSignal(false);
  // 提交成功响应里的投稿 id（done 态“投稿详情”按钮跳 /submission/<id> 用）
  const [submissionId, setSubmissionId] = createSignal<string | null>(null);
  // 投稿区（zone = 目标语言）：一投稿 = 一语言区 = 一期节目。由导入弹框选定（?zone=），
  // 本页可改；占用状态以服务端 check 为权威（已投过的区不可再投）。
  const [zone, setZone] = createSignal<string>(isSupportedSampleLanguage(params.zone) ? params.zone! : "zh");
  const [zoneInfo, setZoneInfo] = createSignal<Record<string, { submitted: boolean; canSubmit: boolean; status: string | null; hasSample: boolean }> | null>(null);
  // 他人已投稿（check.owner=other）：同一对话的投递权归首个投稿人 → 整条投稿流程不可用
  const [claimed, setClaimed] = createSignal(false);

  /** 按"该区是否已有采样"决定是否回读：有 → 取该语种那条的 id/时长（预览条用）；
   *  无 → 直接清空。**缺采样时不发请求**——`/v1/me/voice-sample` 无记录返回 404，
   *  页面加载时刷一串 404 会被误读成"音频挂了"（真值来源见 refreshZoneInfo 的 check）。 */
  const applyZoneSample = async (lang: string, exists: boolean) => {
    if (!exists) {
      setHasVoiceSample(false);
      setVoiceSampleId(null);
      setSampleDuration(0);
      return;
    }
    try {
      const res = await fetch(`/v1/me/voice-sample?language=${encodeURIComponent(lang)}`);
      if (!res.ok) {
        setHasVoiceSample(false);
        setVoiceSampleId(null);
        setSampleDuration(0);
        return;
      }
      const s = (await res.json()) as { id?: string | null; language?: string; duration?: number } | null;
      setHasVoiceSample(true);
      if (s?.language) setVoiceLang(s.language);
      setVoiceSampleId(s?.id ?? null);
      setSampleDuration(s?.duration ?? 0);
    } catch { /* 静默 */ }
  };

  /** 服务端 check：投稿区占用（已投过的区 disabled）+ 归属（他人已投稿 → 整条流程提示不可用） */
  const refreshZoneInfo = async (u: string) => {
    try {
      const res = await fetch("/v1/submissions/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: u }),
      });
      if (!res.ok) return;
      const d = (await res.json()) as {
        owner?: string;
        zones?: Record<string, { submitted: boolean; canSubmit: boolean; status: string | null; hasSample: boolean }>;
      } | null;
      const zones = d?.zones ?? null;
      setClaimed(d?.owner === "other");
      setZoneInfo(zones);
      // 当前区已被占、但还有可投的区 → 自动切过去（避免一进页面就撞"已投稿"）
      let target = zone();
      if (zones && zones[target]?.submitted) {
        const free = ENABLED_SAMPLE_LANGUAGES.find((z) => zones[z]?.canSubmit);
        if (free && free !== target) {
          setZone(free);
          setVoiceSampleId(null);
          target = free;
        }
      }
      // 采样就绪以 check(zones[].hasSample) 为权威；确有其物才回读该语种那条
      await applyZoneSample(target, !!zones?.[target]?.hasSample);
    } catch { /* 静默 */ }
  };

  /** 切换投稿区：采样随之切换到该区语种（能不能提交由该区采样决定）；
   *  采样有无直接用已拉到的 check 结果判定，不再多发请求 */
  const changeZone = (z: string) => {
    if (z === zone()) return;
    setZone(z);
    setVoiceSampleId(null);
    void applyZoneSample(z, !!zoneInfo()?.[z]?.hasSample);
  };

  // 响应 ?id=/?url= 变化（原生路由导航到相同路径不同 query 时也会触发——
  // 弹框确认投稿后 navigate('/submit?id=…') 无需整页刷新）：
  // ?id= 从 localStorage 取检测结果；无缓存/过期 → empty（独占提示）；
  // 旧链接 ?url= 兜底本地检测（手动构造无法绕过）
  // 门槛：格式合法（isShareUrl）即可投稿——可达性探测仅供参考，不阻断
  createEffect(() => {
    const id = params.id;
    if (id) {
      setCheckId(id);
      const check = getUrlCheck(id);
      if (check && check.valid) {
        setUrl(check.url);
        setUrlState("ok");
        // 可达性仅展示提示：重新探测一次（结果不阻断投稿）
        setReachable(null);
        void probeReachable(check.url)
          .then(setReachable)
          .catch(() => setReachable("unknown"));
        void refreshZoneInfo(check.url);      // 投稿区占用 + 该区采样就绪（权威，200 不会 404）
        return;
      }
      setUrlState("empty");
      return;
    }
    setCheckId(null);
    setReachable(null);
    const prefill = params.url;
    if (!prefill || !prefill.startsWith("http")) {
      setUrlState("empty");
      return;
    }
    setUrl(prefill);
    if (!isShareUrl(prefill)) {
      setUrlState("invalid");
      return;
    }
    setUrlState("ok");
    // 可达性仅展示提示：探测成功显示确认，失败也不阻断（见 unreachable 提示文案）
    void probeReachable(prefill)
      .then(setReachable)
      .catch(() => setReachable("unknown"));
    void refreshZoneInfo(prefill);
  });

  // 进入确认投稿态时拉取已有人设/采样（此时 AuthGate 已放行、必然登录；避免未登录 401 噪音）
  createEffect(() => {
    if (step() !== "confirm") return;
    void (async () => {
      try {
        const profileRes = await fetch("/v1/me/profile");
        if (profileRes.ok) {
          const profile = (await profileRes.json()) as { displayName?: string | null };
          // 称呼默认填充主持人昵称 displayName（callNameInEpisode；脚本生成时按脚本语言改写）
          if (profile.displayName) setCallName(profile.displayName);
        }
      } catch { /* 静默 */ }
      if (url()) await refreshZoneInfo(url());   // 投稿区占用 + 采样就绪（登录后权威拉取一次）
    })();
  });

  /** 是否具备声音采样——无采样时禁用提交按钮（接口同样严格校验）。
   *  采样上传时机已前移到录音弹窗「确认保存」：此处只沿用已有/新保存的 sampleId */
  const hasSample = () => hasVoiceSample();

  /** 录音弹窗保存成功：记录采样（语种/时长/id 用于预览条与投稿） */
  const onSampleSaved = (s: SavedSample) => {
    setVoiceSampleId(s.sampleId || null);
    setVoiceLang(s.language);
    setSampleDuration(s.duration);
    setHasVoiceSample(true);
    setRecorderOpen(false);
    // 复核该投稿区语种：弹窗内可能改过语种，录了别的语种不算数（重新走 check，权威）
    if (url()) void refreshZoneInfo(url());
  };

  /** 确认投稿：提交投稿（URL + 本次称呼 + 投稿使用的采样 id） */
  const confirmSubmit = async () => {
    setError(null);
    // 他人已投稿：同一对话的投递权归首个投稿人（按钮已禁用，双保险）
    if (claimed()) {
      setError(t("submit.error.already_claimed"));
      return;
    }
    // 声音采样：该投稿区无采样才拦截（按钮已禁用，双保险）
    if (!hasVoiceSample()) {
      setError(t("submit.error.needVoice"));
      return;
    }
    // 提交投稿（URL + 本次节目称呼 callNameInEpisode + 投稿使用的采样）
    setSubmitting(true);
    try {
      const res = await fetch("/v1/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: url().trim(),
          language: zone(),   // 投稿区（目标语言）——决定脚本语言与节目 feed 归属
          callNameInEpisode: callName().trim().slice(0, 20) || undefined,
          suggestion: suggestion().trim().slice(0, 500) || undefined,
          voiceSampleId: voiceSampleId() || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      // 重复投稿：服务端命中已有投稿时返回 200 { existing: true }（信息响应，非错误码）——
      // 必须先于 res.ok 判断，否则 existing 被当成功处理，页面误显示“提交成功/等待审核”
      if (data?.existing) {
        setExisting(String((data as { status?: string })?.status ?? "submitted"));
        setExistingId(typeof data?.submissionId === "string" ? data.submissionId : null);
        setExistingEpisode((data as { episode?: { slug?: string; title?: string | null } | null })?.episode ?? null);
        return;
      }
      if (!res.ok) {
        // 错误码映射友好文案；未知码显示后端 detail
        const code = String(data?.error ?? res.status);
        // 他人已投稿（并发/换标签页时才会走到）：同步为不可用态，避免用户反复重试
        if (code === "already_claimed") setClaimed(true);
        const mapped = t(`submit.error.${code}` as never);
        const detail = (data as { detail?: string | { message?: string } })?.detail;
        setError(detail && typeof detail === "string" ? detail : (mapped.startsWith("submit.error.") ? String(code) : mapped));
        return;
      }
      markSubmitted(url().trim(), zone()); // 已提交（该投稿区）：剪贴板自动弹窗不再弹该 URL
      if (typeof data?.submissionId === "string") setSubmissionId(data.submissionId);
      setStep("done");
    } catch {
      setError(t("submit.error.submitFailed", { error: "network" }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
      <AuthGate redirect="/submit">
      <div {...stylex.props(layouts.page)}>
        <div {...stylex.props(layouts.containerSm)}>
          <Title>{t("submit.title")} · dailog</Title>
        {/* empty（未检测到有效 URL）独占状态：连页面标题都不显示 */}
        <Show when={urlState() !== "empty"}>
          <h1 {...stylex.props(styles.title)}>{t("submit.title")}</h1>
        </Show>

        {/* 2. 确认投稿态：人设编辑（可选）+ 声音采样（必填）→ [确认投稿] */}
        <Show when={step() === "confirm"}>
          {/* 未检测到有效 URL：独占状态，只显示提示 + 重新投稿 */}
          <Show
            when={urlState() === "empty"}
            fallback={
              <>
                {/* 区块 1：分享链接检测信息（灰底圆角；含 URL 状态提示） */}
                <div {...stylex.props(layouts.fullRow, styles.card, styles.cardBlock)}>
                  <Show when={checkId()}>
                    <p {...stylex.props(styles.stepTitle)}>{t("submit.checkInfo")}</p>
                    <div {...stylex.props(styles.urlRow)}>
                      <p {...stylex.props(styles.urlLabel)}>{t("submit.checkUrl")}</p>
                      <p {...stylex.props(styles.urlValue)}>{url()}</p>
                    </div>
                    <div {...stylex.props(styles.urlRow)}>
                      <p {...stylex.props(styles.urlLabel)}>{t("submit.checkValid")}</p>
                      <p {...stylex.props(styles.urlValue)}>{urlState() === "ok" || urlState() === "unreachable" ? "✓" : "—"}</p>
                      <p {...stylex.props(styles.urlLabel)}>{t("submit.checkReachable")}</p>
                      <p {...stylex.props(styles.urlValue)}>
                        {reachable() === "reachable" ? "✓" : reachable() === "notfound" ? "404" : reachable() === "unknown" ? "—" : t("submit.checking")}
                      </p>
                      <p {...stylex.props(styles.urlLabel)}>{t("submit.checkTime")}</p>
                      <p {...stylex.props(styles.urlValue)}>
                        {checkId() ? new Date(getUrlCheck(checkId()!)?.checkedAt ?? Date.now()).toLocaleString("zh-CN") : ""}
                      </p>
                    </div>
                  </Show>
                  <Show when={urlState() === "invalid"}>
                    <p {...stylex.props(styles.error)}>{t("submit.urlUnsupported")}</p>
                  </Show>
                  <Show when={urlState() === "checking"}>
                    <p {...stylex.props(styles.hint)}>{t("submit.importing")}</p>
                  </Show>
                  <Show when={reachable() === "notfound" && (urlState() === "ok" || urlState() === "unreachable")}>
                    <p {...stylex.props(styles.error)}>{t("submit.notFound")}</p>
                  </Show>
                  <Show when={reachable() === "unknown" && (urlState() === "ok" || urlState() === "unreachable")}>
                    <p {...stylex.props(styles.hint)}>{t("submit.reachableUnconfirmed")}</p>
                  </Show>
                </div>

                {/* 区块 1.5：投稿区（目标语言）——一投稿 = 一语言区 = 一期节目；
                    已投过的区 disabled（同一篇对话可分别投到不同区，但同区不可重复投） */}
                <div {...stylex.props(layouts.fullRow, styles.card, styles.cardBlock)}>
                  <p {...stylex.props(styles.stepTitle)}>{t("submit.zone")}</p>
                  <p {...stylex.props(styles.stepDesc)}>{t("submit.zoneDesc")}</p>
                  <ZonePicker
                    options={ENABLED_SAMPLE_LANGUAGES.map((z) => ({
                      zone: z,
                      label: t(`lang.${z}` as never),
                      taken: !!zoneInfo()?.[z]?.submitted,
                    }))}
                    value={zone()}
                    takenLabel={t("submit.zoneTaken")}
                    disabled={claimed()}
                    onChange={changeZone}
                  />
                  <Show when={claimed()}>
                    <p {...stylex.props(styles.error)}>{t("submit.error.already_claimed")}</p>
                  </Show>
                </div>

                {/* 区块 2：② Set up your host persona（主持人 + 声音采样） */}
                <div {...stylex.props(layouts.fullRow, styles.card, styles.cardBlock)}>
                  <p {...stylex.props(styles.stepTitle)}>{t("submit.step2")}</p>
                  <p {...stylex.props(styles.stepDesc)}>{t("submit.step2Desc")}</p>
                  <label {...stylex.props(styles.label)}>{t("submit.callName")}</label>
                  <input
                    {...stylex.props(styles.input)}
                    placeholder={t("submit.callNamePlaceholder")}
                    value={callName()}
                    onInput={(e) => setCallName(e.currentTarget.value)}
                  />
                  <Show when={hasVoiceSample()}>
                    <p {...stylex.props(styles.ok)}>{t("submit.voiceFilled")}</p>
                    <VoiceSamplePreview
                      duration={sampleDuration()}
                      language={voiceLang()}
                      audioUrl={`/v1/me/voice-sample/audio?language=${encodeURIComponent(zone())}`}
                      onReRecord={() => {
                        setRecorderMode("edit");
                        setRecorderOpen(true);
                      }}
                    />
                  </Show>
                  <Show when={!hasVoiceSample()}>
                    {/* 该投稿区还没有对应语种的采样——录一段即可投这一区 */}
                    <p {...stylex.props(styles.hint)}>
                      {t("submit.zoneNoSample", { zone: t(`lang.${zone()}` as never) })}
                    </p>
                    <p {...stylex.props(styles.hint)}>{t("submit.voiceHint")}</p>
                    <Button onClick={() => { setRecorderMode("add"); setRecorderOpen(true); }}>
                      {t("recorder.recordAction")}
                    </Button>
                  </Show>
                </div>

                {/* 区块 3：节目建议（Show suggestion, optional） */}
                <div {...stylex.props(layouts.fullRow, styles.card, styles.cardBlock)}>
                  <label {...stylex.props(styles.label)}>{t("submit.suggestion")}</label>
                  <textarea
                    {...stylex.props(styles.input)}
                    rows={3}
                    maxLength={500}
                    placeholder={t("submit.suggestionPlaceholder")}
                    value={suggestion()}
                    onInput={(e) => setSuggestion(e.currentTarget.value)}
                  />
                  <p {...stylex.props(styles.hint)}>{t("submit.suggestionHint")}</p>
                </div>

                {/* 提交时撞重复 / 错误提示（区块外） */}
                <Show when={existing()}>
                  {/* 重复投稿：已生成节目（published）提示“只能生成一期”并指向节目；仅已有投稿提示已投过并指向投稿详情 */}
                  <p {...stylex.props(styles.error)}>
                    {existingEpisode()?.slug ? t("submit.existing") : t("importDialog.duplicate")}
                  </p>
                  <p {...stylex.props(styles.hint)}>
                    <Show when={existingEpisode()?.slug} fallback={
                      <A href={existingId() ? `/submission/${existingId()}` : "/me/submits"}>{t("submit.viewSubmissions")}</A>
                    }>
                      <A href={`/episode/${existingEpisode()!.slug}`}>{existingEpisode()!.title ?? t("submit.viewEpisode")}</A>
                    </Show>
                  </p>
                </Show>
                <Show when={error()}>
                  <p {...stylex.props(styles.error)}>{error()}</p>
                </Show>
                <Show when={!hasSample()}>
                  <p {...stylex.props(styles.error)}>{t("submit.error.needVoice")}</p>
                </Show>

                {/* 确认/取消（区块外） */}
                <div {...stylex.props(layouts.fullRow, styles.actions)}>
                  <Button onClick={confirmSubmit} disabled={submitting() || !hasSample() || !urlReady() || claimed()}>
                    {submitting() ? t("submit.submitting") : t("submit.confirm")}
                  </Button>
                  <A href="/"><Button appear="ghost">{t("common.cancel")}</Button></A>
                </div>
              </>
            }
          >
            {/* 独占状态：未检测到有效 URL */}
            <div {...stylex.props(layouts.fullRow, styles.card)}>
              <p {...stylex.props(styles.error)}>{t("submit.noValidUrl")}</p>
              <div {...stylex.props(styles.actions)}>
                <Button onClick={openImportDialog}>{t("submit.resubmit")}</Button>
              </div>
            </div>
          </Show>
        </Show>

        {/* 3. 提交成功：等待审核 */}
        <Show when={step() === "done"}>
          <div {...stylex.props(layouts.fullRow, styles.card)}>
            <p {...stylex.props(styles.success)}>{t("submit.success")}</p>
            <p {...stylex.props(styles.stepDesc)}>{t("submit.successDesc")}</p>
            <div {...stylex.props(styles.actions)}>
              <A href={submissionId() ? `${env.siteBaseUrl}/submission/${submissionId()}` : "/me/submits"}><Button>{t("submit.viewSubmissions")}</Button></A>
              <A href="/"><Button appear="ghost">{t("submit.backHome")}</Button></A>
            </div>
          </div>
        </Show>

        {/* 声音采样录制弹窗（新增/修改均从准备录制态打开；确认保存即上传） */}
        <VoiceSampleRecorderDialog
          open={recorderOpen()}
          mode={recorderMode()}
          defaultLanguage={zone()}
          hostName={callName().trim() || undefined}
          onClose={() => setRecorderOpen(false)}
          onCancel={() => setRecorderOpen(false)}
          onSaved={onSampleSaved}
        />
        </div>
      </div>
      </AuthGate>
  );
}
