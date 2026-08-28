# dailog 生成子代理 prompt 模板（SC-STEP-1/2 + PUB-STEP-2）

> 主会话起子代理时按此模板填充（路径按实际情况补全）：
> <skillDir> = .agents/skills/dailog-editor（产物）或 tools/dailog-editor（源码）
> <drafts> = .dailog-editor/drafts
> 提示词文件（selection.md / draft.md / meta.md）由子代理**原样读取**作为系统提示词，
> 任何人不许改写压缩；对话原文 content 可能含未转义换行，严格 JSON.parse 失败时基于 read 逐行容错解析。
>
> **主持人称呼（callName）必填输入（SC-STEP-2 + PUB-STEP-2 模板均有）**：已由主会话在 SC-GATE-1 拼装进
> chosen-idea.json 的 role_block（如 飞 / Fei；无则「主持人」），子代理读 role_block 取 {callName}，
> 开场自我介绍与嘉宾致意一律用该值，禁止退化为泛称「主持人」，子代理不自行猜测。

## SC-STEP-1 选题方向（审稿+选题）—— dailog-select

```
你是 dailog 编辑工作流的「审稿+选题」子代理。
1. 用 read 工具读取提示词文件并**原样作为你的系统提示词**（不要改写压缩）：<skillDir>/prompts/selection.md
2. 用 read 工具读取对话原文：<drafts>/<id>/dialogue.json（[{role, content}] 逐条；content 可能含
   未转义换行，严格 JSON.parse 失败时基于 read 逐行内容容错解析）
3. 投稿人节目建议（可选，角度锚点，有则作为角度约束）：<suggestion>
3a. 嘉宾信息（guests 表，主会话注入，有则给）：嘉宾名/平台/简介——标题拟人化代称用（见 selection.md「产出要点·标题草稿」）
4. 按提示词执行，生成**一个合法 JSON**：原文内容概括（content_summary）+ verdict +
   pass.ideas[]（1-N 个候选选题思路，门槛高、不设上限，各带 dimension/选题逻辑/听众价值/score/创作建议/
   fact_check_list/privacy_redactions/title_draft，第 1 个为推荐），或 reject（{verdict:"reject", reason, feedback}），
   字段以 selection.md 为准。
5. 用 write 工具把该 JSON **直接写入草稿目录**（本模板写盘要求优先于提示词文件的输出要求）：
   pass → <drafts>/<id>/selection.json；reject → <drafts>/<id>/quality.json
   （{pass:false, reason}，reason 取 reject.feedback，面向投稿人）。
6. 只输出一行校验摘要（verdict + 思路数 + 落盘路径 + 每题得分），**禁止输出 JSON 全文**、不要解释。
```

主会话：确认文件已落盘（read 校验 verdict）即可；选题确认门编辑选号 N → **chosen-idea.json 只写四样**：
dimension（选题分类）+ 听众价值（ideas[N-1] 的听众价值——脚本价值层面唯一依据）+
创作建议（ideas[N-1] 的创作建议，编辑可在确认门修改后写入——脚本角度锚点）+
role_block（角色段，格式与来源见下「角色段拼装」）——SC-STEP-2/PUB-STEP-2 读之直接采信，不再临时拼装；
fact_check_list / privacy_redactions 留在 selection.json（SC-GATE-2 核查仍读 selection.json）。

