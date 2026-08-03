import { Show, type JSX } from "solid-js";
import { Navigate } from "@solidjs/router";
import { useAuth } from "./auth";

/** 未登录 → /auth；session 恢复中先渲染加载态（避免误跳） */
export function RequireAuth(props: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  return (
    <Show when={!loading()} fallback={<div>加载中…</div>}>
      <Show when={user()} fallback={<Navigate href="/auth" />}>
        {props.children}
      </Show>
    </Show>
  );
}
