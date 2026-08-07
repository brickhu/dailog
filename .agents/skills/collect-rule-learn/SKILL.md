---
name: collect-rule-learn
description: >
  dailog 采集扩展的逆向规则学习与发布（一条龙）。用户发送 AI 对话平台
  （ChatGPT/Claude/DeepSeek/Doubao 等）的 DOM 结构（粘贴 HTML 或给出文件路径）时，
  分析页面结构 → 生成/校准 collect-rules.json 的 CollectRule → 写 fixture 回归测试验证
  → 更新规则文件 → commit + push（jsDelivr CDN 生效）。规则失效维护走此流程。
triggers:
  - 学习采集规则
  - 生成采集规则
  - 逆向规则
  - 采集规则
  - 规则校准
  - 更新规则
  - 规则失效
  - 采集失败
  - DOM 逆向
  - DOM 结构
  - collect rule
  - learn rule
  - 逆向
---

# Collect Rule Learn · dailog 采集逆向规则（一条龙）

dailog 浏览器扩展采集 AI 对话：本地专有解析器失败时，fallback 到远程托管规则
（`collect-rules.json`，jsDelivr CDN）。规则由选择器驱动、通用解析器 `parseByRule` 消费。
本 Skill：用户发来某平台的对话页 DOM → 逆向出规则 → 测试验证 → 提交发布，全程一次完成。

## 规则文件与分发

- **规则文件**：`/Users/free/Projects/dailogues/collect-rules.json`（仓库根目录）
- **CDN 地址**：`https://cdn.jsdelivr.net/gh/brickhu/dailog@dev/collect-rules.json`
  —— `@dev` = 仓库 dev 分支；**push 后几分钟内 CDN 生效**
- **扩展拉取**：background 侧 `MSG_GET_RULES`，10 分钟 TTL 缓存；**访问平台页面时静默预热**
  （`warmRulesCache`，tabs.onUpdated 触发）→ 规则更新后用户下次打开该平台页面即生效，
  session 内复用缓存

### Schema（与 `apps/extension/src/shared.ts` 的 `CollectRule` 一致）

```jsonc
{
  "version": 7,                              // 每次修改 +1
  "note": "本次变更说明：平台、实测日期、选择器依据",
  "platforms": {
    "chatgpt": {
      "url": {                               // 可选：URL 形态（平台分发依据）
        "host": "chatgpt.com"                //   域名（hostname，无端口）——分发唯一依据
      },
      "messageSelector": null,               // 可选：消息作用域容器，缺省 = 整页
      "userSelector": "[data-message-author-role='user']",       // 必填
      "assistantSelector": "[data-message-author-role='assistant']", // 必填
      "contentSelector": ".markdown",        // 可选：取文本的子节点，缺省 = 节点自身
      "titleSelector": null,                 // 预留
      "scrollContainer": null                // 预留（v1 解析器不消费）
    }
  }
}
```

Platform 枚举：`claude / deepseek / chatgpt / gemini / kimi / doubao / tongyi / plain`。
`url` 字段全可选——缺失时扩展回退内置默认表（域名→平台），旧规则/测试 fixture 不受影响。
**对话页判定已通用化**（v7 起）：不再按平台记录路径——URL 启发式（路径 ≥2 段 + 末端是
ID 形态：6+ 位、含数字或连字符）+ DOM 对话框兜底（textarea/contenteditable），平台改路径
无需改规则。

## 执行语义（规则必须与解析器行为一致）

`parseByRule`（`apps/extension/src/content/rule-parser.ts`）：

1. 作用域：`messageSelector` 存在 → 每个匹配元素作 scope；否则整页
2. 每个 scope 内 `querySelectorAll(`${userSelector}, ${assistantSelector}`)`，按文档序
3. 角色判定：`el.matches(userSelector)` → user；否则 `el.matches(assistantSelector)` → assistant
4. 取文本：`contentSelector` 存在 → `el.querySelector(contentSelector) ?? el`；
   `normalizeMessageText`（保留换行与行首缩进、清行尾空白、折叠多余空行、整体 trim）
