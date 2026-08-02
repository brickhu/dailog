# 计划 2：技术验证 spike（Fish Audio / 聊天页 DOM 勘察 / 采集方案定稿）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用真实 API/页面验证关键不确定点，产出可执行的决策记录：① **TTS 供应商对比（核心刚需 = 即时克隆质量**：Fish/MiniMax/CosyVoice百炼/硅基流动）；② 各 AI 平台聊天页（登录态）的 DOM 结构与采集可行性勘察；③ 浏览器扩展采集方案的技术要点定稿。

**Architecture:** 全部为**探索性脚本**（`scripts/spikes/` 下的独立 Node 脚本），不进入产品代码。每个 spike 产出「发现文档」（`docs/spikes/*.md`），最后汇总为决策记录并回写 PRD/ARC/AGENT。DOM 勘察在真实浏览器（IAB，用户登录态）中进行。

**Tech Stack:** Node 22 / 原生 fetch / Playwright（已实测：无头被 CF Turnstile 拦截，仅用于记录结论）/ 浏览器扩展（Manifest V3）设计

**前置条件（手动，由用户提供）：**
- TTS 供应商 API Key：Fish Audio + 至少一家国内平台（硅基流动注册送 14 元额度，最省事；MiniMax / 阿里百炼 二选一或全给）
- 克隆参考音频 `sample-voice.wav`（10–30s 干净人声）
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

### Task 2: TTS 供应商对比 spike（核心刚需 = 即时克隆）

> 决策背景：多说话人一次调用**不是刚需**（管线有 ffmpeg 拼接，按角色分批调用兼容）；**核心刚需 = Instant Voice Cloning**——评估维度：克隆质量（相似度+自然度）> 即时克隆模式（A 零样本按需 / B 预注册复刻）> 价格 > 多说话人支持。

**Files:**
- Create: `scripts/spikes/tts-compare/`（providers 适配器 + 统一运行器）
- Create: `docs/spikes/tts-comparison.md`（对比报告，逐步填写）

- [ ] **Step 1: 准备统一测试素材**

- 克隆参考音频 `sample-voice.wav`（10–30s 干净人声，用户提供；建议用注册场景同规格）
- 统一测试文本 `sample-text.json`：模拟真实节目片段——主持人 3 段 + 嘉宾 3 段，中文，含开场白与追问（约 300 字），另附一段英文短句（测跨语言）

```json
{
  "host": [
    "欢迎收听 dailogues，今天我们聊聊如何把 AI 对话变成播客。",
    "那第一件事，你是怎么想到把对话变成节目的？",
    "听起来很酷，最后一个问题：普通人现在能做播客了吗？"
  ],
  "guest": [
    "这个想法很有意思，核心就是把真实的对话变成可订阅的内容。",
    "第一是导入，第二是声音，第三是分发，缺一不可。",
    "当然可以，现在技术门槛已经降到了零。"
  ],
  "english_sample": "Welcome to Dailogues, where your AI conversations become your own podcast."
}
```

- [ ] **Step 2: 写供应商适配器（每供应商一个文件，统一输出约定）**

`scripts/spikes/tts-compare/` 目录结构：

```
tts-compare/
├── run.mjs            # 运行器：读 sample-text.json + 参考音频，逐供应商逐段合成
├── providers/
│   ├── fish.mjs       # Fish Audio：零样本按需（reference_audio）
│   ├── minimax.mjs    # MiniMax：预注册复刻（voice_id）——先跑通"快速复刻"接口
│   ├── cosyvoice.mjs  # 阿里百炼 CosyVoice：预注册复刻
│   └── siliconflow.mjs# 硅基流动：零样本按需（references 参数）
└── out/               # 输出 out-{provider}-{role}-{n}.mp3
```

每个适配器导出 `synthesize({ text, role, referenceAudioPath, outPath })`，统一打印：`status / 耗时 / 计费字符 / 返回格式`。

> 各平台请求体结构以官方文档为准（分别查 `docs.fish.audio`、`platform.minimaxi.com`、`help.aliyun.com/zh/model-studio`、`docs.siliconflow.cn`），适配器骨架先建、字段按文档填写——spike 的本质就是验证这些契约。

- [ ] **Step 3: 逐家跑通并记录**

```bash
cd scripts/spikes/tts-compare
FISH_API_KEY=xxx MINIMAX_API_KEY=xxx SILICONFLOW_API_KEY=xxx node run.mjs
```
记录到 `docs/spikes/tts-comparison.md`：
1. **克隆模式**：零样本按需（A）还是预注册复刻（B）？预注册的流程步骤、时效（MiniMax 临时音色 7 天？）、审核门槛
2. **克隆质量**：主持人段与参考音频的相似度、自然度（主观听感评分 1-5，重点）
3. **成本**：每万汉字单价、每用户克隆一次性成本、免费额度
4. **稳定性**：同文本重复合成 2 次的音色一致性
5. 附带记录：多说话人支持情况（降为参考项）

- [ ] **Step 4: 提交**

```bash
git add scripts/spikes/tts-compare docs/spikes
git commit -m "spike: tts provider comparison (instant cloning focus)"
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
6. **元数据位置**：对话标题（DOM 何处）、对话 ID（URL 还是 DOM）——扩展采集协议 `{ platform, conversation_id, title, url, messages[] }` 需要

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
- 滚动加载策略（虚拟列表逐段加载）→ DOM 解析 → 结构化对话（`[{role, content}]`）+ **元数据**（标题/对话ID/原始URL，协议 `{ platform, conversation_id, title, url, messages[] }`）
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
1. **TTS 供应商定稿**：克隆质量（相似度+自然度）对比结果 → 选定 MVP 供应商 + 克隆模式（A 零样本按需 / B 预注册复刻）→ 决定「用户重录即时生效」还是「预注册音色」流程；自部署 CosyVoice2 的迁移触发条件——更新 ARC §3.3 与 AGENT 速查
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
