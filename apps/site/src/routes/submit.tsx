import { createSignal, createEffect, onMount, Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { SiteNav } from "../components/site-nav";
import { AuthGate } from "../components/auth-gate";
import Recorder from "../components/recorder";

// 投稿流程（PRD §3/§5）四态：
//   input     输入态：分享链接 + URL 合法性预检 → [导入对话]
//   confirm   确认投稿态：对话基本信息 + 人设编辑（+声音采样）→ [确认投稿]
//   error     导入失败态：importer 明确拦截/无法获取 → 原因 + [取消]
//   published 已有节目态：同 URL 已生成节目 → 节目信息 + 二创提示 + [取消]
//   done      提交成功
// 端点在 site 站内代理（/v1/*），会话经 cookie；未登录跳统一登录页

type Step = "input" | "confirm" | "error" | "published" | "done";

interface ImportPreview {
  snapshotId: string;
  title: string;
  platform: string;
  count: number;
}

/** 节目预览态：同 URL 已生成过节目（任意用户）——不进入确认导入 */
interface PublishedPreview {
  episode: {
    id: string;
    title: string | null;
    durationSeconds: number | null;
    hostName: string | null;
    guestName: string | null;
  };
  sourceUrl: string;
}

/** 内容溯源提示：新对话疑似衍生自库内已收录对话 */
interface SuspectedSource {
  snapshotId: string;
  sourceTitle: string | null;
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
  // 节目预览态（同 URL 已生成节目）
  previewCard: {
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.brandStrong}`,
    backgroundColor: colors.surface,
    padding: dimensions.spacing5,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
  },
  previewTitle: {
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
  },
  previewBlock: {
    display: "block",
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    padding: dimensions.spacing4,
    textDecoration: "none",
    color: "inherit",
    ":hover": { borderColor: colors.brandStrong },
  },
  previewRow: {
    fontSize: dimensions.fontSizeSm,
    color: colors.foreground,
    margin: 0,
    paddingBottom: dimensions.spacing1,
  },
  previewLabel: {
    color: colors.neutral,
  },
  previewHint: {
    fontSize: dimensions.fontSizeSm,
    color: colors.neutral,
    margin: 0,
  },
  previewLink: {
    color: colors.brandStrong,
    textDecoration: "underline",
    cursor: "pointer",
  },
  traceHint: {
    fontSize: dimensions.fontSizeSm,
    color: colors.neutral,
    margin: 0,
    borderLeft: `3px solid ${colors.brand}`,
    paddingLeft: dimensions.spacing3,
  },
  pasteInput: {
    width: "100%",
    minHeight: "120px",
    boxSizing: "border-box",
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusSm,
    border: `1px solid ${colors.ink}`,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: dimensions.fontSizeSm,
    fontFamily: "inherit",
    resize: "vertical",
  },
});

export default function SubmitPage() {
  const { t } = useI18n();
  const [step, setStep] = createSignal<Step>("input");
  const [url, setUrl] = createSignal("");
  const [importing, setImporting] = createSignal(false);
  const [importError, setImportError] = createSignal<string | null>(null);
  /** 导入失败态：importer 明确拦截/无法获取的具体原因 */
  const [errorReason, setErrorReason] = createSignal<string | null>(null);
  /** 手动粘贴兜底：分享页被 CF 拦截时用户复制分享页源码（view-source/outerHTML）粘贴 */
  const [pasteText, setPasteText] = createSignal("");
  const [pasteParsing, setPasteParsing] = createSignal(false);
  const [preview, setPreview] = createSignal<ImportPreview | null>(null);
  const [existing, setExisting] = createSignal<string | null>(null);
  const [publishedPreview, setPublishedPreview] = createSignal<PublishedPreview | null>(null);
  const [suspectedSource, setSuspectedSource] = createSignal<SuspectedSource | null>(null);
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
    // 剪贴板弹层跳转预填：/submit?url=…
    try {
      const params = new URLSearchParams(window.location.search);
      const prefill = params.get("url");
      if (prefill && prefill.startsWith("http")) setUrl(prefill);
    } catch { /* 静默 */ }
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

  // 进入确认投稿态时拉取已有人设/采样（此时 AuthGate 已放行、必然登录；避免未登录 401 噪音）
  createEffect(() => {
    if (step() !== "confirm") return;
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

  /** 手动粘贴兜底：用户复制分享页源码（view-source/outerHTML）→ importer 按平台解析（结构完整无需校对） */
  const doPasteImport = async () => {
    const text = pasteText().trim();
    if (!text) return;
    const sourceUrl = url().trim();
    if (!sourceUrl) {
      setErrorReason(t("submit.importFailed", { error: "url" }));
      return;
    }
    setPasteParsing(true);
    setErrorReason(null);
    try {
      const res = await fetch("/v1/import-paste/html", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ html: text, url: sourceUrl }),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        const code = String(data?.error ?? res.status);
        const detail = (data as { detail?: { message?: string } })?.detail?.message;
        const mapped = t(`submit.error.${code}` as never);
        setErrorReason(detail ?? (mapped.startsWith("submit.error.") ? code : mapped));
        return;
      }
      const dialogue = data?.dialogue as { title?: string; platform?: string; messages?: unknown[] } | null;
      setPreview({
        snapshotId: String(data?.snapshotId ?? ""),
        title: String(dialogue?.title ?? "分享对话"),
        platform: String(dialogue?.platform ?? "paste"),
        count: Array.isArray(dialogue?.messages) ? dialogue.messages.length : 0,
      });
      const src = (data as { suspectedSource?: { snapshotId?: string; sourceTitle?: string | null } | null }).suspectedSource;
      if (src?.snapshotId) {
        setSuspectedSource({ snapshotId: src.snapshotId, sourceTitle: src.sourceTitle ?? null });
      }
      setStep("confirm");
    } catch {
      setErrorReason(t("submit.importFailed", { error: "network" }));
    } finally {
      setPasteParsing(false);
    }
  };

  /** 返回输入态：清空全部导入/预览状态 */
  const backToInput = () => {
    setStep("input");
    setUrl("");
    setPreview(null);
    setPublishedPreview(null);
    setSuspectedSource(null);
    setExisting(null);
    setErrorReason(null);
    setImportError(null);
  };

  const doImport = async () => {
    const raw = url().trim();
    if (!raw) return;
    setImporting(true);
    setImportError(null);
    setExisting(null);
    setPublishedPreview(null);
    setSuspectedSource(null);
    try {
      const res = await fetch("/v1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: raw }),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        // 导入失败态：importer 明确拦截/无法获取 → 具体原因（错误码映射友好文案，未知码透传）
        const code = String(data?.error ?? res.status);
        const detail = (data as { detail?: { message?: string } })?.detail?.message;
        const mapped = t(`submit.error.${code}` as never);
        // t() 缺失 key 时返回 key 本身（submit.error.xxx）——回退显示原始码
        setErrorReason(detail ?? (mapped.startsWith("submit.error.") ? code : mapped));
        setStep("error");
        return;
      }
      if (data?.alreadyPublished) {
        // 导入已有节目态：同 URL 已生成过节目 → 节目信息 + 二创提示
        const ep = (data as { episode?: { id?: string; title?: string | null; durationSeconds?: number | null; hostName?: string | null; guestName?: string | null } }).episode;
        if (ep?.id) {
          setPublishedPreview({
            episode: {
              id: ep.id,
              title: ep.title ?? null,
              durationSeconds: ep.durationSeconds ?? null,
              hostName: ep.hostName ?? null,
              guestName: ep.guestName ?? null,
            },
            sourceUrl: raw,
          });
          setStep("published");
          return;
        }
      }
      if (data?.existing) {
        // 自己已投过同一对话：输入态提示并引导查看状态
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
      // 内容溯源提示：疑似衍生自库内已收录对话（不阻断，仅提示）
      const src = (data as { suspectedSource?: { snapshotId?: string; sourceTitle?: string | null } | null }).suspectedSource;
      if (src?.snapshotId) {
        setSuspectedSource({ snapshotId: src.snapshotId, sourceTitle: src.sourceTitle ?? null });
      }
      setStep("confirm");
    } catch {
      setErrorReason(t("submit.importFailed", { error: "network" }));
      setStep("error");
    } finally {
      setImporting(false);
    }
  };

  /** 确认投稿：保存人设（可选字段）+ 上传声音采样（必填）→ 提交投稿 */
  const confirmSubmit = async () => {
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
      const personaRes = await fetch("/v1/me/persona", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona }),
      });
      if (!personaRes.ok) {
        setImportError(t("submit.error.submitFailed", { error: `persona ${personaRes.status}` }));
        return;
      }
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
    // 提交投稿
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
          backToInput();
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

        {/* 1. 输入态：分享链接 + URL 合法性预检 + [导入对话] / [返回首页] */}
        <Show when={step() === "input"}>
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
              <a href="/"><Button appear="ghost">{t("submit.backHome")}</Button></a>
            </div>
          </div>
        </Show>

        {/* 2. 确认投稿态：对话基本信息 + 人设编辑 + [确认投稿] / [取消] */}
        <Show when={step() === "confirm" && preview()}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.stepTitle)}>{t("submit.confirm")}</p>
            <p {...stylex.props(styles.stepDesc)}>
              {t("submit.previewTitle", { title: preview()!.title })} ·{" "}
              {t("submit.previewMessages", { count: preview()!.count, platform: preview()!.platform || "-" })}
            </p>
            <Show when={suspectedSource()}>
              <p {...stylex.props(styles.traceHint)}>
                {t("submit.suspectedSource", { title: suspectedSource()!.sourceTitle || t("common.unnamed") })}
              </p>
            </Show>
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
            <Show when={submitError()}>
              <p {...stylex.props(styles.error)}>{submitError()}</p>
            </Show>
            <div {...stylex.props(styles.actions)}>
              {/* 人设信息缺失（称呼/风格均未填）→ 禁用 */}
              <Button onClick={confirmSubmit} disabled={submitting() || (!callName().trim() && !traits().trim())}>
                {submitting() ? t("submit.submitting") : t("submit.confirm")}
              </Button>
              <Button appear="ghost" onClick={backToInput}>{t("common.cancel")}</Button>
            </div>
          </div>
        </Show>

        {/* 3. 导入失败态：importer 明确拦截/无法获取 → 原因 + 手动粘贴兜底 + [取消] */}
        <Show when={step() === "error"}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.stepTitle)}>{t("submit.failedTitle")}</p>
            <p {...stylex.props(styles.stepDesc)}>{errorReason()}</p>
            {/* 手动粘贴兜底（免扩展）：分享页被 CF 拦截时复制分享页源码粘贴（结构完整，按平台解析） */}
            <p {...stylex.props(styles.traceHint)}>{t("submit.pasteFallbackTitle")}</p>
            <p {...stylex.props(styles.hint)}>{t("submit.pasteFallbackModes")}</p>
            <textarea
              {...stylex.props(styles.pasteInput)}
              placeholder={t("submit.pasteHint")}
              value={pasteText()}
              onInput={(e) => setPasteText(e.currentTarget.value)}
            />
            <Show when={pasteParsing()}>
              <p {...stylex.props(styles.hint)}>{t("submit.importing")}</p>
            </Show>
            <div {...stylex.props(styles.actions)}>
              <Button onClick={doPasteImport} disabled={pasteParsing() || !pasteText().trim()}>
                {t("submit.pasteParse")}
              </Button>
              <Button appear="ghost" onClick={backToInput}>{t("common.cancel")}</Button>
            </div>
          </div>
        </Show>

        {/* 4. 导入已有节目态：节目信息 + 二创提示 + [取消] */}
        <Show when={step() === "published" && publishedPreview()}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.previewTitle)}>{t("submit.alreadyPublished")}</p>
            {/* 节目信息块：可点击进入节目页 */}
            <a href={`/episode/${publishedPreview()!.episode.id}`} {...stylex.props(styles.previewBlock)}>
              <p {...stylex.props(styles.previewRow)}>
                <span {...stylex.props(styles.previewLabel)}>{t("submit.epTitle")}：</span>
                {publishedPreview()!.episode.title || t("common.unnamed")}
              </p>
              <p {...stylex.props(styles.previewRow)}>
                <span {...stylex.props(styles.previewLabel)}>{t("submit.epHost")}：</span>
                {publishedPreview()!.episode.hostName || "—"}
              </p>
              <p {...stylex.props(styles.previewRow)}>
                <span {...stylex.props(styles.previewLabel)}>{t("submit.epGuest")}：</span>
                {publishedPreview()!.episode.guestName || "—"}
              </p>
              <p {...stylex.props(styles.previewRow)}>
                <span {...stylex.props(styles.previewLabel)}>{t("submit.epDuration")}：</span>
                {publishedPreview()!.episode.durationSeconds
                  ? `${Math.round(publishedPreview()!.episode.durationSeconds! / 60)}m`
                  : "—"}
              </p>
            </a>
            <p {...stylex.props(styles.previewHint)}>
              {t("submit.continueOriginal")}
              <a href={publishedPreview()!.sourceUrl} target="_blank" rel="noopener" {...stylex.props(styles.previewLink)}>
                {t("submit.openOriginal")}
              </a>
              {t("submit.continueOriginalTail")}
            </p>
            <div {...stylex.props(styles.actions)}>
              <Button appear="ghost" onClick={backToInput}>{t("common.cancel")}</Button>
            </div>
          </div>
        </Show>

        <Show when={step() === "done"}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.success)}>{t("submit.success")}</p>
            <p {...stylex.props(styles.stepDesc)}>{t("submit.successDesc")}</p>
            <div {...stylex.props(styles.actions)}>
              <a href="/me/submits"><Button>{t("submit.viewSubmissions")}</Button></a>
              <a href="/"><Button appear="ghost">{t("submit.backHome")}</Button></a>
            </div>
          </div>
        </Show>
        </div>
      </AuthGate>
    </div>
  );
}
