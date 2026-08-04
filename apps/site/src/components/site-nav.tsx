import { Show, createSignal, onMount } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@dailogues/ui/theme.stylex";

const styles = stylex.create({
  header: {
    padding: `${tokens.space4} ${tokens.space6}`,
    borderBottom: `1px solid ${tokens.colorBorder}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    fontSize: "18px",
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorPrimary,
    textDecoration: "none",
  },
  login: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    textDecoration: "none",
    ":hover": { color: tokens.colorText },
  },
  userBox: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space3,
  },
  email: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
  },
  signOut: {
    background: "transparent",
    border: `1px solid ${tokens.colorBorder}`,
    color: tokens.colorTextMuted,
    borderRadius: tokens.radiusSm,
    padding: `${tokens.space1} ${tokens.space2}`,
    fontSize: tokens.fontSizeSm,
    cursor: "pointer",
    ":hover": { color: tokens.colorText, borderColor: tokens.colorTextMuted },
  },
});

/** 消费端导航：brand + 登录态。
 *  会话经 site 代理（/api/auth/get-session）在 client 判定（cookie 同站自动携带）；
 *  SSR 首帧无 cookie 渲染"登录"，hydration 后更新为邮箱 + 登出。 */
export function SiteNav() {
  // 会话判定：仅 client 执行（SSR 无浏览器 cookie、相对 fetch 在 workerd 抛 Invalid URL）。
  // 不用 createAsync——其 SSR 序列化结果（null）会被 hydration 复用，不再重新请求；
  // onMount 保证挂载后必然重新 fetch，首帧渲染"登录"、挂载后更新为邮箱。
  const [user, setUser] = createSignal<{ email?: string } | null>(null);
  onMount(async () => {
    const res = await fetch("/api/auth/get-session");
    if (!res.ok) return;
    // better-auth 未登录返回 JSON null（代理透传）——必须整体可选链，否则 onMount 抛错、导航永不更新
    const data = (await res.json()) as { user?: { email?: string } | null } | null;
    setUser(data?.user ?? null);
  });

  const signOut = async () => {
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => {});
    window.location.reload();
  };

  return (
    <header {...stylex.props(styles.header)}>
      <a href="/" {...stylex.props(styles.brand)}>
        dailog
      </a>
      <Show when={user()} fallback={<a href="/login" {...stylex.props(styles.login)}>登录</a>}>
        {(u) => (
          <div {...stylex.props(styles.userBox)}>
            <span {...stylex.props(styles.email)}>{u().email}</span>
            <button {...stylex.props(styles.signOut)} onClick={signOut}>
              登出
            </button>
          </div>
        )}
      </Show>
    </header>
  );
}
