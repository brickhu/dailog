# 语感打磨：给台词添加「结构层」TTS 标记

要打磨的台词在 system 的「要打磨的台词」里。

先通读全部 `segments`，理解完整对话、上下文、双方关系、语气变化和认知推进，再逐句处理。

你的任务不是改写台词，而是：

> **让每一句话听起来像真人正在此刻说出来，而不是朗读一份已经写好的采访稿。**

**本环节只做能从文本与互动判断出来的那一层：**

* 重点词强调（`[emphasis]`）
* 思考停顿（`[break]` / `[long-break]`）
* 互动反应（靠停顿、重音、轻笑表达，不判断情绪）
* 笑声（`[laughing]` / `[chuckling]`）
* 叹气（`[sighing]`）
* 轻声（`[soft tone]`）

**本环节不打情绪标签。** `[curious]` `[doubtful]` `[happy]` 这类需要推断说话者内心状态的标签，自动判断不可靠，**由编辑在界面上手选**（界面里有完整情绪词表）。

原则：**宁可不标，也不要猜情绪。**

---

# 1. CORE PRINCIPLE

> **Actively shape the vocal performance.**

这是一个 **TTS performance-editing task**，不是简单的文本校对任务。

你应该主动寻找：

* 哪些地方应该产生反应；
* 哪些词应该被强调；
* 哪些地方应该停顿；
* 哪些地方自然会笑；
* 哪些地方该收轻声。

然后使用本环节允许的那 7 个标签（§17）。

但不要给每句话都加标记。

目标是：

> **有意识的声音变化 + 自然的真人感。**

不要为了“克制”而让整篇台词没有任何标记。

也不要为了“丰富”而让每句话都有标记。

---

# 2. READ THE WHOLE CONVERSATION FIRST

不要把每个 `segment` 当成孤立台词。

先理解：

* 谁在回应谁；
* 上一句话对当前台词产生了什么影响；
* 当前说话者是在追问、回答、解释、质疑、确认、犹豫还是重新思考；
* 当前台词在整个认知推进中处于什么位置；
* 哪些是普通交流；
* 哪些是重要转折；
* 哪些是情绪落点；
* 哪些是关键洞见。

然后再进行标记。

> **The emotional and conversational state belongs to the interaction, not to the segment.**

---

# 3. PERFORMANCE MOMENTS

主动寻找值得进行声音处理的时刻。

重点关注：

* opening
* immediate reaction
* curiosity
* surprise
* uncertainty
* disagreement
* hesitation
* realization
* important question
* turning point
* key distinction
* punchline
* emotional landing
* key insight
* closing reflection

**每个时刻落成一个具体标签，标签类型由时刻决定：**

| 时刻 | 首选标签 |
| --- | --- |
| reaction / surprise / disagreement | `[break]`（先顿一下）或 `[emphasis]`（把反对的那个词压重） |
| hesitation / realization / 组织答案 | `[break]` / `[long-break]` |
| 真正的笑点 | `[chuckling]` / `[laughing]` |
| turning point / key distinction / punchline / key insight | `[emphasis]` |
| 情绪落点 / 收着说 | `[soft tone]`（可加 `[break]`） |
| 真的叹一口气 | `[sighing]` |

**总量参考**：一篇 25–40 段的真实对谈，通常有 **8–15 处**值得处理的时刻。标完之后如果只有 0–3 处，几乎总是漏找——逐段再过一遍。反之，如果每一段都有标签，说明在凑数。

（这是"通常值"，不是配额：平淡的段落本来就没有时刻。）

不要因为一句话“理论上可以正常朗读”就跳过明显的时刻。

但也不要为了制造变化而强行加戏。

---

# 4. 情绪标签不在本环节范围内

`[curious]` `[doubtful]` `[happy]` 这类标签需要推断说话者此刻的内心状态。自动打磨判断不可靠——实测只会在**台词字面写着情绪词**的地方打对（"很高兴"→`[happy]`），其余一律判不准，最后退回 `[emphasis]`。

所以本环节不打情绪标签。**情绪由编辑在界面上手选**（界面里有 50+ 个情绪词及中文释义）。

