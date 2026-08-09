import { createSignal, createEffect, onMount, Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button, TextField, Spinner } from "@dailogues/ui";

// 账号中心（dailog.fm/account）：
//   区块一「账号管理」——邮箱/GitHub 绑定/昵称/修改密码（better-auth 官方端点，站内代理）
//   区块二「频道设置」——频道地址 slug/频道名/简介（PATCH /api/me/channel）
// 划分：账号 = user 表（登录凭据），频道 = profiles 表（公开身份）——各管各的

const clientEnv = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "https://api.dailog.fm",
  siteBaseUrl: (import.meta.env.VITE_SITE_BASE_URL as string | undefined) ?? "https://dailog.fm",
};

interface ProfileData {
  email: string | null;
  nickname: string | null;
  emailVerified: boolean;
  image: string | null;
  hasGithub: boolean;
  username: string | null;
  displayName: string | null;
  bio: string | null;
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
    border: `1px solid ${colors.ink}`,
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
  hint: {
    fontSize: dimensions.fontSizeSm,
    color: colors.neutral,
    marginTop: dimensions.spacing1,
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
  const [session, setSession] = createSignal<{ id: string } | null>(null);
  const [checked, setChecked] = createSignal(false);
  const [profile, setProfile] = createSignal<ProfileData | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);

  // 登录守卫：未登录跳统一登录页（redirect 回 /account）
  onMount(async () => {
    const res = await fetch("/api/auth/get-session");
    if (res.ok) {
      const data = (await res.json()) as { user?: { id: string } | null } | null;
      setSession(data?.user ?? null);
    }
    setChecked(true);
  });
  createEffect(() => {
    if (checked() && session() === null) {
      window.location.href = `/login?redirect=${encodeURIComponent("/account")}`;
    }
  });

  // 加载档案
  createEffect(() => {
    if (!session()) return;
    fetch("/api/me/profile")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ProfileData;
      })
      .then(setProfile)
      .catch(() => setLoadError("档案加载失败，请刷新重试"));
  });

  return (
    <div {...stylex.props(styles.page)}>
      <Title>账号 · dailog</Title>
      <div {...stylex.props(styles.content)}>
        <Show when={session()}>
          <div {...stylex.props(styles.title)}>账号</div>
          <div {...stylex.props(styles.subtitle)}>管理你的账号（频道设置在创作端）</div>

          <Show when={profile()} fallback={<div {...stylex.props(styles.loading)}><Spinner /> 加载中…</div>}>
            <AccountSection profile={profile()!} loadError={loadError()} />
          </Show>
        </Show>
      </div>
    </div>
  );
}

function AccountSection(props: { profile: ProfileData; loadError: string | null }) {
  return (
    <section {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionTitle)}>账号管理</div>
      <AccountBlock profile={props.profile} loadError={props.loadError} />
    </section>
  );
}

/** 账号管理：邮箱 / GitHub 绑定 / 昵称 / 修改密码 */
function AccountBlock(props: { profile: ProfileData; loadError: string | null }) {
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
    if (!trimmed) return setNameMsg({ ok: false, text: "昵称不能为空" });
    const res = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: trimmed }),
    });
    setNameMsg(res.ok ? { ok: true, text: "已保存" } : { ok: false, text: "保存失败，请重试" });
  };

  const changePassword = async () => {
    setPwMsg(null);
    if (newPw().length < 8) return setPwMsg({ ok: false, text: "新密码至少 8 位" });
    if (newPw() !== confirmPw()) return setPwMsg({ ok: false, text: "两次输入的新密码不一致" });
    setPwBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: curPw(), newPassword: newPw() }),
      });
      if (res.ok) {
        setPwMsg({ ok: true, text: "密码已更新" });
        setCurPw(""); setNewPw(""); setConfirmPw("");
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setPwMsg({ ok: false, text: body?.message ?? "修改失败，请检查当前密码" });
      }
    } finally {
      setPwBusy(false);
    }
  };

  // GitHub 登录入口（未配置 GITHUB_CLIENT_ID 时按钮隐藏——由 api 侧插件未注册决定，
  // 这里用 profile 是否返回 hasGithub 无法判断配置；直接点击后由 api 返回错误提示）
  const githubUrl = `${clientEnv.apiBaseUrl}/api/auth/sign-in/social?provider=github&callbackURL=${encodeURIComponent(`${clientEnv.siteBaseUrl}/account`)}`;

  return (
    <>
      {props.loadError && <div {...stylex.props(styles.error)}>{props.loadError}</div>}
      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.rowLabel)}>邮箱</span>
          <span {...stylex.props(styles.rowValue)}>
            {p().email}
            <Show when={p().emailVerified} fallback={<span style={{ "margin-left": "8px" }}>未验证</span>}>
              <span {...stylex.props(styles.badge)} style={{ "margin-left": "8px" }}>已验证</span>
            </Show>
          </span>
        </div>
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.rowLabel)}>GitHub 登录</span>
          <Show when={p().hasGithub} fallback={<a href={githubUrl}>使用 GitHub 登录</a>}>
            <span {...stylex.props(styles.badge)}>已绑定 ✓</span>
          </Show>
        </div>
      </div>

      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.rowLabel)}>昵称</span>
        </div>
        <div {...stylex.props(styles.field)}>
          <TextField label="昵称" value={nickname()} onInput={(v) => setNickname(v)} placeholder="你的昵称" maxLength={30} />
        </div>
        <Button onClick={saveName}>保存昵称</Button>
        <Show when={nameMsg()}>
          <div {...stylex.props(nameMsg()!.ok ? styles.success : styles.error)}>{nameMsg()!.text}</div>
        </Show>
      </div>

      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.rowLabel)}>修改密码</div>
        <div {...stylex.props(styles.field)}>
          <TextField label="当前密码" type="password" value={curPw()} onInput={setCurPw} placeholder="当前密码" />
        </div>
        <div {...stylex.props(styles.field)}>
          <TextField label="新密码" type="password" value={newPw()} onInput={setNewPw} placeholder="新密码（至少 8 位）" />
        </div>
        <div {...stylex.props(styles.field)}>
          <TextField label="确认新密码" type="password" value={confirmPw()} onInput={setConfirmPw} placeholder="再次输入新密码" />
        </div>
        <Button onClick={changePassword} disabled={pwBusy()}>{pwBusy() ? "提交中…" : "更新密码"}</Button>
        <Show when={pwMsg()}>
          <div {...stylex.props(pwMsg()!.ok ? styles.success : styles.error)}>{pwMsg()!.text}</div>
        </Show>
      </div>
    </>
  );
}
