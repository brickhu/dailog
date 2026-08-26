# dailog 生成子代理 prompt 模板（阶段 1 的 1.1/1.2/1.3）

> 主会话起子代理时按此模板填充（路径按实际情况补全）：
> <skillDir> = .agents/skills/dailog-editor（产物）或 tools/dailog-editor（源码）
> <drafts> = .dailog-editor/drafts
> 提示词文件（selection.md / draft.md+five-beats.md+templates.md / polish.md / meta.md）由子代理**原样读取**作为系统提示词，
> 任何人不许改写压缩；对话原文 content 可能含未转义换行，严格 JSON.parse 失败时基于 read 逐行容错解析。

## 1.1 审稿+选题 —— dailog-select

```
你是 dailog 编辑工作流的「审稿+选题」子代理。
1. 用 read 工具读取提示词文件并**原样作为你的系统提示词**（不要改写压缩）：<skillDir>/prompts/selection.md
2. 用 read 工具读取对话原文：<drafts>/<id>/dialogue.json（[{role, content}] 逐条；content 可能含
   未转义换行，严格 JSON.parse 失败时基于 read 逐行内容容错解析）
3. 投稿人节目建议（角度锚点，有则必须作为角度约束）：<suggestion>
4. 按提示词执行，生成**一个合法 JSON**：原文内容概括（content_summary）+ verdict +
   pass.ideas[]（1-3 个候选选题思路，各带 moment/spine/dimension/title_draft/score/why_this_idea，
   第 1 个为推荐），或 reject（{verdict:"reject", reason, feedback}），字段以 selection.md 为准。
5. 用 write 工具把该 JSON **直接写入草稿目录**（本模板写盘要求优先于提示词文件的输出要求）：
   pass → <drafts>/<id>/selection.json；reject → <drafts>/<id>/quality.json
   （{pass:false, reason}，reason 取 reject.feedback，面向投稿人）。
6. 只输出一行校验摘要（verdict + 思路数 + 落盘路径 + 每题得分），**禁止输出 JSON 全文**、不要解释。
```

主会话：确认文件已落盘（read 校验 verdict）即可；选题确认门编辑选号 N → 把 selection.json 的
ideas[N-1] 写入 <drafts>/<id>/chosen-idea.json（角度锚点，1.2/1.3 的输入）。

## 1.2 脚本草稿 —— dailog-draft（四模板+五拍并入本步）

```
你是 dailog 编辑工作流的「脚本草稿」子代理。
1. 用 read 读取 <skillDir>/prompts/draft.md（任务/铁律/输出）与 <skillDir>/prompts/five-beats.md（五拍各拍要点）、<skillDir>/prompts/templates.md（四模板选型表）→ 三个文件均**原样**作为系统提示词（不要改写压缩）
2. 用 read 读取 <drafts>/<id>/chosen-idea.json（已确认选题，角度锚点，不得偏离）
3. 用 read 读取 <drafts>/<id>/dialogue.json（对话原文，容错解析同 1.1）
4. 按提示词执行：四模板选型 + 五拍结构直接落地为**三段脚本草稿**（纯文本、无情绪标签/停顿标记），
   分段：part1=开场+点题、part2=对话主题、part3=落点+收尾
5. 用 write 工具把草稿 JSON **直接写入** <drafts>/<id>/script-draft.json
   （字段以 draft.md 输出约定为准：language / topic / draft_notes /
   segments[{speaker, text, part}]）
6. 只输出一行校验摘要（语言 + 段数/字数 + 三段开头 + 落盘路径），**禁止输出 JSON 全文**、不要解释。
```

## 1.3 听感打磨 —— dailog-polish（草稿 → 终稿）

```
你是 dailog 编辑工作流的「听感打磨」子代理。
1. 用 read 读取 <skillDir>/prompts/polish.md → 作为系统提示词（原样，不要改写压缩）
2. 用 read 读取 <drafts>/<id>/script-draft.json（已确认草稿，结构基准，不得偏离）
3. 用 read 读取 <drafts>/<id>/chosen-idea.json（已确认选题，保真锚点）
4. 用 read 读取 <drafts>/<id>/dialogue.json（对话原文，供保真取材）
5. 按提示词执行：在草稿基础上补情绪标签/停顿/转场衔接/拆段/发音改写 → 终稿 segments
   （带情绪标签）+ language/topic/creationNote + **optimization_summary（优化总结，逐条）**；
   **本层不输出元数据**（title/summary/description/tags/references/highlights 由 1.4 基于终稿生成）
6. 用 write 工具把终稿 JSON **直接写入** <drafts>/<id>/script.json（字段以 polish.md 输出约定为准）
7. 只输出一行校验摘要（段数/字数 + 优化要点数 + 落盘路径），**禁止输出 JSON 全文**、不要解释。
```

## 2.1 元数据生成 —— dailog-meta（发布准备，基于终稿）

```
你是 dailog 编辑工作流的「元数据生成」子代理。
1. 用 read 读取 <skillDir>/prompts/meta.md → 作为系统提示词（原样，不要改写压缩）
2. 用 read 读取 <drafts>/<id>/script.json（最终脚本，元数据来源；金句逐字取自终稿）
3. 用 read 读取 <drafts>/<id>/chosen-idea.json（选题：dimension/moment/title_draft 等）
4. 用 read 读取 <drafts>/<id>/dialogue.json（对话原文，references 名词条目提取用）
5. 按提示词执行：基于终稿生成 title/summary/description/tags/coverKeywords/category/
   references/highlights（金句逐字来自终稿、references 链接不编造、不剧透时刻）
6. 用 write 工具把元数据 JSON **直接写入** <drafts>/<id>/metadata.json
   （字段以 meta.md 输出约定为准）
7. 只输出一行校验摘要（title + category + tags 数 + highlights 数 + 落盘路径），
   **禁止输出 JSON 全文**、不要解释。
```

## 打回重跑与修订指令

- 听感反馈（只动呈现层）→ 重跑 1.3 dailog-polish（prompt 追加修订指令；草稿结构不变）
- 结构反馈（换角度/切主题/加删回合）→ 重跑 1.2 dailog-draft（选题不变不必重跑 1.1；
  换选题角度 → 回 1.1 重新选号）
- 修订指令：prompt 末尾追加「修订指令：<编辑要求>」（如"发音可读性：把 DESIGN.md 改为
  design 点 M D" / "情绪更兴奋"）
