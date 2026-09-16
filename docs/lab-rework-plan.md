# dailog lab 提案管线：落地蓝图与实施计划

> 状态：2026-09-05 定稿实施版。定位理论见 [docs/positioning-notes.md](./positioning-notes.md)（认知事件的可旁观性）。
> 本文 = 产物槽 × 提示词职责 × 持久化边界 × 对齐机制 × 分阶段实施清单。实现范围 = tools/script-lab（dailog lab）。

## 0. 一句话

把审题从"单条审核结果"升级为"**1-N 提案墙**"：一份 dialogue 挖出多个认知事件及其主线问题链（1-3 条、硬顶 5），
编辑选定一条入库（替换原 review 槽），脚本创作/打磨严格沿这条链消费——事件引文是跨层不变量，浏览器只存工作副本，R2/服务端为权威。

## 1. 产物与存储（决策锁定，勿回退）

| 产物 | 存储 | 生命周期 |
|---|---|---|
| dialogue.json | R2（URL 哈希 key，不可变） | 永久 |
| proposals.json（LLM 审题输出 0..N） | 浏览器槽（store），**不入库** | 选定后清除 |
| proposal.json（选定提案 = 替换原 review 槽） | 服务端 submission jsonb（沿用 PUT /review 通道，字段建议更名 proposal） | 永久；投稿详情审核卡展示它 |
| script.json（统一一份，不再分 raw/edited） | 创作草稿浏览器多候选 → 采纳/打磨定稿写 R2 `scripts/{id}.json`（segments 同槽） | R2 权威 |
| full audio | R2 `episodes/{userId}/{id}.m4a`（canonical，发布零拷贝） | 永久 |
| episode.json | episodes 表 meta jsonb | 永久 |

- 浏览器 localStorage（assets-{id}）/ IndexedDB 只存工作副本（review/scripts/proposals 槽 + 音频缓存），换浏览器/清缓存不丢已落产物。
- 恢复语义：proposal 在服务端 → 跨会话可续；script 改糟糕 → 从 proposal + dialogue 重跑创作（成本低）；选定后 proposals 删除，次优提案不保留（如需选题资产池，另行决定按 URL 哈希存 R2）。

## 2. 提示词职责 × 输入输出（六层）

| 层 | 输入 | 职责（提示词文件） | 输出 | 存储 | 人工门 |
|---|---|---|---|---|---|
| ① 审题 | dialogue | 扫事件 → 回溯主线问题链 → 定模态 → 打分 → 合并 → topN | proposals[] + 拒稿候选 | 浏览器槽 | 提案墙选一条 / 全拒 |
| ② 脚本创作 | dialogue + 选定 proposal + host/guests | 沿链铺跑道（链上提问保真、支线剪、事件近原样） | script 草稿（多候选） | 浏览器 → 采纳落 R2 | 编辑手改 |
| ③ 语感打磨 | script + dialogue (+proposal 事件引文) | 顺口/放大/停顿；事件/困惑低偏移；移交拍给分量 | 定稿 segments 写回 R2 | R2 | 试听迭代 |
| ④ TTS/合成 | segments | 逐段 Fish TTS → 合成 full | full audio | R2 canonical | 试听 |
| ⑤ 元数据 | 定稿 segments | title/summary/…（卖过程不卖答案） | episode.json | episodes | — |
| ⑥ 发布 | 封面 + meta | publish-submit | published | 服务端 | 确认 |

## 3. 新概念（跨层同口径，各 system 提示词顶部内置共享词表）

- 认知事件 / 模态（镜照 mirror·越界 frontier·示范 model）/ 主线问题链 / 跑道 / 移交 / 可删不可造——定义见 positioning-notes §2-§5。
- **主线问题链**：从事件沿「依赖」回溯（被事件逻辑依赖的回合 = 链上；无后续依赖突转 = 链外可剪）；节型 confusion→pursuit→reframe→event→landing；全链 ≤6 节；每节 turns 索引 + 原话短锚。
- **移交落点**（脚本结尾三选一）：移交动作（示范）/ 移交问题（镜照）/ 移交瞬间（越界）——不给结论；guest 对 host 说话，听众旁听偷走（防说教）。
- 验收三问（编辑/回检用）：听完能否说出"下次我可以这样想"（示范）/ "我也有个没想清的，现在清楚点了"（镜照）/ "没想到还能这样想"（越界）——三者都答不出 = 没有落点。

## 4. 对齐机制（多级提示词变量传递）

1. **锚点 = dialogue 回合索引**（dialogue 不可变 → 索引稳定）；quote 只作人读短锚（≤40 字）。链节引用一律 `turns`，不靠全文匹配。
2. **契约对象 = 选定 proposal（服务端 jsonb）**：下游各层只消费它，不重推；script 层锚不住某节点 → 停下回报上游，禁止脑补（"可删不可造"的跨层版）。
3. **模态是贯穿变量**：score 定 modal → script 落点被 modal 约束 → polish 加权移交拍 → meta 只从台词提炼（不信上游声明）。
4. **事件引文 = 跨层不变量**：②出稿、③出稿各做一次模糊匹配校验（可选机检，10 行代码）。
5. **人工锚点**：SC 选题确认门展示"链骨架"（C1 困惑 → … → C4 事件 + offChain 标注），编辑人眼校验重构；编辑手改 = 权威，polish 不纠正。

