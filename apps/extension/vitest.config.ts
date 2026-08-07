import { defineConfig } from "vitest/config";

// Vitest 3：用 projects 区分环境（node 默认；tests/parsers 用 jsdom）
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/parsers/**"],
        },
      },
      {
        test: {
          environment: "jsdom",
          include: ["tests/parsers/**/*.test.ts"],
          setupFiles: ["tests/setup-matchmedia.ts"], // jsdom 无 matchMedia，提供 polyfill
        },
      },
    ],
  },
});
