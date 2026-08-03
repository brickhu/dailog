import { Show } from "solid-js";
import { Navigate, type RouteSectionProps } from "@solidjs/router";
import { useAuth } from "./auth";

/** 统一登录入口：生产 studio（app.dailogues.com）→ 主站 dailogues.com/login（带 redirect 回跳）；
 *  其余环境（localhost / *.pages.dev / 各 dev 域）→ SPA 自身 /login 备用登录页（同源跳转）。
 *  用运行时 hostname 而非构建期 DEV 判断——Pages 生产构建下 DEV=false，dev 部署也会被错误导向生产登录页 */
function loginHref(): string {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  if (host === "app.dailogues.com") {
    const redirect = encodeURIComponent(window.location.pathname);
    return `https://dailogues.com/login${redirect ? `?redirect=${redirect}` : ""}`;
  }
  return "/login";
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
