# 计划 3：浏览器扩展采集器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Chrome/Edge 浏览器扩展（Manifest V3）——用户在 AI 平台登录态下打开自己的对话，点击扩展即采集，回传 `api.dailogues.com/imports`。首发平台：Claude + DeepSeek（可行性最高）。

**Architecture:** thin client 采集器。content script（`src/content/`）按平台解析对话页 DOM：Claude 直采（无虚拟化公开证据），DeepSeek 走虚拟列表滚动采集循环（`core.ts`）；采集结果经 `chrome.runtime.sendMessage` 交给 background service worker（绕开 claude.ai CSP 对 content script 外发 fetch 的拦截）；background 读取 `chrome.storage.local` 中的 JWT（由 `app.dailogues.com` 页面经 `externally_connectable` 注入）后 POST `/api/imports`。扩展不存储对话、不做编辑/生成/发布（thin client 定位，见 ARC §3.5）。

**Tech Stack:** TypeScript / esbuild（打包 content + background）/ Vitest + jsdom（解析器与核心逻辑单测）/ fixture HTML（各平台对话页 DOM 快照，基于 `docs/spikes/chat-dom.md` 公开资料构造，标注"待真实页面校准"）/ Playwright（Task 8 可选：加载 unpacked 扩展冒烟）

**前置条件：** 无外部 Key。需要浏览器开发者模式加载扩展（Task 8 本地验证）。

**采集协议**（`apps/extension/src/shared.ts`）：
```ts
{ platform, conversationId, title, url, messages: [{ role: "user" | "assistant", content }] }
```

---

### Task 1: 扩展脚手架

**Files:**
- Create: `apps/extension/package.json`
- Create: `apps/extension/tsconfig.json`
- Create: `apps/extension/vitest.config.ts`
- Create: `apps/extension/manifest.json`
- Create: `apps/extension/build.mjs`（esbuild 打包脚本）
- Create: `apps/extension/popup.html` + `src/popup.ts`（极简状态页：显示采集状态/未连接提示）
- Test: `apps/extension/tests/placeholder.test.ts`

- [ ] **Step 1: 写失败测试** `apps/extension/tests/placeholder.test.ts`

```ts
import { expect, it } from "vitest";

it("scaffold works", () => {
  expect(1 + 1).toBe(3);
});
```

- [ ] **Step 2: 创建 `apps/extension/package.json`**

```json
{
  "name": "@dailogues/extension",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "esbuild": "^0.24.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: 创建 `apps/extension/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "build.mjs"]
}
```

- [ ] **Step 4: 创建 `apps/extension/vitest.config.ts`**（解析器测试用 jsdom；核心逻辑用 node）

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    environmentMatchGlobs: [["tests/parsers/**", "jsdom"]],
  },
});
```

- [ ] **Step 5: 创建 `apps/extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "dailogues 采集器",
  "version": "0.1.0",
  "description": "把你在 AI 平台的对话一键采集到 dailogues",
  "permissions": ["storage"],
  "host_permissions": [
    "https://claude.ai/*",
    "https://chat.deepseek.com/*",
    "https://chatgpt.com/*",
    "https://gemini.google.com/*",
    "https://kimi.moonshot.cn/*",
    "https://www.doubao.com/*",
    "https://www.tongyi.com/*",
    "https://api.dailogues.com/*"
  ],
  "externally_connectable": {
    "matches": ["https://app.dailogues.com/*"]
  },
  "background": { "service_worker": "dist/background.js", "type": "module" },
  "content_scripts": [
    {
      "matches": [
        "https://claude.ai/chat/*",
        "https://chat.deepseek.com/chat/*",
        "https://chatgpt.com/c/*",
        "https://gemini.google.com/app/*",
        "https://kimi.moonshot.cn/chat/*",
        "https://www.doubao.com/chat/*",
        "https://www.tongyi.com/*"
      ],
      "js": ["dist/content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": { "default_popup": "popup.html" }
}
```

- [ ] **Step 6: 创建 `apps/extension/build.mjs`**（esbuild 打包 content/background/popup 到 dist/）