## 5. 分阶段实施

### Stage 1 · 提示词层（本次，可离线测试）
1. review.score.system.md → 提案版：proposals[]（pitch/main_topic/confusion/confusion_quotes/chain/event{nodeId,modal,quote}/landingHint/offChain/category/score/score-detail/advice）+ rejection 候选；三维打分（困惑公共度×4 / 事件分量×3 / 移交可能性×1）。
   - 兼容保留：main_topic/confusion/confusion_quotes/score/advice/category 字段名沿用（UI/meta 少改）；不输出通过/拒绝结论。
2. review.script.handoff.md → 沿链消费版：保真单位 = 主线问题链；链上 host 提问全保留；offChain 不出现；reframe/event 近原样；落点 = 移交三式（原"听众收获总结"替换）；红线与回检精简保留。
3. review.script.user.md → 输入 = 选定 proposal（chain/event/modal/landingHint）；第 1 步按链认材料（turns 锚定，锚不住回报）；第 2 步沿链剪。
4. polish.all.system.md → 小改：三主角补"移交拍"；若输入附 proposal，事件/困惑节点低偏移（其余顺口档不受限）。
5. 校验：scripts/verify-prompts.mjs + run.mjs --dry-run 组装检查（不调 LLM）。

### Stage 2 · runner/UI 层（✅ 主体完成，2026-09-05）
- ✅ server.mjs：round1 出稿校验（链节 turns 越界 / event 引文未逐字命中 → warnings 报告，不阻断）；round2 渲染改传 **proposal**（下游契约只消费不重推，旧 review 兼容透传）；polish 自动附 submissions.review（事件/困惑低偏移依据）。
- ✅ detail.js：审题 onDone 提案分叉（proposals 入浏览器槽，不入库）；审核卡三分支（提案待选 / 旧产物 / 待审核）；**提案直接内嵌审核卡**（renderProposalCards：每案一行含 分/模态/pitch/主线/困惑原话/问题链/事件引文/落点/评分/链外 + 「选这条」；底部「全拒（候选文案）」；头部「重新审题」）——adoptProposal 选定 → review/save 入库 → 清槽 → 刷新为已审核态；无弹层。
- ✅ polish.all.user 增加可选提案输入行；语法检查（node --check）+ 提示词审计（verify-prompts）全绿。
- 状态机不变：submitted → collected → crafted → published / rejected（review jsonb 只承载选定提案，不承载状态）。
- 遗留（可后续）：② script 出稿 event 引文仍在 segments 的机检；③ polish 事件节 offset 机检（①② 已做 ①）；review 字段更名 proposal（API 列名，延后）；提案墙卡片补 模态/问题链/落点 展示行（cosmetic，详情卡仍显示 main_topic/confusion/score）。

### Stage 3 · 试跑与迭代
- 拿 1-2 篇真实投稿（对话含多事件候选的优先）跑 review.score 提案版 → 人工看提案墙可区分度/链回溯正确性 → 调提示词；
- 对选定提案跑 script → 用"验收三问"回检；反馈进 feedback/review.jsonl（暂不带提示词版本指纹 promptSig——已撤掉，需要时再加）。

## 6. 不做（本轮边界）
- 不改 meta / TTS / merge / publish 流程与存储路径；
- 不物理删除 tools/dailog-editor（文档已标下线，清理另行）；
- 不做选题资产池（次优提案保留）——决策待定；
- 定位理论（tagline/四维→三模态）改写 MRD 主文——由 positioning-notes 驱动，另轮进行。

## 7. 现行流程（代码事实 · 2026-09-05 清理后 · 唯一口径）

### 状态机
`submitted → collected →〔审核提案锁定 + 本地制作〕→ crafted → published / rejected`
- collected：对话已入 R2（url 哈希）；此后为制作态
- 选题锁定 = round2 采纳脚本时（review/save 提案落库）；R2 终稿脚本 = 合成确认时（一次 PUT）
- crafted：full audio 已在 R2 canonical（`episodes/{userId}/{id}.m4a`）+ 终稿脚本已入库；发布卡出现

### 分步（全部经 lab /api/run/*，LLM 直连）