5. 空内容跳过；一条都没匹配到 → 返回 null → 上层走**整页文本兜底（lowConfidence）**

⚠️ **完整性红线**：结构化结果必须同时含 user 和 assistant 消息。只有 user 没有 assistant
会被 completeness check 判定失效 → 整页文本兜底。规则失效不丢用户内容，但结构化质量降级。

## 平台经验库（已积累的事实，别重复踩）

| 平台 | 已知选择器 | 状态 |
|---|---|---|
| chatgpt | `div[data-message-author-role='user'/'assistant']` + `.markdown` | ✅ 实测校准 2026-08-07（**是 div 不是 article**） |
| deepseek | `div.ds-message` 容器（user/assistant 共用）+ `.ds-assistant-message-main-content`（assistant 语义类）；滚动容器 `.ds-scroll-area` | ✅ 实测校准 2026-08-07（`data-message-author-role` **已移除**；URL 改版 `/a/chat/s/{uuid}`） |
| claude | `div[role='article']` 作用域 + `[data-testid='user-message']`；assistant 无 data-testid，正文 `div.font-claude-response > .standard-markdown` | ✅ 实测校准 2026-08-07（旧 `[data-testid='assistant-message']` **真实 DOM 失配**） |
| doubao | `[data-message-author-role]` | ⚠️ 占位规则，**未实测验证** |
| gemini/kimi/tongyi | 无（仅 url.host） | 待首次学习 |

其它经验：
- **chatgpt 分享页/长对话**：对话内容可能在 RSC flight 载荷里（CSS 选择器拿不到）——
  完整 RSC 解码知识见 `/Users/free/Projects/dailogues/chatgpt-rsc-full.md`（flat 数组 +
  `{"_N": idx}` 双索引引用、消息元组、parts 数组、按 flat 索引倒序 = 时间正序、-5 = undefined）
- 长对话平台是虚拟列表/懒加载：滚动采集、打印式撑开由扩展本地逻辑负责，规则层面不用管
- user 与 assistant 结构常不同（user 无内容容器、assistant 有 .markdown）——contentSelector
  只命中 assistant 是正常的
- **URL 判定已通用化**（v7）：对话页 = 路径 ≥2 段 + 末端 ID 形态，或页面有对话框
  （textarea/contenteditable）。平台改路径不再影响判定，**无需校准 URL 规则**——
  只需在收到 DOM 时顺带确认 URL 形态（供记录，不再比对规则）
- **容器型 userSelector**（如 deepseek 的 `div.ds-message` 同时包住两种角色）：parseByRule
  判定「user 节点嵌套包含 assistant 匹配 → 不当 user，由内层承接」，选择器可放心用容器

## 工作流（一条龙）

```
用户发送 DOM（粘贴 HTML / 文件路径）
  ↓ ① 确认平台与输入 + 顺带确认 URL 形态（记录用；对话页判定已通用化）
  ↓ ② 逆向分析：定位消息节点、角色标识、内容容器
  ↓ ③ 产出 CollectRule JSON
  ↓ ④ 落地 fixture + 回归测试（新增或校准）
  ↓ ⑤ vitest 全绿（含既有测试）
  ↓ ⑥ 更新 collect-rules.json（version+1、note 说明）
  ↓ ⑦ commit → push origin dev → CDN 生效（分钟级）
```

### ① 输入处理

- **顺带确认 URL 形态**：向业务人员索取当前对话页**地址栏完整 URL**（或让其确认地址栏形态，
  如 `chat.deepseek.com/a/chat/s/…`）。**对话页判定已通用化，URL 不需要比对/校准规则**——
  仅用于记录（经验库 URL 列）与平台分发（host 域名级）；无法取得 URL 时在汇报中标注「URL 未经确认」
- 粘贴 HTML → 保存到 `/tmp/rule-sample-{platform}.html` 备用；粘贴过程可能被聊天窗口
  转义/截断——先检查关键 attribute（如 `data-message-author-role`）是否完整
