# SC 脚本（Script）

> **索引**：主文档 `SKILL.md`（定义/触发见主文档）｜ 步骤 SC-STEP-1..2 ｜ 确认门 SC-GATE-1..2 ｜
> 节码 SC-FLOW / SC-IN / SC-GATE / SC-OUT / SC-ERR
> 前置：CL-STEP-2（dialogue.json 已落盘）+ detail 的 callName ｜ 后续：TTS-STEP-1（终稿 script.json）
> 子代理 prompt 模板：`reference/subagent-templates.md`（SC-STEP-1/2 + PUB-STEP-2）

**SC-FLOW 流程 / 原则 / CLI 调用逻辑**
> **为什么用子代理**：对话原文（15-20k tokens）与提示词文件（合计 ~14k tokens）只进子代理上下文；
> 结果由子代理**直接写盘**，主会话只收一行校验摘要；展示内容从草稿文件读出放回复正文。
> 单期主会话增量 ~15-25k。（<skillDir>=.agents/skills/dailog-editor，<drafts>=.dailog-editor/drafts）。

| 步骤 | 子代理 | 输入 | 输出（写盘） | 确认门 |
|---|---|---|---|---|
| SC-STEP-1 选题方向（审稿+选题） | `dailog-select` | selection.md + dialogue.json + 节目建议 | selection.json（content_summary + ideas[1..N] 各带 score）或 quality.json | SC-GATE-1 选题 |
| SC-STEP-2 脚本生成（内容 + 听感打磨） | `dailog-draft` | draft.md + chosen-idea.json + dialogue.json + selection.json | script.json（终稿带标签 + reference_items + optimization_summary） | SC-GATE-2 终稿 |

原则：
- **打回重跑**：听感反馈（呈现层）与结构反馈（换角度/切主题/加删回合）→ 均重跑 SC-STEP-2（dailog-draft，prompt 追加修订指令）；
  换选题角度 → 回 SC-STEP-1 重新选号。**编辑反馈先落盘再重跑**：收到听感/结构反馈（含说明）时，先用
  `pnpm editor feedback add` 落盘一条（issue/reason/change；编辑说「以后都要」→ --general）——修订指令只
  作用于本期重跑，落盘让意见跨期沉淀（见 FB 分册；蒸馏沉淀规则须编辑审批，不自动进提示词）。
- **内容规范以提示词文件为准**（主会话不重复载入）：`prompts/selection.md`（SC-STEP-1：选题打分器强度闸门 <60 拒稿 + G1-G5 闸门 + 时刻门 +
  逻辑骨架 + 价值维度 + 思路打分排序）；`prompts/draft.md`（SC-STEP-2：创作原则（核心思想/好的脚本/坏的脚本/去噪）+ 写作结构（点题/对话）+ 情绪/停顿/穿插设计 → 终稿；维度差异由 chosen-idea 创作建议承载）；
  `prompts/meta.md`（PUB-STEP-2 发布）
- **提示词保真**：提示词文件由**生成子代理原样读取**作为系统提示词，任何人不许改写压缩
- **节目建议（角度锚点）**：detail 的「节目建议」是用户呈现意图的最强信号——SC-STEP-1 以它为角度约束
  （时刻与骨架落在建议路径上），冲突取舍融进创作建议；SC-STEP-2 经 chosen-idea.json 的创作建议继承，角度不得偏离

**SC-IN 输入规范与依赖**
- 前置依赖：`dialogue.json` 已在草稿目录（来自 CL-STEP-2 采集）；`callName` 从 detail 注入（无则「主持人」，语言不同按 draft.md 点题段落的称呼改写转写）
- 每步输入 = 上表「输入」列；SC-GATE-1 选号 N 后主会话把 ideas[N-1] 写入 `chosen-idea.json`（角度锚点，SC-STEP-2 输入）

**SC-GATE 确认门选项与输出模板**
> **交互**：选项编号呈现，编辑点击/回复编号即可；修改类选项附一句说明。
> **呈现通道红线（所有环境通用，GUI 尤甚）**：一切面向编辑的展示——内容概括 / 选题思路 / **脚本终稿
> 全文** / 配套产物 / 封面图（Read 图片） / 节目元数据——**必须出现在 agent 回复正文**（脚本全文单个 code block 整篇）；
> **禁止用工具输出（console.log / 命令 stdout / 子代理返回）承载展示**。子代理 JSON 直接写盘，主会话不打印全文。

