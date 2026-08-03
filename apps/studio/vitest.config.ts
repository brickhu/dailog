import { defineConfig } from "vitest/config";

// 单测：纯 TS 逻辑（api/sse/env 等），node 环境即可；组件渲染走本地手测清单
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
