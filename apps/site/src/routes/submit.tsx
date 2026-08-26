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
  const [params] = useSearchParams<{ id?: string; url?: string }>();
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
          const vs = (await voiceRes.json()) as { id?: string | null; language?: string; duration?: number } | null;
          setHasVoiceSample(true);
          if (vs?.language) setVoiceLang(vs.language);
          if (vs?.id) setVoiceSampleId(vs.id);
          if (vs?.duration) setSampleDuration(vs.duration);
        }
      } catch { /* 静默 */ }
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
  };

  /** 确认投稿：提交投稿（URL + 本次称呼 + 投稿使用的采样 id） */
  const confirmSubmit = async () => {
    setError(null);
    // 声音采样：无采样才拦截（按钮已禁用，双保险）
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
          callNameInEpisode: callName().trim().slice(0, 20) || undefined,
          suggestion: suggestion().trim().slice(0, 500) || undefined,
          voiceSampleId: voiceSampleId() || undefined,
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
      markSubmitted(url().trim()); // 已提交：剪贴板自动弹窗不再弹该 URL
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
                      audioUrl="/v1/me/voice-sample/audio"
                      onReRecord={() => {
                        setRecorderMode("edit");
                        setRecorderOpen(true);
                      }}
                    />
                  </Show>
                  <Show when={!hasVoiceSample()}>
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
              <A href={submissionId() ? `${env.siteBaseUrl}/submission/${submissionId()}` : "/me/submits"}><Button>{t("submit.viewSubmissions")}</Button></A>
              <A href="/"><Button appear="ghost">{t("submit.backHome")}</Button></A>
            </div>
          </div>
        </Show>

        {/* 声音采样录制弹窗（新增/修改均从准备录制态打开；确认保存即上传） */}
        <VoiceSampleRecorderDialog
          open={recorderOpen()}
          mode={recorderMode()}
          defaultLanguage={voiceLang()}
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
