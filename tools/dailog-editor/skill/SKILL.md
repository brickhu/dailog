---
name: dailog-editor
description: 
  dailog 编辑本地工作流（一条龙）。用户（编辑）给出投稿 ID、或让本技能拉取待审队列时：
  拉取队列/详情 → 本地拉取网页内容 → 按 dailog 标准生成脚本 → Fish TTS 合成语音 →
  ffmpeg 合成 → 节目信息与封面 → 一次性上传发布（或拒审）。覆盖本质版编辑管线的全部动作。
triggers:
  - 编辑投稿
  - 审核投稿
  - 制作节目
  - 拉取队列
  - 投稿队列
  - 待审投稿
  - 生成脚本
  - 合成语音
  - 发布节目
  - 拒审
  - 编辑工作流
  - editor
  - publish episode
  - dailog 编辑
---

# Dailog Editor · 编辑本地 Agent 工作流（一条龙）

**本质版架构**：用户只提交 URL + 声音采样 → 落库待审核；编辑在本地 Agent 完成
内容拉取、脚本、语音、合成、封面，成品一次性上传发布。服务端不做任何采集/生成。

```
用户投稿（site）: URL（合法性+触达性检查）+ 采样 → submissions(status=submitted)
编辑（本技能）: list → detail → fetch 采集解码 → 生成脚本 → tts → merge
              → cover → publish（published + 通知投稿人）/ reject（拒审 + 通知）
```

## 前置条件

- `.dailog-editor/.env`（Fish/Pexels 密钥）与 `.dailog-editor/envs.json`（**环境清单**，
  模板 `tools/dailog-editor/templates/envs.example.json`）已配置
- 本机有 `ffmpeg` / `ffprobe`（采样转码 + 合成）；草稿目录 `.dailog-editor/drafts/` 自动创建
- 命令入口：`pnpm editor <cmd>`（根目录）；源码 `tools/dailog-editor/`

## ⚠️ 会话初始化（每个新对话必做——环境与配对是会话级状态）

**环境选择与配对不落全局配置**：每次新起对话，先确认环境与授权，再开始操作；
新开对话必须重新确认（不沿用上次对话的选择）。

```
新对话开始（用户请求编辑操作）
  ↓ ① 列出环境清单（读 .dailog-editor/envs.json）→ 询问用户本次访问哪个环境
  │    （若用户已直接指定 → 用它；否则必须问，不默认）
  ↓ ② 检查该环境：pnpm editor --env <环境> auth-status
  │    · 先打 /health 验证端点可用（不可达 → 换环境/查网络，不继续）
  │    · 再查授权：✅ 有效 → 记下环境名，本对话后续命令全部带 --env <环境>
  │    · ❌ 未配对 / token 失效 → 引导配对（③）
  ↓ ③ 配对码登录：pnpm editor --env <环境> login
  │    终端给授权链接（API 域内自包含授权页，不依赖 site）→ 浏览器打开登录
  │    （已登录略过）→ 页面显示配对码 → 粘贴回对话/终端 → 配对成功
  │    （token 绑定该环境缓存本地）
  ↓ ④ 固化到当前对话：本对话所有 `pnpm editor` 命令显式带 --env <环境>
  │    （或导出 DAILOG_ENV=<环境> 作为本对话的环境变量）
  ↓ ⑤ 新开对话 → 回到 ① 重新确认环境 + 检查授权
```

要点：
- **环境必须显式**：存在多个环境时命令不带 --env 会列出清单拒绝执行——防「以为是 dev 实际打到 prod」
- **每次对话首次调用先确认端点可用**：`auth-status` 第一步打 `/health`（无鉴权）——
  端点不可达与未授权分开提示，避免「连不上还去配对」的误导
- **token 绑定环境**：dev 的 token 不能用于 prod（会提示先配对 prod）
- 用户中途说「换个环境」→ 重新走 ①-④（login 可用 `--force` 重配对）

## 工作流（一条龙）