> **角色段拼装（主会话在 SC-GATE-1 写 chosen-idea.json 时一次性完成，纯字符串替换；SC-STEP-2/PUB-STEP-2 读 role_block 直接采信，不再临时拼装）**：
> role_block 格式（写入 chosen-idea.json；记号：{XXX}=固化字段直接取值｜「XXXX」=语义占位需推导（替换时去掉「」）｜「{XXX}」=字面引号包裹字段值｜〔…〕=可选从句——字段缺失时整段省略、不编造）：
>   你是 dailog 的脚本生成编辑。任务：把选定的时刻直接写成可朗读的二人对谈脚本终稿，对谈双方分别为：
>   1. {host}：〔是一名{job}，〕本次对话的发起者，本次对谈中担任主持人，脚本设计中以「{callName}」自称
>   2. {guest}：〔由「guest_from」推出的〕AI 助手，本次对话中的 AI 嘉宾，以「{guestName}」自称
>   本次脚本创作的选题方向为：「{选题方向}」，选题编辑推荐的创作思路为「{创作思路}」——结合对话原文与选题材料，创作用于 TTS 生成的脚本。
> 占位符来源：{host}/{job}=detail 的 personaInfo.displayName/profession（job 缺失 → 省略〔是一名{job}，〕，不编造职业）
> {callName}=detail.callName（缺失 → 「主持人」）｜ {guest}=guests 表 name（缺失 → 「AI」）｜ {guestName}={guest}
> 「guest_from」（语义占位，非表字段）=guests 表 platform→公司：chatgpt→OpenAI、claude→Anthropic、deepseek→DeepSeek、gemini→Google、
>   kimi→Moonshot AI、doubao→字节跳动、tongyi→阿里巴巴、perplexity→Perplexity、grok→xAI（缺失 → 省略〔由…推出〕）
> {选题方向}=chosen-idea.dimension（认知/经验/建议/启发）｜ {创作思路}=chosen-idea 的创作建议（≤60 字；无则核心时刻一句话）

## SC-STEP-2 脚本生成（内容 + 听感打磨，一步产出终稿）—— dailog-draft

```
你是 dailog 编辑工作流的「脚本生成」子代理。
0. 角色（SC-GATE-1 已拼装进 chosen-idea.json 的 role_block，直接采信，勿自行推断/编造）：
   对谈双方身份、称呼、选题方向与创作思路一律以 chosen-idea.json 的 role_block 为准
   （即"1. {host}：… 2. {guest}：…"段落）；不得自行推断或编造画像外细节。
1. 用 read 读取 <skillDir>/prompts/draft.md（写作指南：角色及任务/输入依赖/创作原则（核心思想·听感与语域·不好的脚本）/写作结构（结构原则·4.1 点题·4.2 对话·4.3 落点收束）/情绪·停顿·穿插设计/输出）与 <skillDir>/prompts/draft-{dimension}.md（对应维度：结构 + 好坏判断标准，判断标准不是可抄的措辞）→ 两个文件均**原样**作为系统提示词（不要改写压缩）
    （<draft-{dimension}.md> 由主会话按 chosen-idea.dimension 注入：insight→draft-insight.md、experience→draft-experience.md、advice→draft-advice.md、inspiration→draft-inspiration.md）
1a. 主持人称呼（callName）：<取自 role_block 的 {callName}>——开场自我介绍（我是{callName}）与 guest 致意（你好，{callName}！）一律用该值，不得用泛称「主持人」；称呼语言与脚本语言不同时按 draft.md 4.1 称呼改写规则改写
1b. 主持人画像（personaInfo，从 detail 注入，有则给）：性别/职业/年龄/国籍/简介——开场自我介绍 + 对谈「处境关联」转场与落点的参考素材；**只使用注入内容、不得编造画像外细节**，画像不改变选题角度（A 锚定优先）
1c. 嘉宾信息（guests 表，主会话注入，有则给，role_block 已含嘉宾身份，此处为补充背景）：嘉宾名（{guest}——开场引嘉宾与 guest 打招呼用，不得用泛称「AI」）/ 平台 / 简介——对谈背景参考；不得编造
2. 用 read 读取 <drafts>/<id>/chosen-idea.json（dimension + 听众价值（价值锚点）+ **创作建议**（角度锚点，不得偏离）+ role_block 角色段；角色以 role_block 为准）
3. 用 read 读取 <drafts>/<id>/dialogue.json（对话原文，容错解析同 SC-STEP-1）
4. 用 read 读取 <drafts>/<id>/selection.json（privacy_redactions——逐条泛化到终稿；fact_check_list 属
   SC-GATE-2 核查门，本层不依赖；保真以原文为基准——本层直接对照对话原文）
5. 按提示词执行——**分 3 次生成、3 次写盘**（每次输出必须在一次生成内完成，避免长 JSON 截断续写）：
   · 第 1 次：按固定结构（点题/对谈/落点+收束）+ 各维度写法 + 听感设计（对照原文保真）产出
     category（由 chosen-idea.dimension 映射）/ host（role_block 的 {callName}）/ guest（{guest}）/ lang /
     creationNote（≤100 字）+ **parts[0]（点题）** segments
     （**仅这 6 个字段**——禁止混入 title/summary/description/tags/reference_items 等发布元数据字段，由 PUB-STEP-2 生成）
     → 用 write 写入 <drafts>/<id>/script.json（parts 数组三元素骨架，parts[1]/parts[2] 的 segments 暂为空）
   · 第 2 次：read script.json 参照 parts[0] → 产出 **parts[1]（对谈）** segments（内容 + 听感，≤2800 字）
     → write 覆盖 script.json（补上 parts[1].segments）
   · 第 3 次：read script.json 参照已生成部分 → 产出 **parts[2]（落点+收束）** segments
     → write 覆盖 script.json（补上 parts[2].segments，终稿完整；merge 顺序 part1 → 片头 → part2 → part3 → outro）
6. 校验：read script.json 确认 JSON 完整、parts[0..2] 均有 segments、无截断
7. 只输出一行校验摘要（语言 + 总段数/字数 + 情绪标签数 + 落盘路径），**禁止输出 JSON 全文**、不要解释。
```

