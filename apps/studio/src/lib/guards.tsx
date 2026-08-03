import { Show } from "solid-js";
import { Navigate, type RouteSectionProps } from "@solidjs/router";
import { useAuth } from "./auth";
import { isDev } from "./env";

/** 统一登录入口：生产跳主站 dailogues.com/login（带 redirect 回跳）；本地 dev 走 SPA 备用登录页 */
function loginHref(): string {
  if (isDev) return "/login";
  const redirect = typeof window !== "undefined" ? encodeURIComponent(window.location.pathname) : "";
  return `https://dailogues.com/login${redirect ? `?redirect=${redirect}` : ""}`;
}

/** 布局守卫：未登录 → /auth；session 恢复中先渲染加载态（避免误跳）。
 *  v1 路由模型：父 Route 的 component 接收 RouteSectionProps，子路由经 props.children 渲染 */
export function RequireAuth(props: RouteSectionProps) {
  const auth = useAuth();
  // auth.user/auth.loading 是响应式 getter（内部读取 signal）
  return (
    <Show when={!auth.loading} fallback={<div>加载中…</div>}>
      <Show when={auth.user} fallback={<Navigate href={loginHref()} />}>
        {props.children}
      </Show>
    </Show>
  );
}