- 文件路径 → 直接读取
- 平台判定：URL 或内容特征。URL 由规则 `url.host` 域名匹配（`resolvePlatform`），缺省回退
  内置默认表：`claude.ai`→claude，`chat.deepseek.com`→deepseek，`chatgpt.com`→chatgpt，
  `www.doubao.com`→doubao，`gemini.google.com`→gemini，`kimi.moonshot.cn`→kimi，
  `www.tongyi.com`→tongyi

### ② 逆向分析要点

1. 找**消息节点**：单个对话消息的容器元素
2. 角色标识：优先稳定 attribute（`data-message-author-role` / `data-testid`），
   **不要用 react 生成的 class**（每次构建都可能变）
3. 找**内容容器**：assistant 消息正文的子容器（.markdown / .ds-markdown 之类）
4. **容器型 userSelector**（如 deepseek 的 `div.ds-message` 同时包住 user/assistant）可用——
   parseByRule 会跳过「嵌套包含 assistant 匹配」的 user 候选，由内层 assistant 节点承接
5. 若 CSS 可匹配直接出选择器；若内容埋在 RSC payload → 按经验库处理并向用户说明取舍

### ③ 产出检查单

- [ ] 选择器在样本 DOM 上能**同时**匹配 user 与 assistant
- [ ] contentSelector 取到的是正文，不是头像/时间/操作按钮
- [ ] 不用索引选择器（`:nth-child`）——虚拟列表/懒加载下不稳定
- [ ] 风格与既有规则一致（裸 attribute 选择器优先）
- [ ] `url.host` 已配（域名分发依据）；无需配置对话页路径/会话 id 正则（已通用化）

### ④ fixture + 回归测试（照抄 `chatgpt-real.test.ts` 模式）

- **fixture**：`apps/extension/tests/fixtures/{platform}-real.html`
  —— 真实 DOM 采样。结构必须保真（选择器相关 attribute 原样保留）；正文文本可替换为
  占位符脱敏。校准已有平台时**更新既有 fixture**，不新建同名文件
- **测试**：`apps/extension/tests/parsers/{platform}-rule.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseByRule } from "../../src/content/rule-parser";

const html = readFileSync(join(import.meta.dirname, "../fixtures/xxx-real.html"), "utf-8");

describe("xxx 规则（真实 DOM fixture 回归）", () => {
  it("提取 user + assistant 消息及内容", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const msgs = parseByRule(doc, { userSelector, assistantSelector, contentSelector });
    expect(msgs).not.toBeNull();
    expect(msgs?.map((m) => m.role)).toEqual(["user", "assistant", ...]);
    expect(msgs?.[0].content).toContain("...");
  });
});
```

校准既有平台 → 在既有测试文件里补断言。

### ⑤ 运行测试

```bash
cd /Users/free/Projects/dailogues/apps/extension && pnpm test
```

全绿才算通过（含既有 70+ 测试，不能只过新测试）。单个文件：
`pnpm vitest run tests/parsers/{name}.test.ts`

### ⑥ 更新 collect-rules.json

- `version` +1；`note` 写明：平台、实测日期、选择器依据
- 保持 platforms 键序稳定

### ⑦ 提交

- commit（conventional）：新增平台 `feat(extension): 新增 {platform} 采集规则（实测 ...）`；
  校准 `fix(extension): 校准 {platform} 采集规则（...）`
- push `origin dev`（jsDelivr 用的是 @dev 分支）
- 用户已明确要求「提交一条龙」时直接 commit + push；否则停在 commit，说明 CDN 生效机制并等确认

## 红线

1. **不凭猜测写选择器**——必须基于真实 DOM 采样（chatgpt article vs div 的教训）
2. 选择器必须稳定 attribute，不依赖 react class / 索引
3. 新增或校准规则必须配套回归测试且全绿——没测试不许提交
4. fixture 保留真实结构，脱敏只改正文文本
5. 不迁就规则去改 collector/parser 逻辑——规则实在无法表达时，向用户说明取舍（如走 RSC 解码器）