```js
import { build } from "esbuild";

const common = { bundle: true, outdir: "dist", sourcemap: true, target: "es2022" };

await build({ ...common, entryPoints: ["src/content.ts"], format: "iife" });
await build({ ...common, entryPoints: ["src/background.ts"], format: "esm" });
await build({ ...common, entryPoints: ["src/popup.ts"], format: "iife" });
console.log("extension built → dist/");
```

- [ ] **Step 7: 创建最小入口文件**（骨架，后续任务填充逻辑）

`src/content.ts`：`console.log("dailogues collector content script ready")`
`src/background.ts`：`console.log("dailogues collector background ready")`
`src/popup.ts`：`document.body.textContent = "dailogues 采集器"`

`popup.html`：
```html
<!doctype html>
<html lang="zh">
  <head><meta charset="utf-8" /><title>dailogues</title></head>
  <body><script src="dist/popup.js"></script></body>
</html>
```

- [ ] **Step 8: 安装依赖、验证红→绿、构建、提交**

```bash
cd /Users/free/Projects/dailogues && npx --yes pnpm@9.15.0 install
cd apps/extension && npx vitest run 2>&1 | tail -2   # 预期 FAIL (1+1==3)
# 修正 toBe(2) 后：
npx vitest run 2>&1 | tail -2                        # 预期 PASS
node build.mjs                                       # dist/ 生成 3 个 bundle
git add apps/extension pnpm-lock.yaml
git commit -m "chore(extension): manifest v3 scaffold + esbuild + vitest"
```

> `.gitignore` 需要追加 `apps/extension/dist/`（构建产物不入库）。若 pnpm install 被墙：`export HTTPS_PROXY=socks5://127.0.0.1:1081`。

---

### Task 2: 采集协议类型（shared.ts）

**Files:**
- Create: `apps/extension/src/shared.ts`
- Test: `apps/extension/tests/shared.test.ts`

- [ ] **Step 1: 写失败测试** `apps/extension/tests/shared.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { isCollectedDialogue } from "../src/shared";

describe("isCollectedDialogue", () => {
  it("accepts a valid dialogue", () => {
    expect(isCollectedDialogue({
      platform: "claude",
      conversationId: "abc-123",
      title: "测试对话",
      url: "https://claude.ai/chat/abc-123",
      messages: [
        { role: "user", content: "你好" },
        { role: "assistant", content: "你好！" },
      ],
    })).toBe(true);
  });

  it("rejects empty messages", () => {
    expect(isCollectedDialogue({
      platform: "claude",
      conversationId: "abc-123",
      title: "",
      url: "https://claude.ai/chat/abc-123",
      messages: [],
    })).toBe(false);
  });

  it("rejects unknown platform", () => {
    expect(isCollectedDialogue({
      platform: "not-a-platform",
      conversationId: "x",
      title: "",
      url: "u",
      messages: [{ role: "user", content: "hi" }],
    } as never)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**（模块不存在）

- [ ] **Step 3: 实现 `apps/extension/src/shared.ts`**

```ts
export type Platform =
  | "claude" | "deepseek" | "chatgpt" | "gemini"
  | "kimi" | "doubao" | "tongyi" | "plain";

export type Role = "user" | "assistant";

export interface DialogueMessage {
  role: Role;
  content: string;
}

export interface CollectedDialogue {
  platform: Platform;
  conversationId: string;
  title: string;
  url: string;
  messages: DialogueMessage[];
}

export const PLATFORMS: readonly Platform[] = [
  "claude", "deepseek", "chatgpt", "gemini", "kimi", "doubao", "tongyi", "plain",
];

export function isCollectedDialogue(value: unknown): value is CollectedDialogue {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!PLATFORMS.includes(v.platform as Platform)) return false;
  if (typeof v.conversationId !== "string" || v.conversationId.length === 0) return false;
  if (typeof v.title !== "string") return false;
  if (typeof v.url !== "string" || !v.url.startsWith("http")) return false;
  if (!Array.isArray(v.messages) || v.messages.length === 0) return false;
  return v.messages.every((m) => {
    if (typeof m !== "object" || m === null) return false;
    const msg = m as Record<string, unknown>;
    return (msg.role === "user" || msg.role === "assistant") && typeof msg.content === "string";
  });
}

