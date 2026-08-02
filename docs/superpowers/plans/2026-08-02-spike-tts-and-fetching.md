# 计划 2：三合一技术验证 spike（Fish Audio / 抓取矩阵 / 无头浏览器过 CF）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用真实 API/页面验证三个关键不确定点，产出可执行的决策记录：① Fish Audio 多说话人 TTS 的请求格式、限额与音质；② 各 AI 平台分享链接的抓取可行性矩阵；③ 无头浏览器能否稳定通过 Claude 的 Cloudflare 质询。

**Architecture:** 全部为**探索性脚本**（`scripts/spikes/` 下的独立 Node 脚本），不进入产品代码。每个 spike 产出「发现文档」（`docs/spikes/*.md`），最后汇总为决策记录并回写 PRD/ARC/AGENT。无头浏览器用 Playwright + stealth 插件，本地验证（依赖用户机器上的 SOCKS 代理 127.0.0.1:1081 访问被墙平台）。

**Tech Stack:** Node 22 / 原生 fetch / Playwright / puppeteer-extra-plugin-stealth / 本地 SOCKS 代理

**前置条件（手动，由用户提供）：**
- `FISH_API_KEY`（Fish Audio API Key，用户提供）
- 各平台真实分享链接样本：DeepSeek ✅（已有 `https://chat.deepseek.com/share/643cljtxqilx2oir6x`）；**Doubao / Kimi / 通义 / Gemini / ChatGPT 各 1–2 条（用户提供）**
- 本地代理 `127.0.0.1:1081`（SOCKS5，已验证可用）
- 若 npm 安装被墙：`export HTTPS_PROXY=socks5://127.0.0.1:1081`（Playwright 浏览器下载同样生效）

---

### Task 1: spike 脚本环境

**Files:**
- Create: `scripts/spikes/package.json`
- Create: `scripts/spikes/.env.example`
- Create: `scripts/spikes/README.md`

- [ ] **Step 1: 创建 `scripts/spikes/package.json`**

```json
{
  "name": "@dailogues/spikes",
  "private": true,
  "type": "module",
  "scripts": {
    "fish": "node fish-multi-speaker.mjs",
    "matrix": "node fetch-matrix.mjs",
    "headless": "node headless-cf.mjs"
  },
  "dependencies": {
    "playwright": "^1.49.0",
    "playwright-extra": "^3.3.0",
    "puppeteer-extra-plugin-stealth": "^2.11.0"
  }
}
```

- [ ] **Step 2: 创建 `scripts/spikes/.env.example`**

```bash
FISH_API_KEY=your_fish_audio_api_key
FISH_REFERENCE_FILE=./sample-voice.wav      # 主持人克隆参考音频（用户录音样本）
FISH_GUEST_REFERENCE_ID=                    # 嘉宾固定音色 reference_id（从 Fish Audio 控制台获取）
CLAUDE_SAMPLE_URL=https://claude.ai/share/<uuid>
DEEPSEEK_SAMPLE_URL=https://chat.deepseek.com/share/<id>
PROXY_URL=socks5://127.0.0.1:1081
```

- [ ] **Step 3: 创建 `scripts/spikes/README.md`**（记录三条命令、env 说明、代理说明）

- [ ] **Step 4: 安装依赖并提交**

```bash
cd scripts/spikes && pnpm install   # 若被墙先 export HTTPS_PROXY=socks5://127.0.0.1:1081
cd /Users/free/Projects/dailogues && git add scripts/spikes
git commit -m "chore(spikes): spike script environment"
```

> 浏览器二进制：Task 4 首次运行时 `npx playwright install chromium` 下载（同样走代理 env）。

---

### Task 2: Fish Audio 多说话人 spike

**Files:**
- Create: `scripts/spikes/fish-multi-speaker.mjs`
- Create: `docs/spikes/fish-audio.md`（发现文档，逐步填写）

- [ ] **Step 1: 查文档确认请求格式**