```
两关逐关确认，打回即重跑 SC-STEP-2；全部通过才进 TTS（TTS-STEP-1）。
（元数据属发布层：PUB-GATE-1 发布确认门与封面/试听一并确认。）

SC-GATE-1 选题确认门（SC-STEP-1 pass 后）：
  · 展示（回复正文）：**节目建议原文（有则直接呈现，逐字/原意——编辑选号的对照基准，置顶）** +
    原文内容概括（3-5 句）+ 选题思路列表（1-N 个：每个：选题分类 + 选题逻辑（**含建议贴合度**：采纳/部分采纳/冲突+理由）
    + 听众价值 + 得分 + 创作建议（可改），推荐标 ⭐）——编辑对照建议原文核验贴合度后选号
  · **主持人称呼（callName）补录**：detail 显示「主持人称呼：无」→ 先询问编辑本期主持人的称呼（如 飞），
    用 `pnpm editor callname <submissionId> --name "飞"` 持久化到投稿，再拼装 role_block 的 {callName}——
    避免每次重新生成都回退「主持人」（老投稿 call_name 常为空，见 2026-08-28 挂谷猜想实例）
  · **选题反馈落盘（审美进化）**：编辑拒稿或修改思路（附说明）时，先用 `pnpm editor feedback add --stage selection`
    落盘一条（类别：门槛|价值|角度|维度|标题|其他；编辑说「以后都要」→ --general）——AI 选题判断与编辑审美
    的偏差跨期沉淀，蒸馏后进化 selection.md（见 FB 分册）
  · 选项（统一选号格式，见 RULES-10，一项一行）：
    `[1..N] : ✅ 选第 N 个思路`
    `[R] : ❌ 拒稿 → 见 REJ`
    `[M] : ✏️ 修改（附说明重跑 SC-STEP-1）`
SC-GATE-2 终稿确认门（SC-STEP-2 生成后）：
  · 展示：终稿全文（单个 code block 整篇）+ 优化总结（optimization_summary，逐条）+ 摘要（script-preview）作附加信息
  · 嘉宾声线预检：进 TTS 前 pnpm editor guests 确认目标嘉宾（--guest <platform>）；
    无声线 → **不再阻塞**——服务端自动用系统内其他嘉宾音色替换（替换音色、不替换嘉宾名字，CLI 会提示），
    告知编辑即可继续；想用专属声线 → guest-voice 上传后 --part n 重跑；系统内完全无音色才 422
  · 质量自检：现场感/角度保真/结构对照/转场 + 称呼核对（开场自我介绍 = detail 的 callName，非「主持人」泛称）
    + 听众视角抽查（host 抛出符号/术语/专名前有无承接；二人对话逻辑是否接得住）——不合格打回重生成
  · 机器校验（附加信息）：pnpm editor check-script <id>（三段结构/6 字段/句尾标签/收尾三步/笑声≤1/
    AI 长段/host 问句可追溯/停顿密度）——**存在硬性失败（✗）→ 打回重跑 SC-STEP-2**；警告项人工核对
  · 事实核查（进 TTS 前必做，见 RULES-8）：对照 selection.json 的 fact_check_list 逐条核实（无法核实 → 删除断言）
    + privacy_redactions 逐条确认已泛化——未核查不进 TTS
  · 选项（统一选号格式，见 RULES-10，一项一行）：
    `[1] : ✅ 确认 → TTS`
    `[2] : ✏️ 听感反馈（附说明）→ 重跑 SC-STEP-2`
    `[3] : ✏️ 结构反馈（附说明）→ 重跑 SC-STEP-2`
    `[4] : ❌ 拒稿（见 REJ）`
```

**SC-OUT 输出物存放与命名标准**
`drafts/{submissionId}/`：`selection.json` / `quality.json`（拒稿）/ `chosen-idea.json` / `script.json`（固定命名）。
终稿 `script.json` 是 TTS（TTS-STEP-1）与发布（PUB-STEP-2）的输入基准。

**SC-ERR 错误处理**
- 子代理 JSON 解析失败 → 基于 read 逐行容错解析（content 可能含未转义换行）
- 无时刻 / 骨架断裂 / 任务型对话 → SC-GATE-1 拒稿（见 REJ）
- 嘉宾声线未配置 → SC-GATE-2 预检告知，不闷头跑 TTS 到 422
- 打回重跑按层执行，不改动已确认的上游产物