```
用户: "审核投稿" / 给 submissionId / 粘贴 URL
  ↓ ① 会话初始化（见上：确认环境 → auth-status → 必要时配对）
  ↓ ② 拉取队列或详情
  ↓ ③ 采集 + 内容解码：pnpm editor fetch <id>（拉取 URL → page.html/page.txt/dialogue.json）
  │    结构化命中直接用 dialogue.json；未命中 → 浏览器/控制台兜底后提炼
  ↓ ④ 按「脚本生成规范」生成脚本 → script.json（存草稿目录）
  ↓ ⑥ pnpm editor tts <id> --script script.json --language <lang>  （逐段合成）
  ↓ ⑦ pnpm editor merge <id> --language <lang>                      （合成 final.mp3，intro/outro 按语言匹配）
  ↓ ⑧ pnpm editor cover <id> "<关键词>"                                （Pexels 封面）
  ↓ ⑨ 与编辑确认 → pnpm editor publish <id> --title "…" …             （一次性上传发布）
  ↓    或 pnpm editor reject <id> --reason "…"                         （拒审）
  ↓ ⑩ 汇报：期号/节目链接 或 拒审原因
```

> 本工作流中所有 `pnpm editor` 命令均带会话选定的环境（`--env <环境>` 或 `DAILOG_ENV`），下文为简洁省略。

### ② 队列与详情

```bash
pnpm editor list                  # 待审队列（先到先审；⚠️无采样 = 无法克隆主持人音色）
pnpm editor detail <submissionId> # URL/投稿人/采样 transcript/已上线节目（采样在服务端 R2，无需下载本地）
```

### ③ 采集 + 内容解码（`pnpm editor fetch <id>`）

- 从投稿详情拿 URL → 拉取页面（UA 伪装、跟随重定向、30s 超时）→ 解码落盘草稿目录：
  - `page.html`：原始 HTML；`page.txt`：清洗后正文；`dialogue.json`：提取的消息
    `[{role: "user"|"assistant", content}]`
- **提取策略（自进化，三级，规则加载：本地优先 → 产物 fallback）**：
  1. **规则库命中**（host+pathPrefix → 选择器）→ 按规则提取（命中 hits 自动 +1 写回）
     - 优先 `.dailog-editor/rules.json`（自进化主文件）；本地缺失 → fallback 产物种子
       `assets/rules.json`（工程随构建分发，只读）；命中后进化落本地
  2. 无规则 → **通用嗅探**（`data-message-author-role` 容器）
  3. 都失败 → 浏览器兜底 + **沉淀新规则**（见下）
- **浏览器兜底（反爬终极方案——用户自己的浏览器已过 CF 挑战）**：
  1. `pnpm editor console-script <id>` 生成控制台脚本（有规则内联选择器，无规则通用启发式）
  2. 用户打开分享页 → F12 Console → 粘贴运行 → 脚本自动复制对话 JSON 到剪贴板
  3. 用户粘贴回对话 → `pnpm editor paste <id>` 校验入库（消息双全）→ 继续管线
  4. 或 browser-use 打开页面滚动加载 → 复制正文 → Agent 提炼
  （保证 user 与 assistant 消息都提取到——缺一方 = 内容不完整，继续兜底）
- 拉取失败（403/超时/失效）→ 如实汇报，引导用户走浏览器控制台兜底

#### 解码规则自进化（大模型学习闭环——遇到新平台结构时）

```
流程跑起来后采集出问题（规则未命中/提取失败）：
  ① 大模型学习：分析草稿 page.html，逆向消息容器——
     角色标识 attribute（data-message-author-role / data-testid 等）、内容子容器（.markdown 等）
  ② 生成候选规则 → 用草稿验证（不重新拉取）：
     pnpm editor rule-test <id> --user-selector "..." --assistant-selector "..." [--content-selector "..."] --platform <平台>
     · ✅ 消息双全（user + assistant 都有）且与人工核对一致 → 跑通
     · ⚠️ 只命中单侧 / 零命中 → 调整选择器重试
  ③ 跑通后入库（自动写 .dailog-editor/rules.json，host/pathPrefix 从投稿 URL 推断）：
     pnpm editor rule-test <id> ... --save
  ④ 下次 fetch 同平台投稿自动命中（无需 build，即时生效）
```

**红线**：规则必须基于真实 DOM 采样（草稿 page.html），不凭猜测写选择器；
选择器用稳定 attribute（`data-message-author-role` / `data-testid`），不用 react class / 索引；
**验证跑通（rule-test 消息双全）才允许入库**——失败规则不沉淀。

**红线**：规则必须基于真实 DOM 采样（草稿 page.html），不凭猜测写选择器；
选择器用稳定 attribute（`data-message-author-role` / `data-testid`），不用 react class / 索引；
新增规则必须配套验证（重新 fetch 命中）才算入库。

**平台经验库**（已沉淀规则，遇到同平台直接复用）：

