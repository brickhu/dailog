import { createSignal, createEffect, onMount, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button, TextInput, Spinner } from "@dailogues/ui";
import VoiceSamplePreview from "../components/voice-sample-preview";
import VoiceSampleRecorderDialog from "../components/voice-sample-recorder-dialog";
import type { RecordedSample } from "../components/voice-sample-recorder-dialog";
import { ENABLED_SAMPLE_LANGUAGES } from "../lib/languages";
import { getReadingScript } from "../lib/reading-scripts";
import { saveVoiceSampleCallName, uploadVoiceSample } from "../lib/voice-sample";
import { useI18n } from "@dailogues/i18n";

// 账号中心（dailog.fm/settings）：
//   区块一「账号管理」——邮箱 / 昵称（@slug）/ 修改密码（better-auth 官方端点，站内代理）
//   区块二「身份」——name/avatar/bio/gender/profession/age/nationality/socialLinks（**账号级，不区分语言**）
//   区块三「声音采样」——**按语言区**各一张卡：该区节目中的称呼（callName）+ 该区声音采样（录音/试听/重录）。
//         一投稿 = 一语言区 = 一期节目，两个区各自独立配置。
// 划分：账号 = user 表；主持人资料 = profiles（账号级）；**称呼 + 采样 = voice_samples 行**（owner × 语种，
//       后端 PATCH /v1/me/voice-sample { language, callName }）。