如果某一行的语气确实关键，用本环节能可靠表达的手段去做：

* 停顿：`[break]` / `[long-break]`
* 重音：`[emphasis]`
* 笑声：`[chuckling]` / `[laughing]`
* 轻声：`[soft tone]`

判断依据是**互动功能**，不是内心状态：

> **这句话在对上一句做什么？**（质疑 / 让步 / 追问 / 恍然 / 认输 / 安慰 / 收住）

判断得出来，就用上面四种手段表达；判断不出来，就不标。

---

# 5. EMPHASIS

选词的判据不是“哪个词重要”，而是：

> **把哪个词换成它的反面，这句话的意思就变了？**

那个词才是重音所在（多为对比项、否定词、转折后的结论、关键数字）。

`[emphasis]` 只标**一个词**：

* 最长 4 个字；
* 不含标点、不含顿号、不含逗号；
* 紧贴该词、中间不留空格、放在词前。

```text
✓ [emphasis]成本    ✓ [emphasis]稀缺    ✓ [emphasis]没有    ✓ [emphasis]认知

✗ [emphasis]思考的过程本身   ✗ [emphasis]最强的那一条   ✗ [emphasis]新的内容形态
```

例如：

```text
The problem isn't [emphasis]implementation.

What changed was the [emphasis]cost of experimentation.

That's not the same as saying AI makes design [emphasis]easy.
```

一句通常 1 处，最多 2 处。

不要连续强调多个词。

不要强调虚词。

不要为了完成任务而机械强调。

不要把整个短语、分句或整句标上——那是“放大一段”，不是重音。

**句式陷阱**：中文里“不是 X，而是 Y”这类对比句会在一篇里反复出现。出现多次时**不要每次都标**——只在真正承重的那些时刻标（§3）。遇到就标，等于没做判断。

---

# 6. REACTION

当一句话是在直接回应上一位说话者时，优先考虑 reaction。

例如：

```text
[break] 等一下，我不确定这个结论成立。

[emphasis]真正的变量是成本，不是工具。

[chuckling] 好吧，这个说法我接受。

[soft tone] 我大概明白你在说什么了。
```

核心原则：

> **Make the response sound caused by the previous line.**

不要让每句话像独立录制的旁白。

---

# 7. THOUGHT IN ACTION

当说话者正在思考、犹豫、重新判断时，让声音体现这种即时性。

不要让说话者解释“自己正在思考”。

Prefer natural spoken expressions such as:

```text
"But now I'm wondering..."

"Wait, then what does that mean?"

"I'm not sure that's the real issue."

"But here's what I'm struggling with."

"That makes me think..."

"Hold on, if that's true..."
```

Avoid meta-narration such as:

```text
"I'm now beginning to reconsider this question."

"A question immediately came to mind."

"This made me start thinking about an important issue."
```

判断标准：

> **Does this sound like someone having the thought, or someone explaining to the audience that they are having the thought?**

Prefer the former.

---

# 8. PAUSE

使用 `[break]` 或 `[long-break]` 表现自然停顿。

**关键机制：`[break]` 紧贴标点符号时不生效——前后任一方向挨着标点，这个标签就等于没写。**

所以它**只能放在句子内部，左右都不挨标点**：

```text
✓ 我觉得[break]这件事不是成本问题。

✓ 真正难的不是实现[break]是让人愿意留下来。

✓ 那问题就变成[long-break]谁来承担这个代价。

✗ 我觉得这件事不是成本问题。[break] 那什么是成本问题？   ← 前面是句号，不生效

✗ 我觉得这件事不是成本问题[break]，那什么是成本问题？    ← 后面是逗号，不生效

✗ 嗯……[break]我还真没这么想过。                        ← 前面是省略号，不生效
```

**推论：句与句之间的停顿没法用 `[break]` 标**（那里永远有标点）。句间停顿交给台词本身的标点；`[break]` 只用来标**句内**的那一下：换气、犹豫、说到一半才想明白。

优先考虑（都发生在句内）：

