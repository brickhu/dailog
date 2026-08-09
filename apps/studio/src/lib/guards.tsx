import { Show } from "solid-js";
import type { RouteSectionProps } from "@solidjs/router";
import { useAuth } from "./auth";
import LoginPage from "../pages/login";
import OnboardingPage from "../pages/onboarding";

/**
 * 双层 Context 守卫（锁定式，非重定向）：
 *  - 第一层 Auth：auth 缺失 → 原地锁定登录界面（URL 不变，含 query）
 *  - 第二层 Channel：onboarding 未完成（未开频道 / 未录音）→ 原地锁定 onboarding 界面
 *  URL 全程不变 → 登录/onboarding 完成后自动解锁，自然回到原始路径，无需 redirect 参数。
 *  因此 app 不需要 /login、/onboarding 路由——它们只是锁定视图。
 */

export function AppShell(props: RouteSectionProps) {
  const auth = useAuth();
  return (
    <Show when={!auth.loading} fallback={<div>加载中…</div>}>
      <Show when={auth.user} fallback={<LoginPage />}>
        <Show
          when={auth.channelActive() !== null && auth.hasVoiceSample() !== null}
          fallback={<div>加载中…</div>}
        >
          <Show when={auth.channelActive() && auth.hasVoiceSample()} fallback={<OnboardingPage />}>
            {props.children}
          </Show>
        </Show>
      </Show>
    </Show>
  );
}
