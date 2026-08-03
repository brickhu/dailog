import { Show, type JSX } from "solid-js";
import { Navigate } from "@solidjs/router";
import { useAuth } from "./auth";

/** 未登录 → /auth；session 恢复中先渲染加载态（避免误跳） */
export function RequireAuth(props: { children: JSX.Element }) {
  const auth = useAuth();
  // auth.user/auth.loading 是响应式 getter（内部读取 signal）
  return (
    <Show when={!auth.loading} fallback={<div>加载中…</div>}>
      <Show when={auth.user} fallback={<Navigate href="/auth" />}>
        {props.children}
      </Show>
    </Show>
  );
}
