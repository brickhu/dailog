import { A } from "@solidjs/router";
import { createSignal, createEffect, onMount, Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { AuthGate } from "../components/auth-gate";
import Recorder from "../components/recorder";
import { EpisodeCover } from "../components/episode-cover";

// 投稿流程（本质版，2026-08-13）：
//   input   输入态：分享链接（前端基本 http/https 校验）→ [继续]
//   confirm 确认投稿态：人设（可选）+ 声音采样（必填）→ [确认投稿]
//   done    提交成功 → 等待审核（/me/submits 查看状态）
// 服务端只做 URL 合法性 + 触达性检查，不做内容采集；制作由编辑本地 Agent 完成。
// 端点在 site 站内代理（/v1/*），会话经 cookie；未登录跳统一登录页

type Step = "input" | "confirm" | "done";

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

/** 前端基本校验：http/https + 有域名（后端仍会做完整合法性 + 触达性检查） */
function isUrlLike(input: string): boolean {
  try {
    const url = new URL(input);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}

export default function SubmitPage() {
  const { t, locale } = useI18n();
  const [step, setStep] = createSignal<Step>("input");
  const [url, setUrl] = createSignal("");
  const urlInvalid = () => url().trim().length > 0 && !isUrlLike(url().trim());
  const [existing, setExisting] = createSignal<string | null>(null);
  // 重复投稿时该投稿已生成的节目（published 才有；横条展示用）
  const [existingEpisode, setExistingEpisode] = createSignal<{ id: string; slug: string; title: string | null; coverUrl: string | null; number: number | null } | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  // 人设（可选）+ 采样（必填；已有采样自动填充可沿用）
  const [callName, setCallName] = createSignal("");   // callNameInEpisode：本次节目称呼（默认 displayName）
  const [suggestion, setSuggestion] = createSignal(""); // 节目建议（可选；仅供编辑部选题参考）
  const [hasVoiceSample, setHasVoiceSample] = createSignal(false);
  const [voiceLang, setVoiceLang] = createSignal("zh"); // 已有采样语种（展示用）
  const [voiceSampleId, setVoiceSampleId] = createSignal<string | null>(null); // 已有采样 id（投稿记录用）
  const [voiceBlob, setVoiceBlob] = createSignal<Blob | null>(null);
  const [submitting, setSubmitting] = createSignal(false);

  // 输入 URL 防抖预检：同链接已投稿/已生成节目 → 立即提示（无需等到确认投稿）
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  const checkUrlDuplicate = (value: string) => {
    clearTimeout(checkTimer);
    if (!isUrlLike(value)) {
      setExisting(null);
      setExistingEpisode(null);
      return;
    }
    checkTimer = setTimeout(async () => {
      try {
        const res = await fetch("/v1/submissions/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: value.trim() }),
        });
        const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (data?.existing) {
          setExisting(String((data as { status?: string })?.status ?? "submitted"));
          const ep = (data as { episode?: { id?: string; slug?: string; title?: string | null; coverUrl?: string | null; number?: number | null } | null })?.episode;
          setExistingEpisode(ep && ep.slug ? { id: ep.id ?? "", slug: ep.slug, title: ep.title ?? null, coverUrl: ep.coverUrl ?? null, number: ep.number ?? null } : null);
        } else {
          setExisting(null);
          setExistingEpisode(null);
        }
      } catch { /* 网络失败静默：提交时仍会兜底检测 */ }
    }, 500);
  };

  onMount(() => {
    // 导入弹框跳转预填：/import?url=…（弹框已做可达性检测）——
    // 预填后跳过 URL 输入那一步，直接进入第二步（确认投稿/配置）
    try {
      const params = new URLSearchParams(window.location.search);
      const prefill = params.get("url");
      if (prefill && prefill.startsWith("http")) {
        setUrl(prefill);
        setStep("confirm");
      }
    } catch { /* 静默 */ }
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
          const ep = (data as { episode?: { id?: string; slug?: string; title?: string | null; coverUrl?: string | null; number?: number | null } | null })?.episode;
          setExistingEpisode(ep && ep.slug ? { id: ep.id ?? "", slug: ep.slug, title: ep.title ?? null, coverUrl: ep.coverUrl ?? null, number: ep.number ?? null } : null);
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

        {/* 1. 输入态：分享链接（前端基本校验）→ [继续] */}
        <Show when={step() === "input"}>
          <div {...stylex.props(layouts.fullRow, styles.card)}>
            <p {...stylex.props(styles.stepTitle)}>{t("submit.step1")}</p>
            <p {...stylex.props(styles.stepDesc)}>{t("submit.step1Desc")}</p>
            <input
              {...stylex.props(styles.input)}
              type="url"
              placeholder={t("submit.urlPlaceholder")}
              value={url()}
              onInput={(e) => { setUrl(e.currentTarget.value); checkUrlDuplicate(e.currentTarget.value); }}
            />
            <Show when={urlInvalid()}>
              <p {...stylex.props(styles.error)}>{t("submit.error.invalid_url")}</p>
            </Show>
            <Show when={existing()}>
              <p {...stylex.props(styles.error)}>{t("submit.existing")}</p>
              {/* 已生成节目横条：点击进详情 */}
              <Show when={existingEpisode()}>
                <A href={`/episode/${existingEpisode()!.slug}`} {...stylex.props(styles.epBar)}>
                  <div style={{ width: "48px", height: "48px", "flex-shrink": "0" }}>
                    <EpisodeCover id={existingEpisode()!.id} coverUrl={existingEpisode()!.coverUrl} style={{ width: "48px", height: "48px" }} />
                  </div>
                  <div {...stylex.props(styles.epText)}>
                    <p {...stylex.props(styles.epTitle)}>{existingEpisode()!.title || t("common.unnamed")}</p>
                    <p {...stylex.props(styles.epMeta)}>
                      {t("submit.episodeNumber", { number: existingEpisode()!.number ?? "?" })} ·{" "}
                      <span {...stylex.props(styles.epListen)}>{t("submit.viewEpisode")}</span>
                    </p>
                  </div>
                </A>
              </Show>
              <p {...stylex.props(styles.hint)}>
                <A href="/me/submits">{t("submit.viewSubmissions")}</A>
              </p>
            </Show>
            <Show when={error()}>
              <p {...stylex.props(styles.error)}>{error()}</p>
            </Show>
            <div {...stylex.props(styles.actions)}>
              <Button onClick={() => setStep("confirm")} disabled={urlInvalid() || !url().trim() || existing() !== null}>
                {t("submit.import")}
              </Button>
              <A href="/"><Button appear="ghost">{t("submit.backHome")}</Button></A>
            </div>
          </div>
        </Show>

        {/* 2. 确认投稿态：人设编辑（可选）+ 声音采样（必填）→ [确认投稿] */}
        <Show when={step() === "confirm"}>
          <div {...stylex.props(layouts.fullRow, styles.card)}>
            <p {...stylex.props(styles.stepTitle)}>{t("submit.step2")}</p>
            <p {...stylex.props(styles.stepDesc)}>{t("submit.step2Desc")}</p>
            <label {...stylex.props(styles.label)}>{t("submit.callName")}</label>
            <input
              {...stylex.props(styles.input)}
              placeholder={t("submit.callNamePlaceholder")}
              value={callName()}
              onInput={(e) => setCallName(e.currentTarget.value)}
            />
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
            <Show when={hasVoiceSample() && !voiceBlob()}>
              <p {...stylex.props(styles.ok)}>{t("submit.voiceFilled")}</p>
              <p {...stylex.props(styles.hint)}>{t("submit.voiceLang", { lang: t(`lang.${voiceLang()}` as never) })}</p>
              {/* 自动填充的采样：试听（同源代理——<audio> 跨域不带 cookie 会 401） */}
              <audio controls src="/v1/me/voice-sample/audio" {...stylex.props(styles.audio)} />
              <p {...stylex.props(styles.hint)}>{t("submit.voiceReRecord")}</p>
            </Show>
            <Show when={!hasVoiceSample() || voiceBlob()}>
              <p {...stylex.props(styles.hint)}>{t("submit.voiceHint")}</p>
              <p {...stylex.props(styles.readingScript)}>{readingScript()}</p>
              <Recorder minSeconds={8} maxSeconds={30} onReady={(b) => setVoiceBlob(b)} />
            </Show>
            <Show when={error()}>
              <p {...stylex.props(styles.error)}>{error()}</p>
            </Show>
            <Show when={!hasSample()}>
              <p {...stylex.props(styles.error)}>{t("submit.error.needVoice")}</p>
            </Show>
            <div {...stylex.props(styles.actions)}>
              <Button onClick={confirmSubmit} disabled={submitting() || !hasSample()}>
                {submitting() ? t("submit.submitting") : t("submit.confirm")}
              </Button>
              <Button appear="ghost" onClick={() => { setStep("input"); setError(null); }}>{t("common.cancel")}</Button>
            </div>
          </div>
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
