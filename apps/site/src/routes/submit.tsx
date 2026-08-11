import { createSignal, createEffect, onMount, Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { SiteNav } from "../components/site-nav";
import { AuthGate } from "../components/auth-gate";
import Recorder from "../components/recorder";

// 投稿流程（PRD §3/§5）：①导入（分享链接 → 采集预览）→ ②配置人设（信息 + 声音采样）→ ③提交投稿
// 端点在 site 站内代理（/v1/*），会话经 cookie；未登录跳统一登录页

type Step = 1 | 2 | 3 | "done";

interface ImportPreview {
  snapshotId: string;
  title: string;
  platform: string;
  count: number;
}

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
    border: `1px solid ${colors.ink}`,
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
    border: `1px solid ${colors.ink}`,
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
    borderLeft: `3px solid ${colors.brand}`,
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
});

export default function SubmitPage() {
  const { t } = useI18n();
  const [step, setStep] = createSignal<Step>(1);
  const [url, setUrl] = createSignal("");
  const [importing, setImporting] = createSignal(false);
  const [importError, setImportError] = createSignal<string | null>(null);
  const [preview, setPreview] = createSignal<ImportPreview | null>(null);
  const [existing, setExisting] = createSignal<string | null>(null);
  // 平台规则（importer /platforms 单一来源）：实时 URL 预检用
  const [platformRules, setPlatformRules] = createSignal<Array<{ id: string; label: string; sharePattern: string }>>([]);
  /** 当前输入匹配的平台（null = 未输入/未匹配） */
  const matchedPlatform = () => {
    const raw = url().trim();
    if (!raw) return null;
    return platformRules().find((r) => {
      try {
        return new RegExp(r.sharePattern).test(raw);
      } catch {
        return false;
      }
    }) ?? null;
  };
  const urlInvalid = () => url().trim().length > 0 && matchedPlatform() === null;
  const [callName, setCallName] = createSignal("");
  const [traits, setTraits] = createSignal("");
  // 已有采样（第二次投稿自动填充；拉取失败静默——视为无）
  const [hasVoiceSample, setHasVoiceSample] = createSignal(false);
  const [voiceBlob, setVoiceBlob] = createSignal<Blob | null>(null);
  const [submitting, setSubmitting] = createSignal(false);
  const [submitError, setSubmitError] = createSignal<string | null>(null);

  // 平台规则（预检用；失败静默——导入时后端仍会兜底校验）；登录守卫由 AuthGate 统一处理
  onMount(async () => {
    try {
      const rulesRes = await fetch("/v1/importer/platforms");
      if (rulesRes.ok) {
        const data = (await rulesRes.json()) as { platforms?: Array<{ id: string; label: string; sharePattern: string }> } | Array<{ id: string; label: string; sharePattern: string }> | null;
        const rules = Array.isArray(data) ? data : data?.platforms;
        if (Array.isArray(rules)) setPlatformRules(rules);
      }
    } catch {
      /* 规则拉取失败：由导入时的后端预检兜底 */
    }
  });

  // 进入步骤②时拉取已有人设/采样（此时 AuthGate 已放行、必然登录；避免未登录 401 噪音）
  createEffect(() => {
    if (step() !== 2) return;
    void (async () => {
      try {
        const profileRes = await fetch("/v1/me/profile");
        if (profileRes.ok) {
          const profile = (await profileRes.json()) as { persona?: { callName?: string | null; traits?: string | null } | null };
          if (profile.persona) {
            if (profile.persona.callName) setCallName(profile.persona.callName);
            if (profile.persona.traits) setTraits(profile.persona.traits);
          }
        }
      } catch { /* 静默 */ }
      try {
        const voiceRes = await fetch("/v1/me/voice-sample");
        if (voiceRes.ok) setHasVoiceSample(true);
      } catch { /* 静默 */ }
    })();
  });

  const doImport = async () => {
    const raw = url().trim();
    if (!raw) return;
    setImporting(true);
    setImportError(null);
    setExisting(null);
    try {
      const res = await fetch("/v1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: raw }),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setImportError(String((data as { detail?: { message?: string } })?.detail?.message ?? data?.error ?? res.status));
        return;
      }
      if (data?.existing) {
        // 已投过同一对话：提示并引导查看状态
        setExisting(String((data as { status?: string })?.status ?? "submitted"));
        return;
      }
      const dialogue = data?.dialogue as { title?: string; platform?: string; messages?: unknown[] } | null;
      setPreview({
        snapshotId: String(data?.snapshotId ?? ""),
        title: String(dialogue?.title ?? data?.title ?? "分享对话"),
        platform: String(dialogue?.platform ?? ""),
        count: Array.isArray(dialogue?.messages) ? dialogue.messages.length : 0,
      });
      setStep(2);
    } catch {
      setImportError(t("submit.importFailed", { error: "network" }));
    } finally {
      setImporting(false);
    }
  };

  /** 步骤②完成：保存人设（可选字段）+ 上传声音采样（必填）→ 步骤③ */
  const savePersona = async () => {
    setImportError(null);
    // 声音采样：已有采样可直接提交（重录则覆盖上传）；两者皆无才拦截
    if (!voiceBlob() && !hasVoiceSample()) {
      setImportError(t("submit.error.needVoice"));
      return;
    }
    // 人设信息（称呼/风格）——有填写才保存
    const persona: Record<string, string> = {};
    if (callName().trim()) persona.callName = callName().trim().slice(0, 20);
    if (traits().trim()) persona.traits = traits().trim().slice(0, 100);
    if (Object.keys(persona).length > 0) {
      await fetch("/v1/me/persona", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona }),
      });
    }
    // 声音采样上传（有重录才上传；已有采样直接沿用）
    if (voiceBlob()) {
      const form = new FormData();
      form.append("file", voiceBlob()!, "voice.webm");
      form.append("transcript", t("submit.readingScript"));
      form.append("language", "zh");
      const voiceRes = await fetch("/v1/me/voice-sample", { method: "POST", body: form });
      if (!voiceRes.ok) {
        setImportError(t("submit.error.submitFailed", { error: `voice ${voiceRes.status}` }));
        return;
      }
    }
    setStep(3);
  };

  const doSubmit = async () => {
    const p = preview();
    if (!p) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/v1/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshotId: p.snapshotId, title: p.title }),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        if (data?.existing) {
          setExisting(String(data.status ?? "submitted"));
          setStep(1);
          return;
        }
        setSubmitError(String((data as { detail?: string })?.detail ?? data?.error ?? res.status));
        return;
      }
      setStep("done");
    } catch {
      setSubmitError(t("submit.error.submitFailed", { error: "network" }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div {...stylex.props(styles.page)}>
      <Title>{t("submit.title")} · dailog</Title>
      <SiteNav />
      <AuthGate redirect="/submit">
        <div {...stylex.props(styles.content)}>
        <h1 {...stylex.props(styles.title)}>{t("submit.title")}</h1>

        <Show when={step() === 1}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.stepTitle)}>{t("submit.step1")}</p>
            <p {...stylex.props(styles.stepDesc)}>{t("submit.step1Desc")}</p>
            <input
              {...stylex.props(styles.input)}
              type="url"
              placeholder={t("submit.urlPlaceholder")}
              value={url()}
              onInput={(e) => setUrl(e.currentTarget.value)}
            />
            <Show when={matchedPlatform()}>
              <p {...stylex.props(styles.hint)}>{t("submit.urlRecognized", { label: matchedPlatform()!.label })}</p>
            </Show>
            <Show when={!matchedPlatform() && !urlInvalid() && url().trim().length === 0}>
              <p {...stylex.props(styles.hint)}>{t("submit.urlHint")}</p>
            </Show>
            <Show when={urlInvalid()}>
              <p {...stylex.props(styles.error)}>{t("submit.urlUnsupported")}</p>
            </Show>
            <Show when={existing()}>
              <p {...stylex.props(styles.error)}>
                {t("submit.existing", { status: t(`status.${existing()}` as never) })} ·
                <a href="/me/submits"> {t("submit.viewSubmissions")}</a>
              </p>
            </Show>
            <Show when={importError()}>
              <p {...stylex.props(styles.error)}>{importError()}</p>
            </Show>
            <div {...stylex.props(styles.actions)}>
              <Button onClick={doImport} disabled={importing() || urlInvalid() || !url().trim()}>
                {importing() ? t("submit.importing") : t("submit.import")}
              </Button>
            </div>
          </div>
        </Show>

        <Show when={step() === 2 && preview()}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.stepTitle)}>{t("submit.step2")}</p>
            <p {...stylex.props(styles.stepDesc)}>
              {t("submit.previewTitle", { title: preview()!.title })} ·{" "}
              {t("submit.previewMessages", { count: preview()!.count, platform: preview()!.platform || "-" })}
            </p>
            <label {...stylex.props(styles.label)}>{t("submit.callName")}</label>
            <input
              {...stylex.props(styles.input)}
              placeholder={t("submit.callNamePlaceholder")}
              value={callName()}
              onInput={(e) => setCallName(e.currentTarget.value)}
            />
            <label {...stylex.props(styles.label)}>{t("submit.traits")}</label>
            <input
              {...stylex.props(styles.input)}
              placeholder={t("submit.traitsPlaceholder")}
              value={traits()}
              onInput={(e) => setTraits(e.currentTarget.value)}
            />
            <Show when={hasVoiceSample() && !voiceBlob()}>
              <p {...stylex.props(styles.ok)}>{t("submit.voiceFilled")}</p>
              {/* 自动填充的采样：试听（同源代理——<audio> 跨域不带 cookie 会 401） */}
              <audio controls src="/v1/me/voice-sample/audio" {...stylex.props(styles.audio)} />
              <p {...stylex.props(styles.hint)}>{t("submit.voiceReRecord")}</p>
            </Show>
            <Show when={!hasVoiceSample() || voiceBlob()}>
              <p {...stylex.props(styles.hint)}>{t("submit.voiceHint")}</p>
              <p {...stylex.props(styles.readingScript)}>{t("submit.readingScript")}</p>
              <Recorder minSeconds={8} maxSeconds={30} onReady={(b) => setVoiceBlob(b)} />
            </Show>
            <Show when={importError()}>
              <p {...stylex.props(styles.error)}>{importError()}</p>
            </Show>
            <div {...stylex.props(styles.actions)}>
              <Button onClick={savePersona} disabled={!voiceBlob() && !hasVoiceSample()}>
                {t("submit.step3")} →
              </Button>
              <Button appear="ghost" onClick={() => setStep(1)}>{t("common.back")}</Button>
            </div>
          </div>
        </Show>

        <Show when={step() === 3 && preview()}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.stepTitle)}>{t("submit.step3")}</p>
            <p {...stylex.props(styles.stepDesc)}>{t("submit.step3Desc")}</p>
            <p {...stylex.props(styles.hint)}>{t("submit.previewTitle", { title: preview()!.title })}</p>
            <Show when={submitError()}>
              <p {...stylex.props(styles.error)}>{submitError()}</p>
            </Show>
            <div {...stylex.props(styles.actions)}>
              <Button onClick={doSubmit} disabled={submitting()}>
                {submitting() ? t("submit.submitting") : t("submit.confirm")}
              </Button>
              <Button appear="ghost" onClick={() => setStep(2)}>{t("common.back")}</Button>
            </div>
          </div>
        </Show>

        <Show when={step() === "done"}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.success)}>{t("submit.success")}</p>
            <p {...stylex.props(styles.stepDesc)}>{t("submit.successDesc")}</p>
            <div {...stylex.props(styles.actions)}>
              <a href="/me/submits"><Button>{t("submit.viewSubmissions")}</Button></a>
              <Button appear="ghost" onClick={() => { setStep(1); setUrl(""); setPreview(null); }}>
                {t("submit.submitAnother")}
              </Button>
            </div>
          </div>
        </Show>
        </div>
      </AuthGate>
    </div>
  );
}