| 平台 | 规则状态 | 选择器要点 |
|---|---|---|
| chatgpt | ✅ 已入库 | `div[data-message-author-role]`（是 div 不是 article）+ `.markdown` 正文 |
| doubao | ⚠️ 占位 | `data-message-author-role` 系（待实测校准） |
| claude | 待沉淀 | 分享页内容在 JS 数据（CSS 提取不到）——浏览器兜底后按需沉淀 |
| deepseek/gemini/kimi/tongyi/perplexity | 待沉淀 | 首次遇到时走浏览器兜底 + 规则沉淀流程 |

### ④ 脚本生成规范（dailog 编辑标准——从原服务端润色 prompt 原样迁移）

用 LLM（本环境任意可用模型）按以下标准把对话润色成**朗读向播客脚本**，输出
`{"language", "scripts": [{"topic", "title", "creationNote", "segments": [{"speaker":"host"|"guest", "text"}]}]}`
（一个投稿可切多个主题脚本，各自独立成期；这里每期做一个，脚本存
`scripts-{n}.json` 到草稿目录，格式 `{"segments":[…]}` 供 tts 消费）：

1. **语言**：跟随原对话主要语言（zh/en/ja/ko…）
2. **时长**：5-10 分钟（约 1200-3000 字），压缩长段落、去除冗余
3. **朗读向**：多用短句、自然断句，避免书面语和长修饰（"此外""综上所述"），标点控制节奏
4. **真人对话感**（像真人聊天，不念稿）：
   - 留白：[break]（短停）/ [long-break]（长停）或"嗯…"自然过渡
   - 穿插："对""当然""嗯""确实"等反馈接话，有来有回
   - 比喻：复杂概念用生活化比喻；打断：主持人在嘉宾长段中适时打断提问/总结
   - 调侃、[laughing] 欢笑、直播感（"欢迎收听""感谢收听"）、思考语气（"让我想想"）
   - 隐私模糊化：人名/地名/公司名/具体事件泛化处理
5. **开场白（固定结构，信息点不可变，措辞可变）**：
   - 第一段 host：问候听众 → 自我介绍（我是{主持人称呼}）→ 欢迎来到 Dailog
     （dailog 是把用户与 AI 的真实对话打磨成播客音频的内容形态）→ 引出今天的 AI 嘉宾{嘉宾名}
   - 第二段 guest：自我介绍（我是{嘉宾名}）→ 回应欢迎
   - 不可变：结构与信息点（自我介绍、Dailog 概念、双方称呼——不得虚构或替换名字）
   - 可变：按话题定情绪（轻松 → [excited] 明快；严肃 → [calm] 温和）
   - 主持人称呼：投稿人人设 callName（详情可查，无则"主持人"）；嘉宾名：guests 表 name
6. **内容价值四维**（选题标准——脚本聚焦四类价值，纯寒暄/无实质内容 → 不生成脚本）：
   - 交锋：观点/立场的碰撞与反转；新知：知识/信息差/对 AI 能力边界的前沿认知
   - 情感：共鸣/情绪故事/真实情感流动；经验：方法与实操/避坑/决策推演
7. **情绪标注（Fish Audio S2 语法——随文本直达 TTS）**：
   - 方括号标签放句首：基础 happy/sad/angry/excited/calm/confident/surprised/curious/sarcastic 等；
     进阶 doubtful/confused/disappointed/regretful/hopeful/nostalgic/determined/sympathetic；
     语气 in a hurry/whispering/soft tone/emphasis；音效 laughing/chuckling/sighing/sobbing/gasping；
     停顿 [break]（短）/[long-break]（长）
   - 可强度修饰 slightly/very/extremely（如 [very excited]）、组合最多 3 个（[sad][whispering]）
   - 每句 1 个主情绪；短句与中性叙述不加标签，避免过度标注
   - 情绪随场景推进：开场好奇/欢迎 → 探讨兴奋/自信 → 转折 surprised/uncertain → 共情 empathetic → 结尾 grateful/hopeful/determined
   - 角色差异化：host=引导/共情/好奇/惊讶；guest=专业/自信/深沉/感慨
8. **元数据**（每期）：title（简洁有吸引力）、creationNote（创作说明）、
   description（2-3 句简介）、tags（3-5 个话题标签）、coverKeywords（2-4 个英文图片搜索关键词，画面感强）

### ⑤ TTS（`pnpm editor tts <id> --script script.json [--language zh|en] [--guest <platform>]`）

