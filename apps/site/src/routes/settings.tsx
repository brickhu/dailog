import { createSignal, createEffect, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button, TextInput, Spinner } from "@dailogues/ui";
import Recorder from "../components/recorder";
import { useI18n } from "@dailogues/i18n";

// 账号中心（dailog.fm/account）：
//   区块一「账号管理」——邮箱/GitHub 绑定/昵称/修改密码（better-auth 官方端点，站内代理）
//   区块二「主持人资料」——displayName/bio/gender/profession/age/nationality/socialLinks（PATCH /api/me/profile）
// 划分：账号 = user 表（登录凭据 + @slug=name），主持人档案 = profiles 表（公开身份）

interface ProfileData {
  email: string | null;
  nickname: string | null;
  emailVerified: boolean;
  image: string | null;
  displayName: string | null;
  bio: string | null;
  gender: string | null;
  profession: string | null;
  age: string | null;
  nationality: string | null;
  socialLinks: Record<string, string> | null;
  channelActivatedAt: string | null;
}

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing8,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing2,
  },
  subtitle: {
    color: colors.neutral,
    marginBottom: dimensions.spacing6,
  },
  section: {
    marginBottom: dimensions.spacing8,
  },
  sectionTitle: {
    fontSize: dimensions.fontSizeLg,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing3,
  },
  card: {
    padding: dimensions.spacing6,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    marginBottom: dimensions.spacing4,
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: dimensions.spacing4,
  },
  rowLabel: {
    fontWeight: dimensions.fontWeightMedium,
  },
  rowValue: {
    color: colors.neutral,
  },
  badge: {
    fontSize: dimensions.fontSizeSm,
    padding: `${dimensions.spacing1} ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusFull,
    backgroundColor: "#dcfce7",
    color: "#166534",
  },
  field: {
    marginBottom: dimensions.spacing3,
  },
  audio: {
    width: "100%",
    marginBottom: dimensions.spacing3,
  },
  readingScript: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    lineHeight: 1.7,
    paddingLeft: dimensions.spacing3,
    marginBottom: dimensions.spacing3,
  },
  hint: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing2,
  },
  error: {
    fontSize: dimensions.fontSizeSm,
    color: "#b91c1c",
    marginTop: dimensions.spacing2,
  },
  success: {
    fontSize: dimensions.fontSizeSm,
    color: "#166534",
    marginTop: dimensions.spacing2,
  },
  loading: {
    textAlign: "center" as const,
    padding: dimensions.spacing12,
    color: colors.neutral,
  },
});

export default function AccountPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [session, setSession] = createSignal<{ id: string } | null>(null);
  const [checked, setChecked] = createSignal(false);
  const [profile, setProfile] = createSignal<ProfileData | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);

  // 登录守卫：未登录跳统一登录页（redirect 回 /account）
  onMount(async () => {
    const res = await fetch("/v1/auth/get-session");
    if (res.ok) {
      const data = (await res.json()) as { user?: { id: string } | null } | null;
      setSession(data?.user ?? null);
    }
    setChecked(true);
  });
  createEffect(() => {
    if (checked() && session() === null) {
      navigate(`/login?redirect=${encodeURIComponent("/settings")}`);
    }
  });

  // 加载档案
  createEffect(() => {
    if (!session()) return;
    fetch("/v1/me/profile")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ProfileData;
      })
      .then(setProfile)
      .catch(() => setLoadError(t("account.loadFailed")));
  });

  return (
    <div {...stylex.props(layouts.page)}>
      <div {...stylex.props(layouts.containerSm)}>
        <Title>{t("account.title")} · dailog</Title>
        <div {...stylex.props(layouts.fullRow)}>
        <Show when={session()}>
          <div {...stylex.props(styles.title)}>{t("account.title")}</div>
          <div {...stylex.props(styles.subtitle)}>{t("account.subtitle")}</div>

          <Show when={profile()} fallback={<div {...stylex.props(styles.loading)}><Spinner /> {t("common.loading")}</div>}>
            <AccountSection profile={profile()!} loadError={loadError()} />
          </Show>
        </Show>
        </div>
      </div>
    </div>
  );
}

function AccountSection(props: { profile: ProfileData; loadError: string | null }) {
  const { t } = useI18n();
  return (
    <section {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionTitle)}>{t("account.section")}</div>
      <AccountBlock profile={props.profile} loadError={props.loadError} />
      <HostProfileBlock profile={props.profile} />
    </section>
  );
}

/** 主持人资料：昵称/简介/性别/职业/年龄/国籍/社交链接（脚本生成注入主持人画像） */
function HostProfileBlock(props: { profile: ProfileData }) {
  const { t } = useI18n();
  const p = () => props.profile;
  const [displayName, setDisplayName] = createSignal(p().displayName ?? "");
  const [bio, setBio] = createSignal(p().bio ?? "");
  const [gender, setGender] = createSignal(p().gender ?? "");
  const [profession, setProfession] = createSignal(p().profession ?? "");
  const [age, setAge] = createSignal(p().age ?? "");
  const [nationality, setNationality] = createSignal(p().nationality ?? "");
  const [socialLinks, setSocialLinks] = createSignal(JSON.stringify(p().socialLinks ?? {}, null, 2));
  const [msg, setMsg] = createSignal<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setMsg(null);
    let links: Record<string, string> | null = null;
    const raw = socialLinks().trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
        links = parsed as Record<string, string>;
      } catch {
        setMsg({ ok: false, text: t("account.saveFailed") + "（socialLinks JSON 格式不正确）" });
        return;
      }
    }
    const res = await fetch("/v1/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: displayName().trim() || undefined,
        bio: bio().trim() || undefined,
        gender: gender().trim() || undefined,
        profession: profession().trim() || undefined,
        age: age().trim() || undefined,
        nationality: nationality().trim() || undefined,
        socialLinks: links,
      }),
    });
    setMsg(res.ok ? { ok: true, text: t("account.hostProfileSaved") } : { ok: false, text: t("account.saveFailed") });
  };

  return (
    <div {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.rowLabel)}>{t("account.hostProfile")}</span>
      </div>
      <div {...stylex.props(styles.rowValue)}>{t("account.hostProfileDesc")}</div>
      <div {...stylex.props(styles.field)}>
        <TextInput label={t("account.displayName")} value={displayName()} onChange={(v) => setDisplayName(v)} maxLength={30} />
        <TextInput label={t("account.bio")} value={bio()} onChange={(v) => setBio(v)} maxLength={200} />
        <TextInput label={t("account.gender")} value={gender()} onChange={(v) => setGender(v)} maxLength={10} />
        <TextInput label={t("account.profession")} value={profession()} onChange={(v) => setProfession(v)} maxLength={30} />
        <TextInput label={t("account.age")} value={age()} onChange={(v) => setAge(v)} maxLength={10} />
        <TextInput label={t("account.nationality")} value={nationality()} onChange={(v) => setNationality(v)} maxLength={20} />
        <TextInput label={t("account.socialLinks")} value={socialLinks()} onChange={(v) => setSocialLinks(v)} />
      </div>
      <Button onClick={save}>{t("account.saveHostProfile")}</Button>
      <Show when={msg()}>
        <div {...stylex.props(msg()!.ok ? styles.success : styles.error)}>{msg()!.text}</div>
      </Show>
    </div>
  );
}

/** 账号管理：邮箱 / GitHub 绑定 / 昵称 / 修改密码 */
function AccountBlock(props: { profile: ProfileData; loadError: string | null }) {
  const { t, locale } = useI18n();
  const p = () => props.profile;
  const [nickname, setNickname] = createSignal(p().nickname ?? "");
  const [nameMsg, setNameMsg] = createSignal<{ ok: boolean; text: string } | null>(null);

  const [curPw, setCurPw] = createSignal("");
  const [newPw, setNewPw] = createSignal("");
  const [confirmPw, setConfirmPw] = createSignal("");
  const [pwMsg, setPwMsg] = createSignal<{ ok: boolean; text: string } | null>(null);
  const [pwBusy, setPwBusy] = createSignal(false);

  const saveName = async () => {
    setNameMsg(null);
    const trimmed = nickname().trim();
    if (!trimmed) return setNameMsg({ ok: false, text: t("account.nicknameRequired") });
    const res = await fetch("/v1/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: trimmed }),
    });
    setNameMsg(res.ok ? { ok: true, text: t("account.saved") } : { ok: false, text: t("account.saveFailed") });
  };

  const changePassword = async () => {
    setPwMsg(null);
    if (newPw().length < 8) return setPwMsg({ ok: false, text: t("account.passwordMin") });
    if (newPw() !== confirmPw()) return setPwMsg({ ok: false, text: t("account.passwordMismatch") });
    setPwBusy(true);
    try {
      const res = await fetch("/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: curPw(), newPassword: newPw() }),
      });
      if (res.ok) {
        setPwMsg({ ok: true, text: t("account.passwordUpdated") });
        setCurPw(""); setNewPw(""); setConfirmPw("");
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setPwMsg({ ok: false, text: body?.message ?? t("account.passwordFailed") });
      }
    } finally {
      setPwBusy(false);
    }
  };

  // ---- 声音采样（生成节目中"你"的声音；可重录覆盖/换语言新增） ----
  const [hasSample, setHasSample] = createSignal<boolean | null>(null);
  const [voiceLang, setVoiceLang] = createSignal("zh");
  const [sampleBusy, setSampleBusy] = createSignal(false);
  const [sampleMsg, setSampleMsg] = createSignal<{ ok: boolean; text: string } | null>(null);
  onMount(async () => {
    try {
      const res = await fetch("/v1/me/voice-sample");
      if (res.ok) {
        const vs = (await res.json()) as { language?: string } | null;
        setHasSample(true);
        if (vs?.language) setVoiceLang(vs.language);
      } else {
        setHasSample(false);
      }
    } catch {
      setHasSample(false);
    }
  });
  // 朗读文案：插值主持人昵称（profile 人设称呼，无则账号昵称兜底）；语言跟随界面语言
  const sampleScript = () =>
    t("submit.readingScript", { name: p().displayName?.trim() || p().nickname?.trim() || t("submit.hostFallback") });
  const uploadSample = async (blob: Blob) => {
    setSampleBusy(true);
    setSampleMsg(null);
    try {
      const form = new FormData();
      form.append("file", blob, "voice.webm");
      form.append("transcript", sampleScript());
      form.append("language", locale() === "en" ? "en" : "zh");
      const res = await fetch("/v1/me/voice-sample", { method: "POST", body: form });
      if (!res.ok) {
        setSampleMsg({ ok: false, text: t("account.voiceSampleFailed") });
        return;
      }
      setHasSample(true);
      setVoiceLang(locale() === "en" ? "en" : "zh");
      setSampleMsg({ ok: true, text: t("account.voiceSampleDone") });
    } catch {
      setSampleMsg({ ok: false, text: t("account.voiceSampleFailed") });
    } finally {
      setSampleBusy(false);
    }
  };

  return (
    <>
      {props.loadError && <div {...stylex.props(styles.error)}>{props.loadError}</div>}
      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.rowLabel)}>{t("account.email")}</span>
          <span {...stylex.props(styles.rowValue)}>
            {p().email}
            <Show when={p().emailVerified} fallback={<span style={{ "margin-left": "8px" }}>{t("account.unverified")}</span>}>
              <span {...stylex.props(styles.badge)} style={{ "margin-left": "8px" }}>{t("account.verified")}</span>
            </Show>
          </span>
        </div>
      </div>

      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.rowLabel)}>{t("account.nickname")}</span>
        </div>
        <div {...stylex.props(styles.field)}>
          <TextInput label={t("account.nickname")} value={nickname()} onChange={(v) => setNickname(v)} placeholder={t("account.nicknamePlaceholder")} maxLength={30} />
        </div>
        <Button onClick={saveName}>{t("account.saveNickname")}</Button>
        <Show when={nameMsg()}>
          <div {...stylex.props(nameMsg()!.ok ? styles.success : styles.error)}>{nameMsg()!.text}</div>
        </Show>
      </div>

      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.rowLabel)}>{t("account.voiceSample")}</span>
          <Show when={hasSample() !== null} fallback={<Spinner />}>
            <Show when={hasSample()} fallback={<span {...stylex.props(styles.rowValue)}>{t("account.voiceSampleNone")}</span>}>
              <span {...stylex.props(styles.badge)}>{t("account.voiceSampleRecorded")}</span>
            </Show>
          </Show>
        </div>
        <div {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.rowValue)}>{t("account.voiceSampleDesc")}</div>
        </div>
        <Show when={hasSample()}>
          <span {...stylex.props(styles.hint)}>{t("submit.voiceLang", { lang: t(`lang.${voiceLang()}` as never) })}</span>
          <audio controls src="/v1/me/voice-sample/audio" {...stylex.props(styles.audio)} />
        </Show>
        <div {...stylex.props(styles.hint)}>{t("submit.voiceHint")}</div>
        <div {...stylex.props(styles.readingScript)}>{sampleScript()}</div>
        <Recorder minSeconds={8} maxSeconds={30} onReady={uploadSample} busy={sampleBusy()} />
        <Show when={sampleMsg()}>
          <div {...stylex.props(sampleMsg()!.ok ? styles.success : styles.error)}>{sampleMsg()!.text}</div>
        </Show>
      </div>

      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.rowLabel)}>{t("account.changePassword")}</div>
        <div {...stylex.props(styles.field)}>
          <TextInput label={t("account.currentPassword")} type="password" value={curPw()} onChange={setCurPw} placeholder={t("account.currentPassword")} />
        </div>
        <div {...stylex.props(styles.field)}>
          <TextInput label={t("account.newPassword")} type="password" value={newPw()} onChange={setNewPw} placeholder={t("account.newPassword")} />
        </div>
        <div {...stylex.props(styles.field)}>
          <TextInput label={t("account.confirmPassword")} type="password" value={confirmPw()} onChange={setConfirmPw} placeholder={t("account.confirmPassword")} />
        </div>
        <Button onClick={changePassword} disabled={pwBusy()}>{pwBusy() ? t("account.submitting") : t("account.updatePassword")}</Button>
        <Show when={pwMsg()}>
          <div {...stylex.props(pwMsg()!.ok ? styles.success : styles.error)}>{pwMsg()!.text}</div>
        </Show>
      </div>
    </>
  );
}