interface ProfileData {
  email: string | null;
  username: string | null;
  emailVerified: boolean;
  name: string | null;
  avatar: string | null;
  bio: string | null;
  /** 脚本画像（账号级；投稿快照 personaInfo） */
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
  sectionDesc: {
    color: colors.neutral,
    marginBottom: dimensions.spacing4,
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
  actions: {
    display: "flex",
    gap: dimensions.spacing3,
    alignItems: "center",
  },
  divider: {
    borderTopStyle: "solid",
    borderTopWidth: dimensions.borderWidthThin,
    borderTopColor: colors.ink,
    margin: `${dimensions.spacing4} 0`,
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
    <>
      <section {...stylex.props(styles.section)}>
        <div {...stylex.props(styles.sectionTitle)}>{t("account.section")}</div>
        <AccountBlock profile={props.profile} loadError={props.loadError} />
      </section>

      {/* 主持人资料（账号级）：公开身份 + 脚本画像 */}
      <section {...stylex.props(styles.section)}>
        <HostProfileBlock profile={props.profile} />
      </section>

      {/* 声音采样：按语言区各一张卡（称呼 + 采样） */}
      <section {...stylex.props(styles.section)}>
        <div {...stylex.props(styles.sectionTitle)}>{t("account.zonesSection")}</div>
        <div {...stylex.props(styles.sectionDesc)}>{t("account.zonesDesc")}</div>
        <For each={ENABLED_SAMPLE_LANGUAGES}>
          {(lang) => <HostZoneCard profile={props.profile} language={lang} />}
        </For>
      </section>
    </>
  );
}

/** 主持人资料（**账号级，不区分语言**）：公开身份（展示名/简介/社交链接）+ 脚本画像（性别/职业/年龄/国籍）。
 *  节目中的称呼不在这里——它随声音采样走（各语言区卡片）。 */
function HostProfileBlock(props: { profile: ProfileData }) {
  const { t } = useI18n();
  const p = () => props.profile;
  const [name, setName] = createSignal(p().name ?? "");
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
        name: name().trim() || undefined,
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
      <div {...stylex.props(styles.field)}>
        <div {...stylex.props(styles.rowValue)}>{t("account.hostProfileDesc")}</div>
      </div>
      <div {...stylex.props(styles.field)}>
        <TextInput label={t("account.displayName")} value={name()} onChange={(v) => setName(v)} maxLength={30} />
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

/** 单个语言区的「采样配置」卡 = 该区节目中的称呼（callName，**存在采样行上**）+ 该区声音采样 */
function HostZoneCard(props: { profile: ProfileData; language: string }) {
  const { t } = useI18n();
  const zone = () => props.language;

  // 称呼（该区）：随该语种采样行走；还没录音时服务端存 draft 行
  const [callName, setCallName] = createSignal("");
  const [nameMsg, setNameMsg] = createSignal<{ ok: boolean; text: string } | null>(null);
  const [nameBusy, setNameBusy] = createSignal(false);

  // 声音采样（该区）
  const [sample, setSample] = createSignal<{ id: string | null; duration: number; hasAudio: boolean } | null>(null);
  const [sampleLoaded, setSampleLoaded] = createSignal(false);
  const [sampleVer, setSampleVer] = createSignal(0);
  const [sampleBusy, setSampleBusy] = createSignal(false);
  const [sampleMsg, setSampleMsg] = createSignal<{ ok: boolean; text: string } | null>(null);
  const [recorderOpen, setRecorderOpen] = createSignal(false);

  /** 拉该语种采样行：含 callName（draft 行 = 只配了称呼还没录音 → hasAudio=false） */
  const fetchSample = async () => {
    try {
      const res = await fetch(`/v1/me/voice-sample?language=${encodeURIComponent(zone())}`);
      if (res.ok) {
        const vs = (await res.json()) as { id?: string | null; duration?: number; callName?: string | null; status?: string } | null;
        setSample(vs ? { id: vs.id ?? null, duration: vs.duration ?? 0, hasAudio: vs.status === "ready" } : null);
        setCallName(vs?.callName ?? "");
      } else {
        setSample(null);
        setCallName("");
      }
    } catch {
      setSample(null);
    } finally {
      setSampleLoaded(true);
    }
  };
  onMount(() => void fetchSample());

  /** 保存该区节目中的称呼（写在采样行上；还没录音时服务端建 draft 行） */
  const saveCallName = async () => {
    setNameMsg(null);
    setNameBusy(true);
    try {
      const ok = await saveVoiceSampleCallName(zone(), callName().trim());
      if (ok) await fetchSample();
      setNameMsg(ok ? { ok: true, text: t("account.zoneNameSaved") } : { ok: false, text: t("account.saveFailed") });
    } finally {
      setNameBusy(false);
    }
  };

  /** 朗读文案：固定稿 + 该区称呼（未填回退公开身份的展示名） */
  const readingScript = () =>
    getReadingScript(zone(), callName().trim() || props.profile.name?.trim() || t("submit.hostFallback")).text;

  /** 录音弹窗「保存」→ 上传该区采样（称呼随上传一并提交） */
  const onSampleSubmit = async (s: RecordedSample) => {
    setSampleBusy(true);
    const uploaded = await uploadVoiceSample({ ...s, callName: callName().trim() || null });
    setSampleBusy(false);
    if (!uploaded) {
      setSampleMsg({ ok: false, text: t("recorder.uploadFailed") });
      return; // 上传失败：弹窗保持打开，录音还在，可直接重试保存
    }
    await fetchSample();
    setSampleVer((v) => v + 1); // 试听地址换版本 → 重新拉取新录音（含浏览器缓存绕过）
    setSampleMsg({ ok: true, text: t("account.voiceSampleDone") });
    setRecorderOpen(false);
  };

  return (
    <div {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.rowLabel)}>{t("account.zoneCard", { zone: t(("lang." + zone()) as never) })}</span>
        <Show when={sampleLoaded()} fallback={<Spinner />}>
          <Show when={sample()?.hasAudio} fallback={<span {...stylex.props(styles.rowValue)}>{t("account.voiceSampleNone")}</span>}>
            <span {...stylex.props(styles.badge)}>{t("account.voiceSampleRecorded")}</span>
          </Show>
        </Show>
      </div>

      <div {...stylex.props(styles.field)}>
        <div {...stylex.props(styles.rowValue)}>{t("account.zoneRoleDesc")}</div>
      </div>
      <div {...stylex.props(styles.field)}>
        <TextInput label={t("account.callName")} value={callName()} onChange={(v) => setCallName(v)} maxLength={20} placeholder={props.profile.name ?? undefined} />
      </div>
      <Button onClick={saveCallName} isDisabled={nameBusy()}>{t("account.saveZoneName")}</Button>
      <Show when={nameMsg()}>
        <div {...stylex.props(nameMsg()!.ok ? styles.success : styles.error)}>{nameMsg()!.text}</div>
      </Show>

      <div {...stylex.props(styles.divider)} />

      <div {...stylex.props(styles.field)}>
        <div {...stylex.props(styles.rowValue)}>{t("account.voiceSampleDesc")}</div>
      </div>
      <Show when={sampleLoaded()} fallback={<Spinner />}>
        <Show
          when={sample()?.hasAudio}
          fallback={
            <div {...stylex.props(styles.actions)}>
              <Button onClick={() => setRecorderOpen(true)}>{t("recorder.recordAction")}</Button>
            </div>
          }
        >
          <VoiceSamplePreview
            duration={sample()!.duration}
            language={zone()}
            audioUrl={`/v1/me/voice-sample/audio?language=${encodeURIComponent(zone())}&v=${sampleVer()}`}
            onReRecord={() => setRecorderOpen(true)}
          />
        </Show>
      </Show>
      <Show when={sampleMsg()}>
        <div {...stylex.props(sampleMsg()!.ok ? styles.success : styles.error)}>{sampleMsg()!.text}</div>
      </Show>

      <VoiceSampleRecorderDialog
        open={recorderOpen()}
        language={zone()}
        script={readingScript()}
        busy={sampleBusy()}
        onClose={() => setRecorderOpen(false)}
        onCancel={() => setRecorderOpen(false)}
        onSubmit={onSampleSubmit}
      />
    </div>
  );
}

/** 账号管理：邮箱 / 昵称（@slug）/ 修改密码 */
function AccountBlock(props: { profile: ProfileData; loadError: string | null }) {
  const { t } = useI18n();
  const p = () => props.profile;
  const [username, setUsername] = createSignal(p().username ?? "");
  const [nameMsg, setNameMsg] = createSignal<{ ok: boolean; text: string } | null>(null);

  const [curPw, setCurPw] = createSignal("");
  const [newPw, setNewPw] = createSignal("");
  const [confirmPw, setConfirmPw] = createSignal("");
  const [pwMsg, setPwMsg] = createSignal<{ ok: boolean; text: string } | null>(null);
  const [pwBusy, setPwBusy] = createSignal(false);

  const saveName = async () => {
    setNameMsg(null);
    const trimmed = username().trim();
    if (!/^[A-Za-z0-9]{3,30}$/.test(trimmed)) {
      return setNameMsg({ ok: false, text: t("account.usernameRule") });
    }
    const res = await fetch("/v1/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: trimmed }),
    });
    if (res.ok) return setNameMsg({ ok: true, text: t("account.saved") });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    setNameMsg({ ok: false, text: body?.error === "username_taken" ? t("account.usernameTaken") : t("account.saveFailed") });
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
          <span {...stylex.props(styles.rowLabel)}>{t("account.username")}</span>
        </div>
        <div {...stylex.props(styles.field)}>
          <TextInput label={t("account.username")} value={username()} onChange={(v) => setUsername(v)} placeholder={t("account.usernamePlaceholder")} maxLength={30} />
        </div>
        <div {...stylex.props(styles.rowValue)}>{t("account.usernameDesc")}</div>
        <Button onClick={saveName}>{t("account.saveUsername")}</Button>
        <Show when={nameMsg()}>
          <div {...stylex.props(nameMsg()!.ok ? styles.success : styles.error)}>{nameMsg()!.text}</div>
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