* 组织答案时卡一下；
* 突然意识到某件事；
* 重要观点出现前的那一下；
* 说话者正在重新判断。

不要给所有长句加 pause。

Pause 必须有明确的 conversational reason。

---

# 9. “嗯……”

只有当说话者真的需要一个口语化的起步停顿时，才补：

```text
嗯……
```

例如：

```text
嗯……我还真没这么想过。
```

不要大量添加：

* 嗯……
* 呃……
* 那个……

不要为了制造“真人感”而制造口头禅。

如果 `[break]` 已经能够表达思考，就不要再添加“嗯……”。

---

# 10. LAUGHTER AND CHUCKLING

主动寻找自然的笑点。

适合添加笑声的场景：

* joke
* playful disagreement
* irony
* self-aware humor
* light embarrassment
* amusing realization
* emotional release

轻笑优先使用：

```text
[chuckling]
```

明显的笑使用：

```text
[laughing]
```

例如：

```text
[chuckling] Okay, that's actually a fair point.
```

不要因为“这是播客”就自动加笑声。

但是：

> **如果对话中存在明显的幽默、调侃或轻松落点，应主动考虑加入 `[chuckling]` 或 `[laughing]`。**

如果整篇存在明显笑点，却完全没有任何 laughter cue，必须重新检查。

如果原台词已经出现：

* 哈哈
* 呵呵
* haha

必须直接替换为：

```text
[laughing]
```

或：

```text
[chuckling]
```

替换后不保留原笑声文字。

---

# 11. 叹气

`[sighing]` 只在这种时候用：台词本身带着**释然、无奈、或者把一口气吐出来**的意思（“算了”“也只能这样了”“说到底”）。

不要为了增加“真人感”而随机加入。

---

# 12. 轻声

`[soft tone]` 用于**明显收着说**的地方：承认一件不太想说的事、安慰对方、把话说轻。

它标的是“怎么说”，不是“什么心情”。

---

# 13. CUE DENSITY

标记应该是**主动寻找，而不是平均撒点**。

一篇 25–40 段的真实对谈，整体大约 **8–15 处**，并且分布在几类里：

* `[emphasis]`：转折 / 对比 / 关键区别处（通常占一半左右，不该占满）；
* `[break]` / `[long-break]`：真实思考、犹豫、临时改口处；
* `[chuckling]` / `[laughing]`：真实笑点或轻松落点；
* `[soft tone]`：收着说的地方。

**不要让整篇只有一种标签**——如果最后只剩 `[emphasis]`，说明反应、停顿、笑意都没有被听出来。

也不要让每一句都被标签包围。

一个合理的整体感觉应该接近：

```text
ordinary
ordinary
[break]
ordinary
[emphasis]
ordinary
ordinary
[chuckling]
ordinary
[emphasis]
ordinary
[soft tone]
ordinary
```

而不是：

```text
ordinary
ordinary
ordinary
ordinary
ordinary
ordinary
ordinary
```

也不是：

```text
[emphasis]
[break]
[emphasis]
[chuckling]
[emphasis]
[break]
[emphasis]
[soft tone]
```

核心原则：

> **Do not optimize for minimum cues or maximum cues. Optimize for meaningful cues.**

---

# 14. FINAL CUE PASS

完成第一轮标记后，必须重新通读整个脚本，专门寻找被遗漏的 performance moments。

重点检查：

1. 是否存在明显反应却没有反应处理（`[break]` / `[emphasis]` / `[chuckling]` / `[soft tone]`）；
2. 是否存在自然的思考停顿却没有 `[break]`；
3. 是否存在真正的笑点却没有 `[chuckling]` 或 `[laughing]`；
4. 是否存在转折 / 对比 / 关键区别却没有 `[emphasis]`；
5. 是否存在连续很多 substantive segments 完全平铺；
6. 是否所有标签最后都只剩 `[emphasis]`——若是，回到 §3 重找时刻。

如果发现明显 performance opportunity，补充合适的 cue。

然后再次删除那些：

* 装饰性的；
* 重复的；
* 不符合语境的；
* 过度表演的。

---

