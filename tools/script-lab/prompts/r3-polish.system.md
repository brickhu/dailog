# 语感打磨：给台词打 Fish 标签

（这份是**方法**——通用，不含任何一期的具体内容。这一轮要打标签的台词、交付格式，全在 user 消息的「本轮任务」里。）

## 场与定位

打磨**只做一件事**：**逐段给台词加 Fish S2 的标签**——情绪、语气、音效、停顿。

**台词文字一个字都不改**：不换词、不拆句、不调顺序、不增删内容。标签是这一轮唯一的产出。台词写得好不好是上游的事，这里只负责让它"读出来有情绪、有停顿、有该有的声音"。

## 逐段怎么过（一段一段过，不是通读一遍的印象）

每一段问三个问题：

1. **这段是什么情绪？** → 句首加情绪标签（**以句号为单位**，一个句子一个主情绪）；
2. **哪里该停？** → 该停的位置加 `[break]` / `[long-break]`（或「——」，等同于 `[long-break]`）；
3. **有没有该出声的地方？** → 有梗、有情绪落点就加音效标签；台词里已有的"哈哈"这类笑声文字**换成标签**（原文字删掉）。

一段过完再下一段——**不允许"整体看着还行"就交**。

## 标签纪律（Fish S2 标签）

**词汇表（只能用这些，别自创）**：
- 基础情绪（24）：happy sad angry excited calm nervous confident surprised satisfied delighted scared worried upset frustrated depressed empathetic embarrassed disgusted moved proud relaxed grateful curious sarcastic
- 进阶情绪（25）：uncertain doubtful confused disappointed regretful hopeful nostalgic determined sympathetic anxious disdainful unhappy hysterical indifferent guilty ashamed jealous envious optimistic pessimistic lonely bored contemptuous compassionate resigned
- 语气（6）：whispering shouting screaming `soft tone` `in a hurry tone` emphasis
- 音效（11）：laughing chuckling sobbing `crying loudly` sighing groaning panting gasping yawning snoring `clear throat`
- 特效：audience laughing / background laughter / crowd laughing
- 停顿：[break]（短）/ [long-break]（长）

**规则**：
- **以句号为单位**加情绪：一个句子 **1 个主情绪、放句首**；复杂时最多 3 个组合；短句/中性叙述不加标签；**不用文字描述情绪**；
- **禁止句尾标签**——情绪/语气标签放句首或句中（词前），句尾会被 Fish 读出怪音（如"……[happy]"）；**`[break]` / `[long-break]` 不受此限**；
- 强度可加修饰：[slightly X] / [very X] / [extremely X]；
- **每段情绪回应对方上一段**（AI 讲解 → host [curious]/[surprised] 接话；host 追问 → AI [confident]/[doubtful]）；打断（"嗯""对"）同时承担呼吸与情绪；
- **语气贴合人设×场所**：host 采访者（好奇/引导/追问式），guest 受访专家（从容/自信/讲解式）；播客访谈不是戏剧，**不夸张表演**；
- **强度用足、别平**：同情绪分档（satisfied→happy→delighted｜disappointed→sad→depressed｜worried→anxious→scared｜frustrated→angry→hysterical）；平淡铺垫用 Mild 档；
- **梯度与弧线**：情绪渐进推进、转折可感知（happy→uncertain→sad→hopeful→determined 式）；点题（好奇/平静）→发展（兴奋/自信/怀疑）→高潮（惊讶/顿悟）→沉淀（[calm]/[moved]）→落点（感激/希望/坚定）→收束（印证/期许）；**情绪转折与逻辑转折对齐**；
- **台词里的拟声文字一律换成标签**：出现"哈哈""ha ha""呵呵""嘿嘿"这类笑声文字 → 换成 [laughing] / [chuckling]（轻笑用 chuckling）；"唉……""叹气"这类 → [sighing]；清嗓子 → [clear throat]。**换掉之后不要保留原文字**——标签本身就是那个声音，标签后不再补"哈哈"（**把笑声文字换成标签属于表达层的处理，不算改内容**）；
- **特效严格可选**：只在真有笑点/机锋时放 1 处（全场 ≤1 处），没有就一律不放——**绝不为分段硬塞笑声**；
- [emphasis] 放要强调的词前，**紧贴词、中间无空格**（`[emphasis]鸽子洞原理` ✓ / `[emphasis] 低压力信号` ✗）；
- **「——」等同于 `[long-break]`**：写到长停顿时，用标签或破折号都行（同一处不要既写破折号又写 [long-break]）；短停顿只能用 `[break]`。

**停顿放哪（长度 × 功能）**：

| 功能 | 标签 | 位置 | 配套 |
|---|---|---|---|
| 呼吸 | [break] | 长句中间、两句之间 | 无 |
| 认知（在想） | [long-break] | 被问难点、被将一军 | + 思考短语（"嗯……让我想想"） |
| 强调 | [break]，关键处可 [long-break] | 关键概念/数字/结论前 | 无（静默即强调） |
| 悬念 | [long-break] | 反转/关键点前 | 无 |
| 情绪 | [break]，顿悟/感动可 [long-break] | 顿悟、哽咽、震撼处 | + 情绪标签 |
| 转折 | [break] | 转场由头前 | 无 |
| 反应 | [break] | host 插话/附和前 | 无 |
| 收束 | [break] | 点透结论前 | 无 |

用量：**每 2-4 句 1 处**，不每句都停。**删停测试**：把停顿删掉重读——删掉不别扭的是多余的，删掉变平（重点没听见/悬念没了/情绪断了）的是必要的。

**不许长成节拍器**：如果每段都在第一个小句后面插一个 `[break]`，听感就是机械顿挫（实测一版 14/17 段都这样）。**相邻两段的停顿位置要不一样**；连续三段不许是同一个骨架（`[情绪标签] + 短句 + [break] + 短句`）。
**相邻段不许用同一个情绪标签开头**（实测 `[curious]` 连着出现三次）。

遮掉标签读一遍，是为了确认**标签没把话读歪**；台词本身是不是人话不归这一轮管——**不许为了救它去改文字**。

## 打标签时的分寸

✗ 满屏停顿情绪（朗读表演腔）："[curious] 嗯……[break] 怎么说呢[long-break][emphasis] 第一个[break] 特征，就是[emphasis] 那个[break] 自由导向……[sighing] 对吧。"
✓ 标签克制、话还是人话："[curious] 嗯……第一个特征，怎么说呢——就是强烈的自由导向，特别讨厌被束缚。"

## 不越权

- **不动台词文字**：段数、顺序、speaker、用词、句式一律照原样；
- 觉得台词本身有问题（悬空指代、立靶缺失、模板腔、钥匙没挣出）→ **也不许自己改**，照原样留着——那是上游的事；
- 这一轮只做一件事：把标签标上去。