- **统一走服务端端点**（`POST /v1/editor/tts`）——编辑本地不直连 Fish Audio，**Fish key 只配在
  服务端**（Railway env），编辑无需任何 TTS 密钥
- host（主持人）= 投稿人采样：服务端从投稿人记录取用（R2 + 表内转录）
- guest（AI 嘉宾）= **声线在服务端配置**（guest_voice_samples 表 + R2）：
  - `--guest <platform>` 指定嘉宾（claude/chatgpt/deepseek/gemini/kimi/doubao/tongyi/perplexity）
  - 服务端按 guestId + 语言取声线（同语种优先 → 兜底任意语种）；未配置 → 422 提示先上传
  - 查看嘉宾与声线状态：`pnpm editor guests`（管理入口）
  - 声线管理：`pnpm editor guest-voice <guestId> --audio <file> [--language zh] [--transcript "..."]`
  - 嘉宾称呼/简介（节目中的称呼）也在服务端：`pnpm editor guest-set <guestId> --name "..." [--intro "..."]`
- 逐段合成（每段一个请求，失败可重试单段）；产物 `seg-NN.mp3` + `segments.json`
- 单段失败：汇报错误（服务端 Fish 余额/限流/超时），按提示重跑

### ⑥ 合成（`pnpm editor merge <id> [--language zh|en]`）

- **intro/outro 统一自动匹配节目语言**：`tools/dailog-editor/assets/intro.{lang}.mp3` / `outro.{lang}.mp3`
  （仓库已提供 zh/en 两套）——目标语言缺失自动 **fallback 英文**；都缺失则警告跳过
- 段间自动插 0.6s 静音；`--intro/--outro` 可显式指定本地文件临时替换
- 产物 `final.mp3` + 时长/大小；`open final.mp3` 试听（**发布前必须试听**：音色/断句/情绪标签是否正常）

### ⑦ 封面（`pnpm editor cover <id> "<关键词>"`）

- 关键词用脚本 coverKeywords（可多组，选画面感最好的）；Pexels 搜索下载到草稿目录
- 无 PEXELS_API_KEY：可换其他图源/让编辑提供；实在没有 → 不传封面发布（播放页自适应）

### ⑧ 发布 / 拒审（与编辑确认后执行）

```bash
pnpm editor publish <id> --title "…" \
  [--description "…"] [--tags a,b] [--language zh] [--guest claude] [--cover cover.jpg] [--audio final.mp3]
# 成功后：episode 直接 published（期号 max+1），投稿人收到「dailog 第 N 期」通知+邮件
pnpm editor reject <id> --reason "拒审原因（必填，投稿人可见）"
```

## 进度与恢复（会话中断不丢）

每个命令完成时自动写进度标记 `drafts/{id}/progress.json`（step + 时间）。对话中断/退出后，
**新对话直接恢复断点**：

```
① 会话初始化（选环境 → auth-status，token 仍在直接可用）
② pnpm editor progress <submissionId>   → 显示进度 + 下一步 + 草稿产物清单
③ 按提示继续：tts → merge → cover → publish（已有产物自动跳过重复步骤）
```

产物全部在草稿目录持久（对话 JSON/脚本/分段音频/final.mp3/封面），无需重做已完成的步骤。

## 草稿目录（db-ops 风格，gitignored）

`.dailog-editor/drafts/{submissionId}/`：脚本 JSON、host 采样（webm/wav/transcript）、
分段音频、final.mp3、封面。发布成功后**保留**（可重新生成对比）；如需重做，删除该目录后从 fetch 重来。

## 红线

1. **不伪造内容**：网页拉取失败/内容无法提取 → 如实汇报，不凭猜测生成脚本
2. **脚本必须符合 dailog 标准**：固定开场结构（自我介绍 + Dailog 概念 + 双方称呼不可变）、
   5-10 分钟、四维价值聚焦；纯寒暄对话 → 建议拒审
3. **发布前必须试听**（open final.mp3）：音色克隆异常/断句错误/情绪标签未生效 → 修好再发
4. **发布/拒审是外发动作**：先与编辑确认（标题/封面/拒审原因），确认后一次执行
5. **拒审原因必填且具体**：投稿人 /me/submits 可见，邮件也会发送——写清楚为什么
6. **密钥/token 不出本地**：`.dailog-editor/.env` 与 `session.json` 均 gitignored + chmod 600；
   汇报中不打印 token/key；登录走浏览器授权（密码不落盘）