用 WebFetch 打开 Fish Audio API 文档（`https://fish.audio/api/`，如失效则搜 "Fish Audio TTS API multi speaker reference_audio"），确认：
1. 多说话人请求的确切结构（预计为 `text` 数组 / `chunks` 数组，每项带 `text` + `reference_id` 或 `reference_audio`）
2. 鉴权方式（Bearer token 或 JWT）
3. 返回值（单文件音频流？分段数组？）、支持格式与采样率参数
4. 单请求最大字符数

将结论先记入 `docs/spikes/fish-audio.md`。

- [ ] **Step 2: 写多说话人调用脚本（骨架，按 Step 1 结论修正请求体）**

```js
// scripts/spikes/fish-multi-speaker.mjs
import { readFile, writeFile } from "node:fs/promises";

const API_KEY = process.env.FISH_API_KEY;
if (!API_KEY) throw new Error("FISH_API_KEY 未设置");

const REFERENCE_FILE = process.env.FISH_REFERENCE_FILE;      // 主持人克隆参考音频
const GUEST_REFERENCE_ID = process.env.FISH_GUEST_REFERENCE_ID; // 嘉宾固定音色

// 多说话人对话样本：3 段（主持/嘉宾/主持）
const segments = [
  { speaker: "host",  text: "欢迎收听 dailogues，今天我们聊聊如何把 AI 对话变成播客。" },
  { speaker: "guest", text: "这个想法很有意思，聊聊它的核心难点吧。" },
  { speaker: "host",  text: "第一是导入，第二是声音，第三是分发。" },
];

// 构建请求体：按 Fish Audio 文档修正此处结构（多说话人通常为 chunks/text 数组）
const body = {
  // TODO(spike): 按 Step 1 文档结论填写多说话人结构
  chunks: segments.map((s) => ({
    text: s.text,
    ...(s.speaker === "host"
      ? { reference_audio: undefined /* 替换为文件 base64 或上传后 reference_id */ }
      : { reference_id: GUEST_REFERENCE_ID }),
  })),
  format: "mp3",
};

const res = await fetch("https://api.fish.audio/v1/tts", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

console.log("status:", res.status);
for (const [k, v] of res.headers) console.log(`header ${k}: ${v}`);

const buf = Buffer.from(await res.arrayBuffer());
await writeFile("out-multi-speaker.mp3", buf);
console.log("saved out-multi-speaker.mp3, bytes:", buf.length);
```

> 如果 Fish Audio 需要 `reference_audio` 为已上传的 reference_id，先用控制台创建主持人音色获得 reference_id，替换脚本中的 `reference_audio` 分支。

- [ ] **Step 3: 运行并记录**

```bash
cd scripts/spikes && export FISH_API_KEY=xxx FISH_GUEST_REFERENCE_ID=xxx && pnpm fish
```
Expected: 返回音频或明确错误。记录到 `docs/spikes/fish-audio.md`：
- 请求体最终结构（含参考音频如何传：base64 / reference_id）
- 返回形态：单 MP3 文件？分片数组？时长是否等于三段时间和
- 音质：克隆音色 vs 固定音色在同一音频里的切换是否自然（听 `out-multi-speaker.mp3`）
- 单请求字符上限：用脚本把一段 3000 / 6000 / 12000 字的文本逐档请求，记录上限与错误信息
- 计费确认：按字符计费的具体口径（文档）

- [ ] **Step 4: 提交**

```bash
git add scripts/spikes docs/spikes
git commit -m "spike: fish audio multi-speaker findings"
```

---

### Task 3: 快路径抓取矩阵（api-fetcher 可行性）

**Files:**
- Create: `scripts/spikes/fetch-matrix.mjs`
- Create: `docs/spikes/fetch-matrix.md`（发现文档，矩阵表）

- [ ] **Step 1: 写矩阵脚本（含已验证的 DeepSeek 参考实现）**

