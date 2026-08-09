import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";
import stylex from "@stylexjs/unplugin";

// 单测：纯 TS 逻辑（api/sse/recorder reducer 等）。
// 测试可能 import 组件模块（顶层 stylex.create/defineVars），需与 dev 相同的转换管线。
export default defineConfig({
  plugins: [
    stylex.vite({
      dev: true,
      runtimeInjection: true,
      treeshakeCompensation: false,
    }),
    solid(),
  ],
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    server: {
      deps: {
        // ui 包 banner 组件引 @iconify-icon/solid（.jsx 分发）——node 侧加载需走 vite 转换
        inline: ["@iconify-icon/solid"],
      },
    },
  },
});
