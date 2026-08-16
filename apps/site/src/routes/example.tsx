// 组件示例页（仅本地开发）：渲染 packages/ui 的完整组件展示（Examples）。
// 生产构建 import.meta.env.DEV=false → 不输出任何内容。
import { createSignal, Show } from "solid-js";
import { Examples } from "@dailogues/ui";
import { layouts } from "@dailogues/ui/theme.stylex";
import * as stylex from "@stylexjs/stylex";
import { auth } from "../lib/auth-guard";
import { openImportDialog } from "../components/import-dialog";

export default function Example() {
  if (!import.meta.env.DEV) return null;
  // use:auth 演示：已登录直接执行，未登录弹登录/注册引导层
  const [ran, setRan] = createSignal("");
  return (
    <div {...stylex.props(layouts.page)}>
      <div {...stylex.props(layouts.containerFull)}>
      <Examples />
      <div style={{ padding: "16px", display: "flex", gap: "12px", "align-items": "center" }}>
        <button use:auth={true} onClick={() => setRan("已登录：收藏操作已执行")} style={{ padding: "8px 16px" }}>
          use:auth 需要登录的操作
        </button>
        <button use:auth={{ redirect: "/settings" }} onClick={() => setRan("已登录：设置操作已执行")} style={{ padding: "8px 16px" }}>
          use:auth 带回跳
        </button>
        <Show when={ran()}>
          <span style={{ color: "green" }}>{ran()}</span>
        </Show>
      </div>
      <div style={{ padding: "16px", display: "flex", gap: "12px" }}>
        <button onClick={openImportDialog} style={{ padding: "8px 16px" }}>
          打开导入弹框
        </button>
      </div>
      </div>
    </div>
  );
}
