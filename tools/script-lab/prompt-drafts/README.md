# prompt-drafts（脚本流水线草稿区）

**生产未动**：`prompts/`、`server.mjs`、前端一律没改；这里全是草稿 + 一个本地跑批的 harness。

## 流水线现状

R1 选题 → R2 脚本（本目录的重点）→ R3 打磨 → R4 文案。

### R2 的口径（已收敛）

**一期 = 开头 → 对手戏 → 收尾**，一条线，不是拼接：

| 部分 | 字段 | 内容 |
|---|---|---|
| 开头① | `hostOpen` | `大家好，我是{{host.callName}}。今天我们和 {{brand}} 的 AI 嘉宾{{guests.0.name}}一起聊聊「XXX」这个话题。`（XXX＝话题名词，≤15 字，报"聊什么"不报"聊出什么"） |
| 开头② | `guestOpen` | `大家好，我是{{guests.0.name}}。你好啊，{{host.callName}}！关于「XXX」我也一直想聊聊。` |
| **对手戏** | `turns[]` | 8-12 个回合，每个回合一来一回：`ask`＝投稿人（30 字上下）／`answer`＝AI 嘉宾（100-150 字）。原则：**有问必有答，有说必有应** |
| 收尾① | `hostFeel` | 承接上一句 + `OK，感谢{{guests.0.name}}，今天聊下来的感觉是……` |
| 收尾② | `guestSum` | `不客气。总的来说：……`（钥匙在这里说出来） |
| 收尾③ | `hostOutro` | `好，那么我们就聊到这里，感谢大家收听 {{brand}}，我们下期见！` |

三条结构保证（不靠模型自觉）：

1. **说话人由槽位决定**（ask 恒为投稿人、answer 恒为嘉宾）——src 只决定"这话从哪来"；引错人（把对方的话塞进槽位）会被 `SRC_ROLE_MISMATCH` 逮住；
2. **独白在结构上不可能**——每回合固定两格，空一格会被 `EMPTY_ASK/EMPTY_ANSWER` 逮住；
3. **壳不是独立阶段**——开头两句与收尾三句就是这条线的头尾，没有单独的壳调用、没有模板拼接（早先的 `r2b-shell.*` 已删）。

**最高优先级**：对手戏的逻辑自洽 > 原文的照搬——读不通的原话换掉或弃拍，不许硬留，也不许为顺而编。
**内容纪律**：台词只能来自原文（判断词／程度词／数字不许改；不许编造投稿人的立场、意图、感受、观点、事实）；顺序、说法、接话可以改；原文里一问一答整对取用。

### 机器闸（`harness/gates.mjs`）+ 自检（`harness/selftest.mjs`）

**闸门改动后先跑 `node harness/selftest.mjs`**——它用合成数据逐项验证每道网是否会触发（26 项，全绿才算闸门是活的）。

只查机器能查的：出处（`NOT_FROM_SOURCE`／`SRC_ROLE_MISMATCH`）、判断词与数字（`STANCE_ADDED`／`NUMBER_INVENTED`）、独白（`MONOLOGUE`）、长度（`TOO_LONG`／`TOO_SHORT`／`ANSWER_TOO_LONG`）、壳词、骨架句豁免。审美不判。

### 回灌重写

未过闸门时把硬伤回灌给模型重写（最多 3 稿），修法写在回灌消息里。

## 文件

| 文件 | 状态 |
|---|---|
| `r2-script.system.draft.md` / `.user.draft.md` | **当前版本**（开头／对手戏／收尾 + 输出结构） |
| `r1-score.system.draft.md` | 仍在用（判别先行 + 校准集），但它输出的是 process 步骤表，R2 已不消费（只取 who/value/endpoint/solve）——待改 |
| `r3-polish.*` / `r4-meta.*` | **旧口径**（R/Q/M 保真分级、弧线），未按新口径对齐 |
| `harness/run.mjs` | 跑批：一次调用出稿 → 校验 → 未过则回灌 |
| `harness/gates.mjs` | 机器闸 |
| `outputs/episode-{2,4,6}.md` | 最近三期的成稿（design + 台词 + 校验） |

## 用法

```bash
cd tools/script-lab/prompt-drafts/harness
node run.mjs <sample.json> <r1.txt> <outPrefix> [--host=飞] [--guest=DeepSeek] [--brand=dailog]
```

嘉宾名缺省时会从 `source`／`sourceUrl` 推断（chat.deepseek.com → DeepSeek，doubao → 豆包……）。

## 已知未解决

- `SRC_ROLE_MISMATCH` 偶发（模型把投稿人的话放进 `answer`），三轮回灌不一定改得掉；
- 长度偶尔越界（1300-2600 之外），偏短的居多；
- R1 交付物、R3/R4 口径尚未与新 R2 对齐；
- 未接入 `prompts/` 与 `server.mjs`。