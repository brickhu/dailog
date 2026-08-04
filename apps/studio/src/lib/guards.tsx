import { Show } from "solid-js";
import { Navigate, useLocation, type RouteSectionProps } from "@solidjs/router";
import { useAuth } from "./auth";

/** 统一登录入口：生产 studio（app.dailog.fm）→ 主站 dailog.fm/login（带 redirect 回跳）；
 *  其余环境（localhost / *.pages.dev / 各 dev 域）→ SPA 自身 /login 备用登录页（同源跳转）。
 *  用运行时 hostname 而非构建期 DEV 判断——Pages 生产构建下 DEV=false，dev 部署也会被错误导向生产登录页 */
function loginHref(): string {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  if (host === "app.dailog.fm") {
    const redirect = encodeURIComponent(window.location.pathname);
    return `https://dailog.fm/login${redirect ? `?redirect=${redirect}` : ""}`;
  }
  return "/login";
}

/** 布局守卫：未登录 → /auth；session 恢复中先渲染加载态（避免误跳）。
 *  v1 路由模型：父 Route 的 component 接收 RouteSectionProps，子路由经 props.children 渲染
 *
 *  频道守卫（统一跳转）：
 *  - 未开通频道（channelActive=false）且不在 /onboarding → 强制去 /onboarding（第一步：授权码）
 *  - 已开通但未录音（hasVoiceSample=false）且不在 /onboarding → 强制去 /onboarding（第二步：录音）
 *  - 从 /onboarding 走出去由页面自己控制（录音完成后页面导航到工作台，守卫不截断两步流程） */
export function RequireAuth(props: RouteSectionProps) {
  const auth = useAuth();
  const location = useLocation();
  // onboarding 未完成 = 未开通 或 开通了但没录音
  const onboardingIncomplete = () =>
    !auth.channelActive() || (auth.channelActive() && !auth.hasVoiceSample());
  return (
    <Show when={!auth.loading} fallback={<div>加载中…</div>}>
      <Show when={auth.user} fallback={<Navigate href={loginHref()} />}>
        <Show
          when={auth.channelActive() !== null && auth.hasVoiceSample() !== null}
          fallback={<div>加载中…</div>}
        >
          <Show
            when={!onboardingIncomplete() || location.pathname === "/onboarding"}
            fallback={<Navigate href="/onboarding" />}
          >
            {props.children}
          </Show>
        </Show>
      </Show>
    </Show>
  );
}
