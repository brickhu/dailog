import { A } from "@solidjs/router";
import { createSignal, createEffect, onMount, Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { AuthGate } from "../components/auth-gate";
import { isShareUrl } from "../components/import-dialog";
import { getUrlCheck } from "../lib/url-check";
import { openImportDialog } from "../components/import-dialog";
import Recorder from "../components/recorder";

// 投稿流程（本质版，2026-08-13）：
//   input   输入态：分享链接（前端基本 http/https 校验）→ [继续]
//   confirm 确认投稿态：人设（可选）+ 声音采样（必填）→ [确认投稿]
//   done    提交成功 → 等待审核（/me/submits 查看状态）
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
  readingScript: {
    fontSize: dimensions.fontSizeMd,
    paddingLeft: dimensions.spacing3,
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
  audio: {
    width: "100%",
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
  const { t, locale } = useI18n();
  // 初始步骤：?url=（导入弹框跳转，已做输入/检测）→ 首帧即第二步，不渲染 URL 输入
  const [step, setStep] = createSignal<Step>("confirm");
  const [url, setUrl] = createSignal("");
  // 当前检测结果 id（localStorage 的 json key；用于展示检测信息区块）
  const [checkId, setCheckId] = createSignal<string | null>(null);
  // URL 本地检测（防绕过弹框手动构造 ?url=）：非法/不可达 → 导入按钮置灰
  // 状态：checking（检测中）/ ok（可达）/ invalid（非平台链接）/ unreachable（不可达）/ empty（缺失）
  const [urlState, setUrlState] = createSignal<"checking" | "ok" | "invalid" | "unreachable" | "empty">("checking");
  const urlReady = () => urlState() === "ok";
  const [existing, setExisting] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  // 人设（可选）+ 采样（必填；已有采样自动填充可沿用）
  const [callName, setCallName] = createSignal("");   // callNameInEpisode：本次节目称呼（默认 displayName）
  const [suggestion, setSuggestion] = createSignal(""); // 节目建议（可选；仅供编辑部选题参考）
  const [hasVoiceSample, setHasVoiceSample] = createSignal(false);
  const [voiceLang, setVoiceLang] = createSignal("zh"); // 已有采样语种（展示用）
  const [voiceSampleId, setVoiceSampleId] = createSignal<string | null>(null); // 已有采样 id（投稿记录用）
  const [voiceBlob, setVoiceBlob] = createSignal<Blob | null>(null);
  const [submitting, setSubmitting] = createSignal(false);

  onMount(() => {
    // 优先 ?id=（导入弹框检测结果存 localStorage，key = 确定性投稿 ID）：
    // 直接取 URL 与检测结果，不重新检测、不暴露 URL 参数；无缓存/过期 → 置灰提示
    try {
      const params = new URLSearchParams(window.location.search);
      const id = params.get("id");
      if (id) {
        setCheckId(id);
        const check = getUrlCheck(id);
        if (check && check.valid && check.reachable) {
          setUrl(check.url);
          setUrlState("ok");
          return;
        }
        setUrlState("empty");
        return;
      }
      // 旧链接兜底：?url=… 本地再做合法性 + 可达性检测（手动构造无法绕过）
      const prefill = params.get("url");
      if (!prefill || !prefill.startsWith("http")) {
        setUrlState("empty");
        return;
      }
      setUrl(prefill);
      if (!isShareUrl(prefill)) {
        setUrlState("invalid");
        return;
      }
      setUrlState("checking");
      void fetch("/v1/submissions/reachable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: prefill }),
      })
        .then((r) => setUrlState(r.ok ? "ok" : "unreachable"))
        .catch(() => setUrlState("unreachable"));
    } catch {
      setUrlState("empty");
    }
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
      try {
        const voiceRes = await fetch("/v1/me/voice-sample");
        if (voiceRes.ok) {
          const vs = (await voiceRes.json()) as { id?: string | null; language?: string } | null;
          setHasVoiceSample(true);
          if (vs?.language) setVoiceLang(vs.language);
          if (vs?.id) setVoiceSampleId(vs.id);
        }
      } catch { /* 静默 */ }
    })();
  });

  /** 朗读文案：按界面语言插值称呼（文案语言=采样语言；脚本生成时按脚本语言改写称呼） */
  const readingScript = () =>
    t("submit.readingScript", { name: callName().trim() || t("submit.hostFallback") });

  /** 是否具备声音采样（已有采样或本次新录）——无采样时禁用提交按钮（接口同样严格校验） */
  const hasSample = () => hasVoiceSample() || voiceBlob() !== null;

  /** 确认投稿：上传声音采样（沿用/重录/换语言）+ 提交投稿（URL + 本次称呼 + 采样） */
  const confirmSubmit = async () => {
    setError(null);
    // 声音采样：已有采样可直接提交（重录则覆盖上传）；两者皆无才拦截（按钮已禁用，双保险）
    if (!voiceBlob() && !hasVoiceSample()) {
      setError(t("submit.error.needVoice"));
      return;
    }
    // 声音采样上传（有重录才上传；已有采样直接沿用）——language 按界面语言（文案语言=采样语言）
    let sampleId: string | null = voiceSampleId();
    if (voiceBlob()) {
      const form = new FormData();
      form.append("file", voiceBlob()!, "voice.webm");
      form.append("transcript", readingScript());
      form.append("language", locale() === "en" ? "en" : "zh");
      const voiceRes = await fetch("/v1/me/voice-sample", { method: "POST", body: form });
      if (!voiceRes.ok) {
        setError(t("submit.error.submitFailed", { error: `voice ${voiceRes.status}` }));
        return;
      }
      const vs = (await voiceRes.json().catch(() => null)) as { sampleId?: string } | null;
      sampleId = vs?.sampleId ?? null;
    }
    // 提交投稿（URL + 本次节目称呼 callNameInEpisode + 投稿使用的采样）
    setSubmitting(true);
    try {
      const res = await fetch("/v1/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: url().trim(),
          callNameInEpisode: callName().trim().slice(0, 20) || undefined,
          suggestion: suggestion().trim().slice(0, 500) || undefined,
          voiceSampleId: sampleId || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        if (data?.existing) {
          setExisting(String((data as { status?: string })?.status ?? "submitted"));
          return;
        }
        // 错误码映射友好文案；未知码显示后端 detail
        const code = String(data?.error ?? res.status);
        const mapped = t(`submit.error.${code}` as never);
        const detail = (data as { detail?: string | { message?: string } })?.detail;
        setError(detail && typeof detail === "string" ? detail : (mapped.startsWith("submit.error.") ? String(code) : mapped));
        return;
      }
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
        <h1 {...stylex.props(styles.title)}>{t("submit.title")}</h1>

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
                      <p {...stylex.props(styles.urlValue)}>{urlState() === "ok" ? "✓" : "—"}</p>
                      <p {...stylex.props(styles.urlLabel)}>{t("submit.checkReachable")}</p>
                      <p {...stylex.props(styles.urlValue)}>{urlState() === "ok" ? "✓" : "—"}</p>
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
                  <Show when={urlState() === "unreachable"}>
                    <p {...stylex.props(styles.error)}>{t("importDialog.unreachable")}</p>
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
                  <Show when={hasVoiceSample() && !voiceBlob()}>
                    <p {...stylex.props(styles.ok)}>{t("submit.voiceFilled")}</p>
                    <p {...stylex.props(styles.hint)}>{t("submit.voiceLang", { lang: t(`lang.${voiceLang()}` as never) })}</p>
                    <audio controls src="/v1/me/voice-sample/audio" {...stylex.props(styles.audio)} />
                    <p {...stylex.props(styles.hint)}>{t("submit.voiceReRecord")}</p>
                  </Show>
                  <Show when={!hasVoiceSample() || voiceBlob()}>
                    <p {...stylex.props(styles.hint)}>{t("submit.voiceHint")}</p>
                    <p {...stylex.props(styles.readingScript)}>{readingScript()}</p>
                    <Recorder minSeconds={8} maxSeconds={30} onReady={(b) => setVoiceBlob(b)} />
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
                  <p {...stylex.props(styles.error)}>{t("submit.existing")}</p>
                  <p {...stylex.props(styles.hint)}>
                    <A href="/me/submits">{t("submit.viewSubmissions")}</A>
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
                  <Button onClick={confirmSubmit} disabled={submitting() || !hasSample() || !urlReady()}>
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
              <A href="/me/submits"><Button>{t("submit.viewSubmissions")}</Button></A>
              <A href="/"><Button appear="ghost">{t("submit.backHome")}</Button></A>
            </div>
          </div>
        </Show>
        </div>
      </div>
      </AuthGate>
  );
}
