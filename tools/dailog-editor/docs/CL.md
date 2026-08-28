# CL 采集（Collect）

> **索引**：主文档 `SKILL.md`（定义/触发见主文档）｜ 步骤 CL-STEP-1..3 ｜ 节码 CL-FLOW / CL-IN / CL-GATE / CL-OUT / CL-ERR
> 前置：无（投稿 URL/ID 即输入）｜ 产出对话原文供 SC/TTS/PUB 使用 ｜ 深度参考：`reference/fetch-decoding.md`

**CL-FLOW 流程 / 原则 / CLI 调用逻辑**
```
CL-STEP-1 队列与详情：pnpm editor list / detail <submissionId>（待审队列 / 投稿详情）
CL-STEP-2 采集解码：pnpm editor fetch <submissionId> → 拉取投稿 URL 解码落盘
CL-STEP-3 批量采集：pnpm editor batch [--limit N]（并发提取，已提取跳过）
```
原则：采集只做**提取与解码，不跑任何生成**；解码完成即落盘；完成后呈现列表（ID + 投稿人 + 标题 + URL），
编辑**输入 ID** 即可进入 SC（脚本）制作（采集本身到此完成，属独立功能）。
平台分派 / 代理兜底 / 浏览器兜底 / 解码规则自进化 / 平台经验库：**详见 `reference/fetch-decoding.md`**。

**CL-IN 输入规范与依赖**
- 输入：submissionId 或投稿 URL（粘贴直接触发）；解码必须**消息双全**（user + assistant 都有）才算完整
- **内容过短硬门槛（采集层直接拒审）**：user 轮次 <3 或 总字数 <500 → 直接拒审（原因："Conversation too short: dialogue rounds must exceed 3, and total message length must be greater than 500 characters."——英文，投稿人可见），**不落 dialogue.json 草稿**；批量采集后汇总汇报 ⛔ 组（无需编辑处置）
- 采样：detail 返回 voiceSamples（全部语种）；⚠️ 无采样 = 无法克隆主持人音色（TTS 前置约束）

**CL-GATE 确认门选项与输出模板**
无独立确认门（采集不产出需人工确认的内容）。输出模板（落盘文件）：
```
page.html      # 原始 HTML
page.txt       # 清洗后正文
dialogue.json  # [{role: "user"|"assistant", content}]
```

**CL-OUT 输出物存放与命名标准**
`drafts/{submissionId}/`：`page.html` / `page.txt` / `dialogue.json`（固定命名，不可改名）。

**CL-ERR 错误处理**
- 拉取失败（403/超时/失效）→ 如实汇报，引导编辑走浏览器控制台兜底（console-script → paste）
- 解码规则未命中 → 通用嗅探 → 仍失败则浏览器兜底 + **规则自进化**（rule-test 验证消息双全后 --save 入库，失败规则不沉淀）
- 消息缺一方 → 内容不完整，继续兜底，不得进入下游
- 内容过短（轮次/字数不足）→ 已直接拒审 + 汇报（见 CL-IN 硬门槛），不落草稿
