# 计划 2：技术验证 spike（Fish Audio / 聊天页 DOM 勘察 / 采集方案定稿）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用真实 API/页面验证关键不确定点，产出可执行的决策记录：① Fish Audio 多说话人 TTS 的请求格式、限额与音质；② 各 AI 平台聊天页（登录态）的 DOM 结构与采集可行性勘察；③ 浏览器扩展采集方案的技术要点定稿。

**Architecture:** 全部为**探索性脚本**（`scripts/spikes/` 下的独立 Node 脚本），不进入产品代码。每个 spike 产出「发现文档」（`docs/spikes/*.md`），最后汇总为决策记录并回写 PRD/ARC/AGENT。DOM 勘察在真实浏览器（IAB，用户登录态）中进行。

**Tech Stack:** Node 22 / 原生 fetch / Playwright（已实测：无头被 CF Turnstile 拦截，仅用于记录结论）/ 浏览器扩展（Manifest V3）设计

**前置条件（手动，由用户提供）：**
- `FISH_API_KEY`（Fish Audio API Key，用户提供）
- 各平台**登录态对话页**访问能力（用户账号登录，用于 DOM 勘察：DeepSeek/Claude 优先，ChatGPT/豆包/Kimi/通义/Gemini 按可用性）
- 本地代理 `127.0.0.1:1081`（SOCKS5，已验证可用）

> 历史：本计划原包含「分享页抓取矩阵」与「无头浏览器过 CF」验证。实测结论（`docs/spikes/headless-cf.md`）：无头浏览器被 Cloudflare Turnstile 拦截；**导入统一改为浏览器扩展采集（登录态）**——分享页抓取与验证码机制随之取消。

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

### Task 3: 各平台聊天页 DOM 勘察（登录态，扩展采集可行性）

**Files:**
- Create: `docs/spikes/chat-dom.md`（发现文档，逐平台记录）

- [ ] **Step 1: 用真实浏览器打开平台对话页（登录态）**

在 IAB（或用户浏览器）登录各平台账号，打开一条真实对话：
- Claude: `claude.ai/chat/*`、DeepSeek: `chat.deepseek.com/chat/*`（优先，用户已有账号）
- ChatGPT / 豆包 / Kimi / 通义 / Gemini：按用户账号可用性补充

- [ ] **Step 2: 逐平台记录 DOM 结构（`docs/spikes/chat-dom.md`）**

用 `domSnapshot` 观察并记录每平台：
1. 对话页 URL 模式（content script 匹配用）
2. 消息块容器结构（用户/助手消息的稳定选择器特征，如 `data-testid`、class 层级）
3. 滚动加载机制（虚拟列表？向上滚动加载历史？需采集的滚动策略）
4. 消息内容形态（纯文本 / markdown / 附件链接；代码块、思考过程是否在 DOM 中）
5. 截断风险（长对话是否按需加载、懒加载占位）

- [ ] **Step 3: 可行性结论**

记录每平台「扩展采集可行性」（高/中/低）与适配要点；识别首个可交付平台（预计 Claude/DeepSeek 先行）。

- [ ] **Step 4: 提交**

```bash
git add docs/spikes
git commit -m "spike: chat page DOM survey for extension collection"
```

---

### Task 4: 采集方案定稿（无头浏览器实测 → 浏览器扩展统一通道）

> **⚠️ 本任务已于 2026-08-02 提前执行完毕**，结论见 `docs/spikes/headless-cf.md`。以下为记录与后续动作。

- [ ] **Step 1: 记录实测结论（已完成，写入 `docs/spikes/headless-cf.md`）**

实测要点（本机住宅 IP + 系统 Chrome headless + 请求拦截）：
- 页面卡在 Cloudflare **Turnstile 交互式质询** 70s 未通过；数据接口 `claude.ai/edge-api/bootstrap` → 403
- 无头 Chrome 指纹（`navigator.webdriver` 等）被 CF 识别，stealth 插件不足以对抗
- **结论：云端无头浏览器方案不可行；导入统一改为浏览器扩展采集（登录态）**——真实性=登录态，验证码机制取消

- [ ] **Step 2: 确认可解析的聊天页 DOM 结构（已在 Task 3 输出）**

在真实浏览器（登录态）打开各平台对话页，确认消息块容器可程序化提取；记录到 `docs/spikes/chat-dom.md`（与 Task 3 共用）。

- [ ] **Step 3: 设计扩展技术要点（写入 `docs/spikes/headless-cf.md`）**

- Manifest V3；content script 按平台对话页 URL 匹配（`claude.ai/chat/*`、`chatgpt.com/c/*`、`chat.deepseek.com/chat/*` 等）
- 滚动加载策略（虚拟列表逐段加载）→ DOM 解析 → 结构化对话（`[{role, content}]`）
- POST 回 `api.dailogues.com`；会话鉴权：登录态 token 由 app 站点页注入 `chrome.storage`
- 扩展定位 = 采集器（thin client）：仅采集 + 回传，编辑/生成/发布留在 SPA

- [ ] **Step 4: 提交**

```bash
git add docs/spikes
git commit -m "spike: headless vs cloudflare conclusion - extension as slow path"
```

---

### Task 5: 决策定稿并回写文档

**Files:**
- Modify: `docs/spikes/*.md`（汇总）
- Modify: `PRD.md` / `ARC.md` / `AGENT.md`（按结论回写）

- [ ] **Step 1: 汇总决策记录**（写入 `docs/spikes/README.md` 或各发现文档顶部）

覆盖以下决策点，每条给出结论与依据：
1. **Fish Audio 集成形态**：多说话人一次调用是否成立？参考音频传法（base64/reference_id）？单请求字符上限 → 决定管线是「一次调用」还是「分批 + ffmpeg 拼接」；主持人克隆音色的 reference_id 是否需要在用户录音后「注册音色」再使用
2. **MVP 平台清单**：聊天页 DOM 勘察结果 → 扩展采集器首批适配平台（预计 Claude/DeepSeek 先行）与 URL 匹配模式——更新 PRD §4.3 与 AGENT 速查
3. **扩展采集方案定稿**：Manifest V3 技术要点（content script 平台匹配 / 滚动策略 / DOM 解析 / 鉴权注入 / thin client 定位）已记录于 `docs/spikes/headless-cf.md` 与 `docs/spikes/chat-dom.md`
4. **验证码机制**：已随「扩展登录态采集」取消（真实性=登录态），无需验证

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

- **Spec 覆盖**：PRD §4.3（扩展统一采集）、ARC §3.5（采集与导入）与 §9 风险表（页面改版/商店审核）的验证任务全部覆盖；AGENT M1/M3 spike 前置要求满足。
- **一致性**：spike 脚本与产品侧类型无关（独立脚本目录）；Task 5 回写路径明确。
- **诚实性**：Fish Audio 请求体为骨架 + 文档查证步骤（spike 的本质就是发现 API 契约，无法预写确定格式）；DOM 勘察逐平台实测，不预设结论。
- **已知依赖**：Fish API Key、各平台登录态账号（DOM 勘察）、本地代理——均为用户提供的前置条件，已在头部列出。
