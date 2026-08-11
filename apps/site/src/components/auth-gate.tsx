import { createSignal, createEffect, onMount, Show, type ParentProps } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Spinner } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";

// 登录守卫（统一模式）：挂载后判定会话（/v1/auth/get-session）——
//  判定期间显示 loading（防止表单闪烁/误操作触发认证限流）；
//  未登录 → 跳统一登录页（redirect 回当前页）；已登录 → 渲染 children。
// 注意：SSR 首帧不判定（无 cookie），仅客户端执行（与 me.tsx 原逻辑一致）。

const styles = stylex.create({
  loading: {
    minHeight: "40vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: dimensions.spacing3,
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
});

export function AuthGate(props: ParentProps & { redirect?: string }) {
  const { t } = useI18n();
  const [session, setSession] = createSignal<{ id: string } | null>(null);
  const [checked, setChecked] = createSignal(false);

  onMount(async () => {
    try {
      const res = await fetch("/v1/auth/get-session");
      if (res.ok) {
        // better-auth 未登录返回 JSON null——必须整体可选链
        const data = (await res.json()) as { user?: { id: string } | null } | null;
        setSession(data?.user ?? null);
      }
    } finally {
      setChecked(true);
    }
  });

  createEffect(() => {
    if (checked() && session() === null) {
      window.location.href = `/login?redirect=${encodeURIComponent(props.redirect ?? "/")}`;
    }
  });

  return (
    <Show
      when={checked() && session() !== null}
      fallback={
        <div {...stylex.props(styles.loading)}>
          <Spinner size={28} />
          <span>{t("common.loading")}</span>
        </div>
      }
    >
      {props.children}
    </Show>
  );
}
