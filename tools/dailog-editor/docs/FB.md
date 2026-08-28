# FB 编辑反馈日志（自进化素材库）

> **索引**：主文档 `SKILL.md`（附录索引）｜ 章节码 FB ｜ 节码 FB-FLOW / FB-IN / FB-OUT / FB-ERR
> 定位：提示词保持简单灵活，编辑的修改意见在**日志层**累积，经**蒸馏**沉淀为规则——不自动污染提示词。
> **两条进化轨道**：
> · **选题 = 审美进化**——编辑在 SC-GATE-1 拒稿/修改思路 → 进化 selection.md
> · **脚本 = 创作能力进化**——编辑在 SC-GATE-2/TTS/PUB 改脚本 → 进化 draft.md
> 日志：`.dailog-editor/feedback/feedback.jsonl`（一行一条 JSON；gitignored，本地）
> L2 演进层：`.dailog-editor/learned-rules.md`（蒸馏沉淀的通用规则，SC-STEP-1/2 附加输入）

**FB-FLOW 流程 / 原则 / CLI 调用逻辑**
```
FB-STEP-1 落盘：确认门收到编辑修改意见 → pnpm editor feedback add --stage <选题|脚本> ...（见下）
FB-STEP-2 查看：pnpm editor feedback [--new] [--general] [--stage <环节>] [<submissionId>]
FB-STEP-3 蒸馏：pnpm editor evolve [--min-repeats N] [--stage <环节>] → 读提案 evolve-proposal.md →
           主会话起草规则 diff（新增/软化/删除）→ 编辑审批 → 应用 + build →
           pnpm editor feedback confirm <ids>（已沉淀）/ archive <ids>（不采用）
FB-STEP-4 沉淀（审批后三选一，见「沉淀出口」）：
           ① 写进基础提示词（改 draft.md / selection.md 源码 + build）
           ② 写进 L2 演进层（pnpm editor learned-rules add --stage <环节> "<规则>" --from <fb-id>）
           ③ 固化为机器校验（新增 checks.ts 断言 + check-script 把关）
```
原则：
- **落盘点**：
  · SC-GATE-1（选题·审美）：编辑**拒稿**或**修改思路**（附说明）时，落盘一条 `--stage selection`
    （AI 选题判断与编辑审美的偏差，是 selection.md 进化的原料）
  · SC-GATE-2（脚本·创作）：编辑选「听感反馈/结构反馈」并附说明时，主会话在打回重跑**之前**落盘一条
    `--stage script`（修订指令只作用于本期重跑；落盘让意见跨期沉淀）——TTS-GATE-1 / PUB-GATE-1 同理
- **带原因才可泛化**：issue（现象）+ reason（原因）缺一不可——只记「怎么改」不记「为什么」的
  反馈是个案补丁，evolve 不参与蒸馏；SKILL 落盘时如编辑只给了现象，主动追问原因。
- **通用性标注**：编辑说「以后都要这样」→ --general；只说「这期改掉」→ 默认 one-off（只进本期修订）。
- **蒸馏三问（evolve 提案的起草标准）**：重复 ≥2 次（--min-repeats 默认 2）的模式才够格成为通用原则；
  一次性的反馈只进本期修订；被推翻的旧规则同样走删除/软化（提示词不是单向加法）。
- **红线**：反馈是**意见素材**，evolve 只做聚类准备，**不自动改提示词**——规则 diff 由主会话起草、
  **编辑审批后**应用；应用后更新条目状态（confirm/archive）。

**沉淀出口（FB-STEP-4，审批后三选一）**
1. **写进基础提示词**（L0）：规则成为创作原则——最简单，但提示词会变长；适合不可机械判定的审美/结构原则。
2. **写进 L2 演进层**（learned-rules.md）：基础提示词不动，规则放独立文件随蒸馏增减（每类 ≤5 条，
   超限须修剪）；SC-STEP-1/2 子代理有则读取作为附加规则，冲突以基础提示词为准——适合高频重复的通用规则。