# 15. TEXT FIDELITY

除了下面明确允许的修改：

* 添加 TTS markers；
* 笑声文字替换；
* 添加“嗯……”；
* 符号转文字；

台词正文一个字都不能改。

不允许：

* 改写；
* 改词；
* 删除；
* 添加新的内容；
* 拆句；
* 合并句子；
* 调整顺序；
* 修复语病；
* 优化表达；
* 修改标点。

如果发现：

* 模板腔；
* 逻辑问题；
* 悬空指代；
* 不自然表达；

也不要修改。

这些属于上游 Interview Generator。

---

# 16. SYMBOL TO SPEECH

代码和数学符号必须转换为适合 TTS 朗读的词。

例如：

```text
=    等于
>=   大于等于
<=   小于等于
>    大于
<    小于
%    百分之
+    加
-    减
×    乘
→    变成
```

只转换需要语音化的符号。

不要为了插入 marker 而删除或改变原标点。

---

# 17. ALLOWED MARKERS（只有这 7 个）

```text
emphasis      重读紧跟其后的那个词
break         短停顿
long-break    长停顿
laughing      笑
chuckling     轻笑
sighing       叹气 / 释然
soft tone     轻声
```

**不允许使用情绪标签。** `[curious]` `[happy]` `[doubtful]` `[worried]` 这类一律不打——本环节不判断情绪（见 §4），编辑会在界面上手选。

也不要自创其他标签，不要使用：

```text
[thoughtful] [thinking] [smiling] [pause] [emphasis ]（标签后带空格）
```

---

# 18. MARKER PLACEMENT

### `[soft tone]`

放在需要改变说法的位置。

### `[emphasis]`

必须紧贴被强调的词：

正确：

```text
[emphasis]really
[emphasis]freedom
```

错误：

```text
[emphasis] freedom
```

### Audio effects

放在实际发生声音的位置。

### Break

放在**句内、左右都不挨标点**的位置——挨着标点就不生效（见 §8）。

---

# 19. FINAL QUALITY CHECK

输出前逐项检查：

1. `segments` 数量与输入完全一致；
2. 顺序完全一致；
3. `speaker` 完全一致；
4. 除允许的规则外，台词正文完全不变；
5. 每一个标签是否都能追溯到 §3 里一个真实的表演时刻；
6. 重要 reaction 是否被听得出（用 `[break]` / `[emphasis]` / `[chuckling]` / `[soft tone]`）；
7. 是否对自然停顿使用了 `[break]` / `[long-break]`；
8. 是否对真实笑点使用了 `[chuckling]` / `[laughing]`；
9. 是否存在大量 substantive dialogue 完全没有任何 vocal variation；
10. 是否出现了为了凑数量而添加的 marker；
11. 所有 marker 都来自允许词表；
12. `[emphasis]` 是否只标一个词（≤4 字、不含标点）并紧贴该词；
13. 是否完全没有使用情绪标签（本环节不允许）；
14. Host 和 Guest 是否听起来像真正的 conversation participants；
15. 整体是否像真人说话，而不是演员在表演文本。

最终判断：

> **Can you hear where they react, hesitate, rethink, laugh, pause, and emphasize?**

如果完全听不出来，说明标记不足，需要重新进行 Final Cue Pass。

如果几乎每句话都有标记，说明过度，需要删除无意义的 cue。

---

# 20. OUTPUT

只输出一个 JSON 对象。

```json
{
  "segments": [
    {
      "speaker": "host",
      "text": "嗨，欢迎回到 dailog。[break] 今天想聊一个我最近一直没想清楚的问题。"
    },
    {
      "speaker": "guest",
      "text": "[chuckling] 很高兴回来聊这个。"
    }
  ]
}
```

要求：

* `segments` 与 system 输入一一对应；
* 条数不变；
* 顺序不变；
* `speaker` 不变；
* 只处理 `text`；
* TTS marker 必须写在 `text` 中；
* 必须返回合法 JSON；
* 不得输出任何解释、Markdown 或额外文字。

如果输出结构不符合上述契约，则本轮结果无效。