```js
// scripts/spikes/fetch-matrix.mjs
// 用法: FISH_API_KEY 无关；读取 SAMPLES 数组，逐个尝试抓取并记录结果
const SAMPLES = [
  { platform: "deepseek", url: process.env.DEEPSEEK_SAMPLE_URL },
  // 用户提供样本后填入：
  // { platform: "chatgpt", url: "https://chatgpt.com/share/<uuid>" },
  // { platform: "doubao", url: "https://www.doubao.com/share/..." },
  // { platform: "kimi", url: "https://kimi.moonshot.cn/share/..." },
  // { platform: "tongyi", url: "..." },
  // { platform: "gemini", url: "https://gemini.google.com/share/..." },
];

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function extractShareId(platform, url) {
  // 各平台 share_id 提取规则，按平台填写（DeepSeek 示例：/share/<id>）
  const m = url.match(/\/share\/([^/?#]+)/);
  return m ? m[1] : null;
}

async function fetchDeepSeek(shareId) {
  // 已验证：GET /api/v0/share/content?share_id=，需浏览器头
  const res = await fetch(`https://chat.deepseek.com/api/v0/share/content?share_id=${shareId}`, {
    headers: {
      "User-Agent": UA,
      "Referer": `https://chat.deepseek.com/share/${shareId}`,
      "Accept": "application/json",
      "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    },
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 200), contentType: res.headers.get("content-type") };
}

// 其余平台实现按同一模式添加：fetchHtml / 找 API / 记录 WAF 特征
const FETCHERS = { deepseek: fetchDeepSeek };

for (const sample of SAMPLES.filter((s) => s.url)) {
  const id = extractShareId(sample.platform, sample.url);
  console.log(`\n=== ${sample.platform} (id: ${id}) ===`);
  try {
    const r = await FETCHERS[sample.platform](id);
    console.log("status:", r.status, "| content-type:", r.contentType);
    console.log("body 前200字:", r.body.replace(/\n/g, " "));
  } catch (e) {
    console.log("ERROR:", e.message);
  }
}
```

- [ ] **Step 2: 运行（DeepSeek 参考用例）**

```bash
cd scripts/spikes && DEEPSEEK_SAMPLE_URL=https://chat.deepseek.com/share/643cljtxqilx2oir6x pnpm matrix
```
Expected: deepseek 行输出 `status: 200` 与对话 JSON 前 200 字。

- [ ] **Step 3: 加入用户提供的样本链接，逐个平台实测**

将用户提供的各平台链接填入 `SAMPLES`，对每个平台：
1. 先 curl 分享页 HTML（记录：SSR 含内容 / SPA 外壳 / WAF 特征页）
2. 若 SPA 外壳：下载主 JS bundle，grep `api/` + `share` 找数据接口，按 DeepSeek 模式直调
3. 记录结果到 `docs/spikes/fetch-matrix.md` 矩阵表：

| 平台 | 页面类型 | 数据接口 | curl 可行 | 说明 |

- [ ] **Step 4: 提交**

```bash
git add scripts/spikes docs/spikes
git commit -m "spike: fetch matrix findings"
```

---

### Task 4: 慢路径无头浏览器过 CF 验证（Claude）

**Files:**
- Create: `scripts/spikes/headless-cf.mjs`
- Create: `docs/spikes/headless-cf.md`（发现文档）

- [ ] **Step 1: 安装 Playwright 浏览器（走代理）**

```bash
cd scripts/spikes
export HTTPS_PROXY=socks5://127.0.0.1:1081
npx playwright install chromium
```

- [ ] **Step 2: 写无头抓取脚本（Playwright + stealth）**

```js
// scripts/spikes/headless-cf.mjs
// 用法: CLAUDE_SAMPLE_URL=... pnpm headless
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

const URL = process.env.CLAUDE_SAMPLE_URL;
if (!URL) throw new Error("CLAUDE_SAMPLE_URL 未设置");

const proxy = process.env.PROXY_URL; // socks5://127.0.0.1:1081

const browser = await chromium.launch({
  headless: true,
  args: proxy ? [`--proxy-server=${proxy}`] : [],
});
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
});