3. **固化为机器校验**（check-script）：规则变成程序断言，SC-GATE-2 自动跑，100% 检查不过就打回——
   适合可机械判定的高频规则（句尾标签/收尾三步/笑声数/AI 长段/恶补提问等）；新增断言改
   `tools/dailog-editor/src/checks.ts` + build。三者不互斥：一条规则可既进提示词（创作时避免）也固化校验（生成后把关）。

```bash
pnpm editor feedback                          # 全部（日期倒序）
pnpm editor feedback --new                    # 只看未蒸馏
pnpm editor feedback --general                # 只看「以后都要」的通用反馈
pnpm editor feedback --stage selection        # 只看选题（审美进化）反馈
pnpm editor feedback --stage script           # 只看脚本（创作能力进化）反馈
pnpm editor feedback <submissionId>           # 按投稿过滤（前 8 位即可）
pnpm editor feedback add --submission <id> --stage selection --category 角度 \
                        --issue "选题角度没吃透节目建议" --reason "时刻没落在建议路径上" \
                        --change "按节目建议路径选时刻" --general
pnpm editor feedback confirm fb-20260828-001  # 蒸馏应用后：已沉淀
pnpm editor feedback archive fb-20260828-001  # 不采用/被推翻：已归档
pnpm editor evolve [--min-repeats 3] [--stage selection]   # 蒸馏准备（两条轨道分列）
pnpm editor learned-rules                     # 列出学习规则（L2 演进层）
pnpm editor learned-rules add --stage script "guest 段超过 2 句必须拆段" --from fb-20260828-001
pnpm editor learned-rules remove 1 --stage script
pnpm editor check-script <submissionId>       # 脚本机器校验（SC-GATE-2 附加信息）
```

**FB-IN 输入规范**
- 一条反馈 = id（fb-YYYYMMDD-<seq>）/ date / submissionId / **stage（selection|script）**/
  category（选题→门槛|价值|角度|维度|标题|其他；脚本→听感|结构|内容|情绪|停顿|穿插|收尾|其他）/
  issue（现象）/ reason（原因）/ change（修改）/ scope（one-off|general）/ status（new|confirmed|archived）/ source（确认门名）。
- 落盘路径：`.dailog-editor/feedback/feedback.jsonl`（追加一行；命令自动建目录）。
- evolve 按（环节×类别）聚类——选题反馈与脚本反馈互不混淆，提案分两条轨道列出。

**FB-OUT 输出物**
```
[1] 2026-07-01 · 投稿 8f3a2c… · 环节:选题 · 类别:角度 · 通用性:以后都要 · 状态:new · 来源:SC-GATE-1
    现象: 选题角度没吃透节目建议
    原因: 时刻没落在建议路径上
    修改: 按节目建议路径选时刻
    id: fb-20260701-001
```
evolve 摘要（选题/脚本分别统计）+ 提案文件 `.dailog-editor/feedback/evolve-proposal.md`
（## 选题·审美进化 / ## 脚本·创作能力进化 两段，各含候选原则/个案/缺原因——主会话起草 diff 的工作文件）。
check-script 输出（SC-GATE-2 附加信息）：通过/警告/失败统计 + 明细。

**FB-ERR 错误处理**
- add 缺 --issue → 报错退出（issue 必填；reason 建议填但不强制；--stage 缺省按 script）
- confirm/archive 缺 id / id 不存在 → 报错 / 提示未找到（已处理的条目不受影响）
- learned-rules add 超每类上限 → 拒绝（提示先蒸馏门修剪）；remove 序号越界 → 报错
- check-script：无 script.json / JSON 非法 / 硬性失败 → 退出码 1
- 日志文件损坏（坏行）→ 跳过该行继续读其余，不整体失败
- evolve 无 new 反馈 → 提示先落盘
- feedback/evolve/learned-rules/check-script 都是纯本地命令：不依赖 API/登录；多环境下仍按惯例带 --env（环境名不影响本命令）