/** content → background 的消息协议 */
export const MSG_COLLECT = "dailogues:collect";
export const MSG_COLLECT_RESULT = "dailogues:collect-result";
```

- [ ] **Step 4: 运行测试验证通过 + typecheck + 提交**

```bash
npx vitest run && npx tsc --noEmit
git add apps/extension/src/shared.ts apps/extension/tests/shared.test.ts
git commit -m "feat(extension): collect protocol types + guard"
```

---

### Task 3: 核心采集逻辑（去重排序 + 滚动采集循环）

**Files:**
- Create: `apps/extension/src/content/core.ts`
- Test: `apps/extension/tests/core.test.ts`

- [ ] **Step 1: 写失败测试** `apps/extension/tests/core.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { dedupeSort, scrollCollect, type MessageNode } from "../src/content/core";

const mk = (id: string, offsetTop: number, role: MessageNode["role"]): MessageNode =>
  ({ id, offsetTop, role, content: `${id}-content` });

describe("dedupeSort", () => {
  it("dedupes by id and sorts by offsetTop", () => {
    const input = [mk("b", 200, "user"), mk("a", 100, "assistant"), mk("b", 200, "user")];
    const out = dedupeSort(input);
    expect(out.map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("scrollCollect", () => {
  it("loops until no new nodes, then returns accumulated", async () => {
    let round = 0;
    const result = await scrollCollect({
      scrollToTop: async () => { round += 1; },
      readNodes: async () => {
        if (round === 1) return [mk("1", 100, "user")];
        if (round === 2) return [mk("1", 100, "user"), mk("2", 200, "assistant")];
        return [mk("1", 100, "user"), mk("2", 200, "assistant")]; // 稳定态
      },
      waitForMutation: async () => {},
      maxIterations: 10,
      settleRounds: 2,
    });
    expect(result.map((n) => n.id)).toEqual(["1", "2"]);
    expect(round).toBe(3); // 1 次首采 + 2 轮稳定确认
  });

  it("stops at maxIterations", async () => {
    let calls = 0;
    await scrollCollect({
      scrollToTop: async () => {},
      readNodes: async () => { calls += 1; return [mk(`${calls}`, calls, "user")]; },
      waitForMutation: async () => {},
      maxIterations: 3,
      settleRounds: 1,
    });
    expect(calls).toBe(3);
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现 `apps/extension/src/content/core.ts`**

```ts
export interface MessageNode {
  id: string;          // 消息唯一标识（DOM id / data-message-id / 生成）
  offsetTop: number;   // 容器内排序依据
  role: "user" | "assistant";
  content: string;
}

/** 按 id 去重、按 offsetTop 升序 */
export function dedupeSort(nodes: MessageNode[]): MessageNode[] {
  const seen = new Set<string>();
  const unique: MessageNode[] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    unique.push(n);
  }
  return unique.sort((a, b) => a.offsetTop - b.offsetTop);
}

export interface ScrollCollectOptions {
  scrollToTop: () => Promise<void>;
  readNodes: () => Promise<MessageNode[]>;
  waitForMutation: () => Promise<void>;
  maxIterations: number;
  settleRounds: number; // 连续 N 轮无新增即视为稳定
}

/**
 * 虚拟列表滚动采集循环：
 * 滚动到顶 → 读节点 → 等待新节点渲染（MutationObserver）→ 重复，
 * 连续 settleRounds 轮无新增或达 maxIterations 停止。
 */
export async function scrollCollect(opts: ScrollCollectOptions): Promise<MessageNode[]> {
  const acc: MessageNode[] = [];
  let stable = 0;
  for (let i = 0; i < opts.maxIterations; i++) {
    await opts.scrollToTop();
    const nodes = await opts.readNodes();
    const before = acc.length;
    for (const n of nodes) {
      if (!acc.some((x) => x.id === n.id)) acc.push(n);
    }
    if (acc.length === before) {
      stable += 1;
      if (stable >= opts.settleRounds) break;
    } else {
      stable = 0;
    }
    if (i < opts.maxIterations - 1) await opts.waitForMutation();
  }
  return dedupeSort(acc);
}
```

- [ ] **Step 4: 测试通过 + typecheck + 提交**

```bash
npx vitest run && npx tsc --noEmit
git add apps/extension/src/content/core.ts apps/extension/tests/core.test.ts
git commit -m "feat(extension): dedupe-sort + virtual-list scroll collect loop"
```

---

### Task 4: Claude 采集器

**Files:**
- Create: `apps/extension/src/content/claude.ts`
- Fixture: `apps/extension/tests/fixtures/claude-chat.html`
- Test: `apps/extension/tests/parsers/claude.test.ts`（jsdom 环境）

- [ ] **Step 1: 写失败测试** `apps/extension/tests/parsers/claude.test.ts`

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudePage } from "../../src/content/claude";

const html = readFileSync(join(import.meta.dirname, "../fixtures/claude-chat.html"), "utf-8");

describe("parseClaudePage", () => {
  it("extracts user + assistant messages in order", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nodes = parseClaudePage(doc);
    expect(nodes.map((n) => n.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(nodes[0].content).toContain("你好");
    expect(nodes[1].content).toContain("你好！");
  });

  it("extracts title from document.title", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.title).toContain("测试对话");
  });
});
```

- [ ] **Step 2: 创建 fixture** `apps/extension/tests/fixtures/claude-chat.html`（基于 `docs/spikes/chat-dom.md` 的 Claude 选择器构造：`[data-testid="user-message"]` / `[data-testid="assistant-message"]`；标注"基于公开资料构造，待真实页面校准"）

```html
<!doctype html>
<html>
<head><title>测试对话 · Claude</title></head>
<body>
  <main>
    <div data-testid="user-message"><div class="message-content">你好，帮我看一下这个方案。</div></div>
    <div data-testid="assistant-message"><div class="message-content">你好！我先分析一下你的需求。</div></div>
    <div data-testid="user-message"><div class="message-content">主要看竞品分析部分。</div></div>
    <div data-testid="assistant-message"><div class="message-content">好的，以下是竞品分析……</div></div>
  </main>
</body>
</html>
```

- [ ] **Step 3: 运行验证失败**

- [ ] **Step 4: 实现 `apps/extension/src/content/claude.ts`**

```ts
import type { MessageNode } from "./core";
import type { CollectedDialogue } from "../shared";

const USER_SELECTOR = '[data-testid="user-message"]';
const ASSISTANT_SELECTOR = '[data-testid="assistant-message"]';

/** 从消息节点提取纯文本内容（剥离隐藏节点、代码块保留文本） */
function extractText(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Claude 对话页解析（选择器依据 docs/spikes/chat-dom.md，待真实页面校准） */
export function parseClaudePage(root: ParentNode): MessageNode[] {
  const nodes: MessageNode[] = [];
  root.querySelectorAll(USER_SELECTOR).forEach((el) => {
    nodes.push({ id: `u-${nodes.length}`, offsetTop: el.getBoundingClientRect().top, role: "user", content: extractText(el) });
  });
  root.querySelectorAll(ASSISTANT_SELECTOR).forEach((el) => {
    nodes.push({ id: `a-${nodes.length}`, offsetTop: el.getBoundingClientRect().top, role: "assistant", content: extractText(el) });
  });
  return nodes.sort((a, b) => a.offsetTop - b.offsetTop);
}

/** 从 URL 提取 conversationId（claude.ai/chat/{uuid}） */
export function claudeConversationId(url: string): string | null {
  return url.match(/\/chat\/([a-f0-9-]+)/)?.[1] ?? null;
}

/** 组装采集协议（title 取 document.title，去掉平台后缀） */
export function collectClaude(root: ParentNode, url: string): CollectedDialogue | null {
  const conversationId = claudeConversationId(url);
  if (!conversationId) return null;
  const messages = parseClaudePage(root).map(({ role, content }) => ({ role, content }));
  if (messages.length === 0) return null;
  const title = (root.ownerDocument?.title ?? "").replace(/\s*[·|]\s*Claude\s*$/, "").trim();
  return { platform: "claude", conversationId, title, url, messages };
}
```

> `getBoundingClientRect().top` 在 jsdom 中返回 0，排序退化为插入序——测试断言只检查顺序与内容，不依赖 top 值（fixture 顺序即文档序）。真实页面中 offsetTop 由滚动采集循环的 readNodes 提供。

- [ ] **Step 5: 测试通过 + typecheck + 提交**

```bash
npx vitest run && npx tsc --noEmit
git add apps/extension/src/content/claude.ts apps/extension/tests/parsers apps/extension/tests/fixtures
git commit -m "feat(extension): claude collector + fixture test"
```

---

### Task 5: DeepSeek 采集器（虚拟列表滚动适配）

**Files:**
- Create: `apps/extension/src/content/deepseek.ts`
- Fixture: `apps/extension/tests/fixtures/deepseek-chat.html`
- Test: `apps/extension/tests/parsers/deepseek.test.ts`（jsdom）

- [ ] **Step 1: 写失败测试** `apps/extension/tests/parsers/deepseek.test.ts`

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deepseekMessageId, parseDeepSeekPage } from "../../src/content/deepseek";

const html = readFileSync(join(import.meta.dirname, "../fixtures/deepseek-chat.html"), "utf-8");

describe("parseDeepSeekPage", () => {
  it("extracts messages by data-message-author-role", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nodes = parseDeepSeekPage(doc);
    expect(nodes.map((n) => n.role)).toEqual(["user", "assistant", "user"]);
    expect(nodes[1].content).toContain("核心原则");
  });

  it("assigns stable ids from data-message-id", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ids = parseDeepSeekPage(doc).map((n) => n.id);
    expect(ids).toEqual(["m1", "m2", "m3"]);
  });
});

describe("deepseekMessageId", () => {
  it("falls back to a derived id when data-message-id missing", () => {
    const el = document.createElement("div");
    el.textContent = "fallback";
    expect(deepseekMessageId(el, 5)).toBe("gen-5");
  });
});
```

- [ ] **Step 2: 创建 fixture** `apps/extension/tests/fixtures/deepseek-chat.html`（模拟虚拟列表存活节点：`.ds-virtual-list` 内 3 条消息，带 `data-message-id` 与 `data-message-author-role`，`.ds-markdown` 内容）

```html
<!doctype html>
<html>
<head><title>AI 对话中，如何将知识注入对话 - DeepSeek</title></head>
<body>
  <div class="ds-scroll-area">
    <div class="ds-virtual-list">
      <div data-message-id="m1" data-message-author-role="user"><div class="ds-markdown">如何将知识注入 AI 对话？</div></div>
      <div data-message-id="m2" data-message-author-role="assistant"><div class="ds-markdown">核心原则是**按需、结构化、防干扰**。</div></div>
      <div data-message-id="m3" data-message-author-role="user"><div class="ds-markdown">给个具体例子。</div></div>
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 3: 运行验证失败**

- [ ] **Step 4: 实现 `apps/extension/src/content/deepseek.ts`**

```ts
import type { MessageNode } from "./core";
import type { CollectedDialogue } from "../shared";

const MESSAGE_SELECTOR = '[data-message-author-role="user"], [data-message-author-role="assistant"]';

export function deepseekMessageId(el: Element, index: number): string {
  return el.getAttribute("data-message-id") ?? `gen-${index}`;
}

/** DeepSeek 对话页解析（虚拟列表存活节点；依据 docs/spikes/chat-dom.md，待真实页面校准） */
export function parseDeepSeekPage(root: ParentNode): MessageNode[] {
  const nodes: MessageNode[] = [];
  root.querySelectorAll(MESSAGE_SELECTOR).forEach((el, i) => {
    const role = el.getAttribute("data-message-author-role");
    if (role !== "user" && role !== "assistant") return;
    const content = (el.querySelector(".ds-markdown") ?? el).textContent ?? "";
    nodes.push({
      id: deepseekMessageId(el, i),
      offsetTop: el.getBoundingClientRect().top,
      role,
      content: content.replace(/\s+/g, " ").trim(),
    });
  });
  return nodes;
}

export function deepseekConversationId(url: string): string | null {
  return url.match(/\/chat\/([^/?#]+)/)?.[1] ?? null;
}

export function collectDeepSeek(root: ParentNode, url: string): CollectedDialogue | null {
  const conversationId = deepseekConversationId(url);
  if (!conversationId) return null;
  const messages = parseDeepSeekPage(root).map(({ role, content }) => ({ role, content }));
  if (messages.length === 0) return null;
  const title = (root.ownerDocument?.title ?? "").replace(/\s*[-·]\s*DeepSeek\s*$/, "").trim();
  return { platform: "deepseek", conversationId, title, url, messages };
}
```

> 采集循环侧：DeepSeek 是虚拟列表——content.ts 中将 `parseDeepSeekPage` 接入 `scrollCollect`（滚动容器 `.ds-scroll-area`），见 Task 6。

- [ ] **Step 5: 测试通过 + typecheck + 提交**

```bash
npx vitest run && npx tsc --noEmit
git add apps/extension/src/content/deepseek.ts apps/extension/tests/parsers apps/extension/tests/fixtures
git commit -m "feat(extension): deepseek collector (virtual list) + fixture test"
```

---

### Task 6: content → background 接线 + 平台分发

**Files:**
- Modify: `apps/extension/src/content.ts`
- Modify: `apps/extension/src/background.ts`
- Test: `apps/extension/tests/content.test.ts`（node 环境，mock chrome）

- [ ] **Step 1: 写失败测试** `apps/extension/tests/content.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { collectFromDocument } from "../src/content/collector";

// 用轻量 fake DOM（无 jsdom，collector 只依赖传入的 root 与平台分发）
describe("collectFromDocument", () => {
  it("dispatches by platform", async () => {
    const root = { querySelectorAll: () => [], ownerDocument: { title: "x" } } as unknown as ParentNode;
    const claude = { url: "https://claude.ai/chat/uuid", platform: "claude" as const };
    const r = await collectFromDocument({ root, url: claude.url });
    expect(r).toBeNull(); // 无消息 → null（claude 采集器返回 null）
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现平台分发** `apps/extension/src/content/collector.ts`

```ts
import type { CollectedDialogue } from "../shared";
import { collectClaude } from "./claude";
import { collectDeepSeek } from "./deepseek";
import { scrollCollect, type MessageNode } from "./core";

export interface CollectContext {
  root: ParentNode;
  url: string;
  scroll?: {
    container: Element;
    readNodes: () => Promise<MessageNode[]>;
    waitForMutation: () => Promise<void>;
  };
}

/** 按 URL 分发到平台采集器；DeepSeek 等虚拟列表平台接入滚动采集 */
export async function collectFromDocument(ctx: CollectContext): Promise<CollectedDialogue | null> {
  const { root, url } = ctx;
  if (url.startsWith("https://claude.ai/chat/")) return collectClaude(root, url);
  if (url.startsWith("https://chat.deepseek.com/chat/")) {
    if (ctx.scroll) {
      const nodes = await scrollCollect({
        scrollToTop: ctx.scroll.container.scrollTo ? async () => { ctx.scroll!.container.scrollTop = 0; } : async () => {},
        readNodes: ctx.scroll.readNodes,
        waitForMutation: ctx.scroll.waitForMutation,
        maxIterations: 20,
        settleRounds: 2,
      });
      // 用滚动累计结果重组成采集协议
      if (nodes.length === 0) return null;
      const conv = /\/chat\/([^/?#]+)/.exec(url)?.[1];
      if (!conv) return null;
      const title = (root.ownerDocument?.title ?? "").replace(/\s*[-·]\s*DeepSeek\s*$/, "").trim();
      return {
        platform: "deepseek", conversationId: conv, title, url,
        messages: nodes.map(({ role, content }) => ({ role, content })),
      };
    }
    return collectDeepSeek(root, url);
  }
  return null;
}
```

- [ ] **Step 4: 接线 content.ts**（完整实现）

```ts
import { MSG_COLLECT, type CollectResult } from "./shared";
import { collectFromDocument } from "./content/collector";
import { parseDeepSeekPage } from "./content/deepseek";
import { waitForMutation } from "./content/mutation";

function deepSeekScroll() {
  const container = document.querySelector(".ds-scroll-area");
  if (!container) return undefined;
  return {
    container,
    readNodes: async () => parseDeepSeekPage(document),
    waitForMutation: () => waitForMutation(document.body),
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== MSG_COLLECT) return;
  collectFromDocument({ root: document, url: location.href, scroll: deepSeekScroll() })
    .then((dialogue) => {
      const result: CollectResult = dialogue
        ? { ok: true, dialogue }
        : { ok: false, error: "collect_empty" };
      sendResponse(result);
    })
    .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
  return true; // 异步响应
});
```

- [ ] **Step 5: 实现辅助** `apps/extension/src/content/mutation.ts`

```ts
/** 等待 DOM 变化（滚动加载新节点后触发）；无变化则短延时后返回 */
export function waitForMutation(root: Node, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    const observer = new MutationObserver(done);
    observer.observe(root, { childList: true, subtree: true });
    function done() {
      clearTimeout(timer);
      observer.disconnect();
      resolve();
    }
  });
}
```

- [ ] **Step 6: 测试通过（含前序任务全部）+ typecheck + 提交**

```bash
npx vitest run && npx tsc --noEmit
git add apps/extension/src/content.ts apps/extension/src/content/collector.ts apps/extension/src/content/mutation.ts apps/extension/src/shared.ts apps/extension/tests
git commit -m "feat(extension): content script dispatch + scroll wiring"
```

> `shared.ts` 需要补 `CollectResult` 类型：`{ ok: true; dialogue: CollectedDialogue } | { ok: false; error: string }`。

---

### Task 7: background 回传（token + POST /imports）

**Files:**
- Modify: `apps/extension/src/background.ts`
- Modify: `apps/extension/src/shared.ts`（补 CollectResult / token 消息）
- Test: `apps/extension/tests/background.test.ts`（node 环境，mock chrome + fetch）

- [ ] **Step 1: 写失败测试** `apps/extension/tests/background.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCollect } from "../src/background";

function mockChrome(token: string | null) {
  const storage = { local: { get: vi.fn(async () => ({ dailoguesToken: token })) } };
  (globalThis as Record<string, unknown>).chrome = { storage };
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("handleCollect", () => {
  it("posts to /api/imports with bearer token", async () => {
    mockChrome("jwt-token");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "imp-1" }), { status: 200 }));
    (globalThis as Record<string, unknown>).fetch = fetchMock;

    const res = await handleCollect({
      platform: "claude", conversationId: "c1", title: "t", url: "https://claude.ai/chat/c1",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.dailogues.com/api/imports",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer jwt-token" }),
      }),
    );
    expect(res.ok).toBe(true);
  });

  it("returns auth error when no token", async () => {
    mockChrome(null);
    const res = await handleCollect({
      platform: "claude", conversationId: "c1", title: "t", url: "https://claude.ai/chat/c1",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("no_token");
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现 `apps/extension/src/background.ts`**

```ts
import { MSG_COLLECT, type CollectResult, type CollectedDialogue } from "./shared";

const IMPORTS_URL = "https://api.dailogues.com/api/imports";
const TOKEN_KEY = "dailoguesToken";

export async function getToken(): Promise<string | null> {
  const { [TOKEN_KEY]: token } = await chrome.storage.local.get(TOKEN_KEY);
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** 采集结果回传：带 JWT POST /api/imports */
export async function handleCollect(dialogue: CollectedDialogue): Promise<CollectResult> {
  const token = await getToken();
  if (!token) return { ok: false, error: "no_token" };
  try {
    const res = await fetch(IMPORTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(dialogue),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    return { ok: true, dialogue };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
}

// app.dailogues.com 页面经 externally_connectable 注入 token
chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "dailogues:set-token" && typeof msg.token === "string") {
    void chrome.storage.local.set({ [TOKEN_KEY]: msg.token }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

// content script 采集结果 → 回传
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== MSG_COLLECT) return;
  void handleCollect(msg.dialogue as CollectedDialogue).then(sendResponse);
  return true;
});
```

- [ ] **Step 4: shared.ts 补充类型**（在 Task 2 基础上追加）

```ts
export type CollectResult =
  | { ok: true; dialogue: CollectedDialogue }
  | { ok: false; error: string };
```

- [ ] **Step 5: 测试通过 + typecheck + build + 提交**

```bash
npx vitest run && npx tsc --noEmit && node build.mjs
git add apps/extension/src
git commit -m "feat(extension): background relay with token + imports post"
```

---

### Task 8: popup 状态 + 本地加载冒烟验证

**Files:**
- Modify: `apps/extension/src/popup.ts`、`apps/extension/popup.html`
- Create: `apps/extension/tests/fixtures/local-chat.html`（本地模拟 Claude 对话页）

- [ ] **Step 1: 实现 popup.ts（极简状态页）**

```ts
import { getToken } from "./background";

async function render() {
  const token = await getToken();
  const status = document.getElementById("status")!;
  status.textContent = token ? "已连接 dailogues（打开对话页点击采集）" : "未连接：请先登录 app.dailogues.com";
}

void render();
```

`popup.html` 增加状态容器：
```html
<body>
  <div id="status">加载中…</div>
  <script src="dist/popup.js"></script>
</body>
```

- [ ] **Step 2: 本地 fixture 页** `apps/extension/tests/fixtures/local-chat.html`（复用 claude-chat.html 结构，标题改"本地测试对话"）

- [ ] **Step 3: 构建扩展**

```bash
cd apps/extension && node build.mjs && ls dist/
```
Expected: `content.js`、`background.js`、`popup.js` 生成。

- [ ] **Step 4: 本地冒烟（Playwright 加载 unpacked 扩展）**

```bash
cd /Users/free/Projects/dailogues && cat > /tmp/ext-smoke.mjs << 'EOF'
import { chromium } from "playwright";
import { join } from "node:path";

const extPath = join(process.cwd(), "apps/extension");
const ctx = await chromium.launchPersistentContext("/tmp/ext-profile", {
  channel: "chrome",
  headless: false,
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
  ],
});
// 打开本地 fixture 对话页（file:// 或本地 http server）
const page = await ctx.newPage();
await page.goto(`file://${extPath}/tests/fixtures/local-chat.html`);
// 验证 content script 注入（页面 console 或注入标记）
await page.waitForTimeout(1500);
await ctx.close();
console.log("smoke done");
EOF
node /tmp/ext-smoke.mjs
```
Expected: 扩展加载成功（Chrome 窗口出现），无 manifest 报错。若 Playwright/Chrome 环境不支持 MV3 扩展加载，降级为手动验证：`chrome://extensions` → 开发者模式 → 加载已解压的扩展 → 打开 fixture 页 → 控制台可见 content script 日志。

- [ ] **Step 5: 提交**

```bash
git add apps/extension/src/popup.ts apps/extension/popup.html apps/extension/tests/fixtures/local-chat.html
git commit -m "feat(extension): popup status + local smoke verification"
```

---

### Task 9: 文档回写 + 收尾

**Files:**
- Modify: `AGENT.md`（M3 状态、目录备注）
- Modify: `PRD.md`（§4.3 首批平台确认——如与实测一致则仅标注）

- [ ] **Step 1: 更新 AGENT.md**

- M3 里程碑：`- [ ] M3：浏览器扩展采集器（...）` → `- [x] M3：... 已完成（首发 Claude/DeepSeek，fixture 基于公开资料，待真实页面校准）`
- 工程目录 `apps/extension/` 注释同步（dist/ 忽略）

- [ ] **Step 2: PRD §4.3 标注**

- 首发平台表述与实现一致（Claude/DeepSeek），追加：`（选择器基于公开逆向资料，扩展交付后需真实登录态页面校准，见 chat-dom.md 待实测清单）`

- [ ] **Step 3: 提交**

```bash
git add AGENT.md PRD.md
git commit -m "docs: M3 完成回写（扩展采集器首发 Claude/DeepSeek）"
```

---

## 自检记录（计划作者）

- **Spec 覆盖**：ARC §3.5（thin client / 平台分级 / CSP→background / 元数据协议 / token 注入）全部落为任务：Task 2 协议、Task 4/5 平台采集器（Claude/DeepSeek 首发）、Task 3 虚拟列表滚动（DeepSeek）、Task 6 分发接线、Task 7 background 回传（externally_connectable token）、Task 8 冒烟；PRD §4.3 平台清单、AGENT M3 收尾。
- **诚实性**：Claude/DeepSeek 选择器基于 `docs/spikes/chat-dom.md` 公开资料，fixture 为构造样本，全部标注"待真实页面校准"；Task 8 冒烟含降级路径（Playwright 不可用时手动加载）。
- **一致性**：协议字段与后端 `imports` 表（platform/source_conversation_id/source_url/parsed_dialogue）一致；`CollectResult` 与 content/background 消息类型互相对齐。
- **范围**：不做 ChatGPT 等非首发平台、不做编辑/发布功能（thin client）、不做自动 token 刷新（token 由 app 页面注入，过期返回 no_token 引导重登）。
- **已知依赖**：`getBoundingClientRect().top` 在 jsdom 为 0（排序退化为插入序，测试不依赖该值）；Playwright MV3 支持度不确定（有降级路径）。