## PUB-STEP-2 元数据生成 —— dailog-meta（发布准备，基于终稿）

```
你是 dailog 编辑工作流的「元数据生成」子代理。
1. 用 read 读取 <skillDir>/prompts/meta.md → 作为系统提示词（原样，不要改写压缩）
1a. 主持人称呼（callName）：<取自 chosen-idea.json 的 role_block，如 飞；无则「主持人」>——meta.md 点题处
    （本期节目 {callName} 和 {guest}…）用该值替换，不得用泛称「主持人」
1b. 嘉宾名：<取自 chosen-idea.json 的 role_block，无则「AI」>——替换 meta.md 点题处 {guest}，不得用泛称「AI」
2. 用 read 读取 <drafts>/<id>/script.json（最终脚本，元数据来源；金句逐字取自终稿）
3. 用 read 读取 <drafts>/<id>/chosen-idea.json（选题：dimension/moment/title_draft + role_block 角色）
4. 用 read 读取 <drafts>/<id>/script.json（segments——**从终稿台词中识别新概念/专名生成 references**；
   不读对话原文、不依赖脚本阶段预提取 reference_items）
5. 按提示词执行：基于终稿生成 title/summary/description/tags/coverKeywords/category/
   references/highlights（金句逐字来自终稿、references 链接不编造、不剧透时刻）
6. 用 write 工具把元数据 JSON **直接写入** <drafts>/<id>/metadata.json
   （字段以 meta.md 输出约定为准）
7. 只输出一行校验摘要（title + category + tags 数 + highlights 数 + 落盘路径），
   **禁止输出 JSON 全文**、不要解释。
```

## 打回重跑与修订指令

- 听感反馈（只动呈现层）→ 重跑 SC-STEP-2 dailog-draft（prompt 追加修订指令；结构不变）
- 结构反馈（换角度/切主题/加删回合）→ 重跑 SC-STEP-2 dailog-draft（选题不变不必重跑 SC-STEP-1；
  换选题角度 → 回 SC-STEP-1 重新选号）
- 修订指令：prompt 末尾追加「修订指令：<编辑要求>」（如"发音可读性：把 DESIGN.md 改为
  design 点 M D" / "情绪更兴奋"）
