# 语感打磨：给台词打 TTS 标记

要打磨的台词在 system 的「要打磨的台词」里。

**逐句读**，结合内容的含义，给每一句台词加恰当的 TTS 标记：**情绪、语气、音效、重点词强调**。

## 六条规则

1. **重点词强调**：把一句话里真正承重的词前面加 `[emphasis]`——对比项、转折后的结论、专有名词、关键数字。**紧贴词、中间无空格**，一句话 1 处（最多 2 处），不要每句都加、也不要一句里连着加。**整篇要听得出重音，别一路平铺**：平均每两三段至少有一处。
   - ✓ `就是[emphasis]强烈的自由导向，特别讨厌被束缚。`
   - ✓ `这不是一个[emphasis]基本素养吗？`
   - ✗ `[emphasis]那个[emphasis]自由导向`（一句里连加，而且强调在虚词上）
   - ✗ `[emphasis] 低压力信号`（标记后面多了空格）
2. **情绪标记**：以句为单位（**看 `。`**）在**句首**加情绪标记。情绪要结合上下文和这句话的含义匹配，不是每句都换。强度可加修饰：`[slightly X]` / `[very X]` / `[extremely X]`。
3. **符号转文字**：代码和数学符号转成能读出来的词——`=` 等于｜`>=` 大于等于｜`<=` 小于等于｜`>` 大于｜`<` 小于｜`%` 百分之｜`+` 加｜`-` 减｜`×` 乘｜`→` 变成。
4. **笑声文字换标签**：台词里出现「哈哈」「呵呵」「haha」这类笑声词，**直接替换**成 `[laughing]` / `[chuckling]`（轻笑用 chuckling）——换掉之后**不保留原文字**。
5. **补笑声（可选）**：结合上下文，真有笑点、有梗、有情绪落点的地方，可以补一处 `[laughing]` / `[chuckling]`；没有就一律不补（全篇最多一处，**绝不为分段硬塞**）。
6. **思考性停顿**：被打断、或被问到需要组织一下才能答的地方，在句子**前面**加「嗯……」——真人在想的时候就是这样。

## 标记词表（只能用这些，别自创）

**情绪标记**（放句首；语气标记可放句中词前；**不放句尾**——Fish 会把句尾标记读成怪音）
- 基础情绪（24）：happy sad angry excited calm nervous confident surprised satisfied delighted scared worried upset frustrated depressed empathetic embarrassed disgusted moved proud relaxed grateful curious sarcastic
- 进阶情绪（25）：uncertain doubtful confused disappointed regretful hopeful nostalgic determined sympathetic anxious disdainful unhappy hysterical indifferent guilty ashamed jealous envious optimistic pessimistic lonely bored contemptuous compassionate resigned
- 语气（6）：whispering shouting screaming `soft tone` `in a hurry tone` emphasis

**音效标记**
- laughing chuckling sobbing `crying loudly` sighing groaning panting gasping yawning snoring `clear throat`
- 特效（可选）：audience laughing / background laughter / crowd laughing

另外两条纪律：**相邻两段不许用同一个情绪标记开头**；**每段的情绪回应对方上一段**（guest 讲解 → host [curious]/[surprised] 接话；host 追问 → guest [confident]/[doubtful]）。

## 文字纪律

**除了规则 3（符号转文字）和规则 6（句前加「嗯……」），台词文字一个字都不改**：不换词、不拆句、不调顺序、不增删内容；段数、顺序、speaker 一律照原样。

觉得台词本身有问题（悬空指代、立靶缺失、模板腔）→ **也不许自己改**，照原样留着——那是上游的事。

## 分寸

✗ 满屏标记（朗读表演腔）："[curious][emphasis] 嗯……[sighing] 怎么说呢，第一个特征，就是[emphasis]那个[emphasis]自由导向……对吧。"

✓ 标记克制、话还是人话："[curious] 嗯……第一个特征，怎么说呢——就是[emphasis]强烈的自由导向，特别讨厌被束缚。"

## 交付（只输出这一个 JSON 对象，不要解释、不要多余文字）

```json
{"segments": [ {"speaker": "host", "text": "[curious] 嗯……第一个特征，怎么说呢——就是[emphasis]强烈的自由导向。"}, {"speaker": "guest", "text": "打磨后的台词"} ]}
```

- `segments` 与 system 里的输入**一一对应**（条数/顺序/speaker 不变，只磨 text）；
- **标记写在 `text` 里**（情绪 / 语气 / 音效标记，以及 `[emphasis]`）——它们是台词的一部分，下游按标记合成语音；
- 没按这个形状输出 = 这一轮作废。

## 交付前自查（逐条过一遍，任一条不合格就自己改到合格再输出）

自查只管**形式**（段数、文字、标记位置），**不要因为自查而少加标记**——规则 1、2 该加的要加足。

1. 段数、顺序、`speaker` 与 system 里的输入**完全一致**；
2. **文字逐字照抄**：标点、`「」`、`——`、括号、空格一个都不许动。**不许为了放标记而删掉逗号**（`每一期，我会…` 磨成 `每一期我会…` = 作废）；
3. 情绪标记都在句首（`。` 之后），相邻两段开头不用同一个标记；
4. `[emphasis]` 紧贴被强调的词，中间没有空格；
5. **标记全部出自上面的词表**，没有自创（`[thoughtful]`、`[thinking]`、`[smiling]` 这类词表里没有的一律不许用——Fish 不认识，会念出来）。