| 步 | 入口/端点 | 存储 | 人工点 |
|---|---|---|---|
| ① 采集 | /api/run/fetch·batch | dialogue→R2 | 列表批量/详情重试 |
| ② 审题 | 控制台 openReviewConsole → round1（review.score） | proposals/rejection → 浏览器槽 | 提案墙选一条（工作态）或全拒 |
| ③ 创作 | 控制台 openScriptConsole → round2（review.script） | 采纳→提案 PUT submissions.review（锁定）；脚本→本地槽 scripts | 多候选生成→采纳 |
| ④ 打磨 | 控制台 openPolishConsole / 逐段手改（本地） | polish 请求带 body.scripts，localMode 不落 R2；结果回槽 | 试听 |
| ⑤ TTS | genSegAudio/batch → tts-seg（body.scripts） | 段音频 IndexedDB | — |
| ⑥ 合成 | merge 对话框 → full-upload + crafted + **终稿脚本 PUT R2** | full→R2 canonical；scripts→R2 | 试听确认 |
| ⑦ 发布 | /api/run/publish（meta）→ publish-submit | episodes 表 meta | 发布确认 |
| 拒稿 | /api/run/reject（任意发布前） | rejected + 通知 | 原因必填 |

### 术语统一（#4）

| 概念 | 统一口径 | 备注 |
|---|---|---|
| 提案 / proposal | 审题产物（事件+链+storyline+评分）；选定=采纳时入库 | 服务端存储列名仍为 `submissions.review`（列名迁移延后，文档/UI 一律称提案） |
| 链 / 问题链 | chain（turns 锚定） | — |
| 模态 | mirror/frontier/model | — |
| 起承转合 / storyline | beats 四拍 + takeaway | 编辑选稿视图 |
| 工作脚本 | 采纳后本地槽（未定稿） | 合成确认才入库（跨端不可见=预期） |
| 终稿脚本 | R2 scripts/{id}.json | 合成确认写入 |
| fidelity | 原话/改写/新写 + 原话率（内容句=原话+改写） | round2 确定性标注 |

### 本轮清理记录（2026-09-05）

- 删 detail.js：遗留 drawer 审核流（openReviewDrawer/preview/startReview/confirm 全家）、llm-box 双组件 mountReviewBoxes/confirmReviewBoxes、polishScript（无按钮渲染的死代码）
- 删 server.mjs：/api/run/review/confirm（业务决策+拒稿联动旧路）、/api/run/script（score+script 单发旧路）
- 删 index.html 旧 drawer 骨架
- 打磨入口收敛为「打磨控制台」；「批量打磨」按钮本就不渲染，代码已清
- 遗留（无害）：部分函数内对 .polish-btn 的空查询（无元素=no-op）；旧历史数据无 fidelity 标注

---

## 附录：容器化局限性评估（2026-09-06 补记——教训：docker 化验收必须按「功能 × 环境依赖」矩阵过，而非只看进程可运行）

背景：lab 容器化后采集 gemini 投稿失败，暴露下列边界未在 docker 化时评估。已实测的真值如下。

| lab 功能 | 外部依赖 | 容器（node:22-slim + ffmpeg + curl）内现状 | 说明 |
|---|---|---|---|
| 审题/创作/打磨（LLM） | 出网 LLM API | ✅ | 密钥 env 注入即可 |
| TTS / 合成 | fish API + ffmpeg | ⚠️ ffmpeg 已装；fish 走 FISH_PROXY_URL——若宿主 SOCKS 仅回环，同「采集」隐患，未实测 | |
| 采集·可直连平台（doubao/claude/kimi/deepseek） | 直接出网 + 采集规则 | ✅ | 实测 doubao thread 采到 18 条（api:doubao） |
| 采集·被墙平台（chatgpt.com / gemini / grok） | 宿主 SOCKS 代理 | ❌ | 宿主直连 gemini 也失败，必须走 SOCKS；容器内 fetch 直连超时 |
| SOCKS 可达性 | 代理必须容器可连 | ❌ | 宿主代理只监听 127.0.0.1 → 容器（host.docker.internal/网关）不可达；需代理开 0.0.0.0 或 TCP 转发 |
| SOCKS 兜底执行器 | curl | ✅（本次补装） | collect.mjs fetchViaProxy = execFileSync("curl", --socks5-hostname)；此前镜像无 curl → 兜底必然抛 ENOENT |
| SOCKS 探测 | findSocksProxy | ⚠️ | Linux 容器不跑 scutil 分支，只认 ALL_PROXY/HTTPS_PROXY/https_proxy env（本次 compose 已注入 ALL_PROXY） |
| 采集·JS 动态渲染平台（gemini/grok） | chromium 渲染 | ❌ | 镜像无 chromium；且即使有，socks 不通仍不可达 |
| 登录/会话/状态 | LAB_STATE_DIR 卷 | ✅ | lab-state:/data |

### 后续约定（防再犯）
1. 任何「换运行形态」（docker 化/换基镜像/远程部署）前，产出上表同款「功能 × 环境依赖」矩阵并逐格实测，用户确认后再动。
2. 容器验收标准至少覆盖：LLM 调用、fish TTS、采集（直连平台 + 被墙平台）、合成、发布，一条真实链路。
3. 遗留决策：A) SOCKS 开 LAN（0.0.0.0）→ ALL_PROXY 指向宿主 IP；B) 镜像加 chromium；C) gemini/grok 类投稿走宿主实例采集（R2 同 URL 缓存，容器复用）。未定。