const t0 = Date.now();
try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  // 等待对话渲染：轮询页面文本长度（最多 60s）
  for (let i = 0; i < 60; i++) {
    const text = await page.evaluate(() => document.body?.innerText?.length ?? 0);
    if (text > 500) break;
    await page.waitForTimeout(1000);
  }
  const title = await page.title();
  const text = (await page.evaluate(() => document.body?.innerText ?? "")).slice(0, 500);
  console.log("耗时(ms):", Date.now() - t0);
  console.log("title:", title);
  console.log("页面文本前500字:", text.replace(/\n/g, " ").slice(0, 500));
  console.log("含质询页特征:", text.includes("Just a moment") || text.includes("验证"));
  // 提取对话结构：记录 DOM 中的用户/助手消息块数量（按页面实际结构观察后调整）
} catch (e) {
  console.log("ERROR:", e.message);
} finally {
  await browser.close();
}
```

> 注：`page.evaluate` 在此处为**本地脚本**（非 IAB 约束），可自由执行 DOM 读取。

- [ ] **Step 3: 运行并记录**

```bash
cd scripts/spikes && CLAUDE_SAMPLE_URL=https://claude.ai/share/6cc0f373-72c5-4afd-a223-98471688e736 pnpm headless
```
Expected: 对话渲染成功（标题 + 内容前 500 字）或卡在 CF 质询。记录到 `docs/spikes/headless-cf.md`：
- 是否通过质询；耗时（秒）
- 无头模式 vs 有头模式差异（如有必要对比）
- 页面结构：消息块的可提取性（DOM 结构、是否方便转结构化对话）
- 连续运行 5 次的稳定性（间隔 30s）

- [ ] **Step 4: 提交**

```bash
git add scripts/spikes docs/spikes
git commit -m "spike: headless browser vs cloudflare findings"
```

---

### Task 5: 决策定稿并回写文档

**Files:**
- Modify: `docs/spikes/*.md`（汇总）
- Modify: `PRD.md` / `ARC.md` / `AGENT.md`（按结论回写）

- [ ] **Step 1: 汇总决策记录**（写入 `docs/spikes/README.md` 或各发现文档顶部）

覆盖以下决策点，每条给出结论与依据：
1. **Fish Audio 集成形态**：多说话人一次调用是否成立？参考音频传法（base64/reference_id）？单请求字符上限 → 决定管线是「一次调用」还是「分批 + ffmpeg 拼接」；主持人克隆音色的 reference_id 是否需要在用户录音后「注册音色」再使用
2. **MVP 平台清单**：快路径平台（API 直取，验证码方案）、慢路径平台（无头浏览器，Claude）、暂缓平台——更新 PRD §4.3 与 AGENT 速查
3. **browser-fetcher 服务规格**：若无头可行——单实例内存需求（实测峰值）、部署形态（Fly ≥1GB 按需唤醒，成本 ~$5–10/月）与 API 契约（`POST /fetch {url} -> {html|dialogue}`）；若不可行——浏览器扩展兜底方案评估
4. **验证码机制**：确认在快/慢路径下均可实施（抓取内容统一为结构化对话后做字符串匹配）

- [ ] **Step 2: 回写 PRD/ARC/AGENT**

按 Step 1 结论更新（重点）：
- PRD §4.3 平台清单与「Claude 可行性以 spike 为准」表述 → 替换为实测结论
- ARC §3.5 双路径细节（browser-fetcher 规格、API 契约）
- AGENT 速查 + M3 里程碑措辞

- [ ] **Step 3: 提交**

```bash
git add docs/ PRD.md ARC.md AGENT.md
git commit -m "docs: spike 结论回写（平台清单/抓取架构/Fish Audio 集成形态）"
```

---

## 自检记录（计划作者）

- **Spec 覆盖**：PRD §4.3（平台/双路径）、ARC §3.5（双路径抓取 + 验证码）与 §9 风险表（CF 风控）的验证任务全部覆盖；AGENT M1/M3 spike 前置要求满足。
- **一致性**：spike 脚本与产品侧类型无关（独立脚本目录）；Task 5 回写路径明确。
- **诚实性**：Fish Audio 请求体为骨架 + 文档查证步骤（spike 的本质就是发现 API 契约，无法预写确定格式）；各平台抓取实现逐一实测，不预设结论。
- **已知依赖**：Fish API Key、各平台样本链接、本地代理——均为用户提供的前置条件，已在头部列出。
