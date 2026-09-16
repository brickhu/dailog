# 语感打磨：给台词添加 TTS 标记

要打磨的台词在 system 的「要打磨的台词」里。

先通读全部 `segments`，理解完整的对话关系、上下文、认知转折和双方回应，再逐句处理。

你的任务不是改写台词，而是决定：

> **这一句话应该“怎么说”，才能听起来像真人在当下说出来。**

重点处理：

* 情绪
* 语气
* 停顿
* 笑声等自然副语言
* 重点词强调

## 核心原则

> **自然优先，表演其次。**

不要给每句话都加情绪。

大多数台词可以保持无标记。

只有当情绪、语气、停顿或音效能够明显改善真人感时，才添加标记。

不要为了增加变化而强行改变情绪。

同一种情绪可以连续出现。

相邻段落也可以使用相同情绪，只要上下文真实支持。

不要机械要求每一段都回应上一段的情绪。

应该优先判断：

> **说话的人此刻在做什么？**

例如：

* 探索
* 追问
* 回应
* 犹豫
* 质疑
* 确认
* 反驳
* 想通
* 惊讶
* 共鸣
* 解释
* 强调
* 开玩笑
* 放松下来

然后决定是否需要 TTS 标记。

## 1. 重点词强调

把一句话里真正承重的词前面加 `[emphasis]`。

优先考虑：

* 对比项
* 转折后的结论
* 关键概念
* 专有名词
* 关键数字
* 真正需要听众注意的词

`[emphasis]` 必须紧贴被强调的词，中间无空格。

通常一句 1 处，最多 2 处。

不要连续强调多个词。

不要每句话都强调。

整篇应该有自然的重音变化，而不是平均撒点。

例如：

```text
就是[emphasis]强烈的自由导向，特别讨厌被束缚。
```

不要：

```text
[emphasis]那个[emphasis]自由导向
```

## 2. 情绪与语气

情绪标记通常放在句首。

只有当一句话确实存在明显的情绪或表达状态变化时才添加。

不要为了制造变化而强行换情绪。

情绪强度可以根据上下文使用：

```text
[slightly X]
[very X]
[extremely X]
```

语气标记可以根据需要使用。

不要连续堆叠多个情绪或语气标记。

优先一个准确的标记，而不是多个模糊标记。

## 3. 对话回应

把整段对话当作一个连续的 interaction，而不是独立台词集合。

重点关注：

* Host 是否真的在回应 Guest
* Guest 是否真的在回应 Host
* 问题是否产生了好奇
* 回答是否产生了惊讶、质疑、认同或进一步思考
* 某句话是否改变了下一句话的表达状态

重要的是：

> **回应要有状态变化，但不要求每一段都有情绪标签。**

例如：

```text
Guest: 其实真正的问题不是技术本身，而是谁在决定它怎么被使用。
Host: [surprised] 等一下，这一点我还真没这么想过。
```

但如果下一句仍然是在认真追问，不要为了变化强行改成另一种情绪。

## 4. 思考与停顿

当说话者正在组织语言、重新思考、准备说出重要观点时，可以使用 `[pause]`。

只有明显具有中文口语思考感时，才补充「嗯……」。

不要为了制造真人感而大量添加「嗯」「呃」「那个」。

不要添加原脚本中不存在的口头禅。

优先使用停顿表现思考，而不是不断增加填充词。

## 5. 笑声与副语言

台词中已有：

* 「哈哈」
* 「呵呵」
* `haha`

直接替换成：

```text
[laughing]
[chuckling]
```

轻笑优先使用 `[chuckling]`。

不要保留原笑声文字。

可以在确实存在自然笑点、轻松反应或情绪落点时补充一次笑声。

没有真实笑点就不要加。

不要为了增加真人感而制造笑声。

## 6. 符号转文字

代码和数学符号必须转成适合朗读的词。

例如：

```text
= 等于
>= 大于等于
<= 小于等于
> 大于
< 小于
% 百分之
+ 加
- 减
× 乘
→ 变成
```

只处理需要语音化的符号。

## 7. 标记词表

只能使用以下标记，不得自创。

### 情绪

```text
happy sad angry excited calm nervous confident surprised satisfied delighted scared worried upset frustrated depressed empathetic embarrassed disgusted moved proud relaxed grateful curious sarcastic
```

```text
uncertain doubtful confused disappointed regretful hopeful nostalgic determined sympathetic anxious disdainful unhappy hysterical indifferent guilty ashamed jealous envious optimistic pessimistic lonely bored contemptuous compassionate resigned
```

### 语气

```text
whispering
shouting
screaming
soft tone
in a hurry tone
emphasis
```

### 音效

```text
laughing
chuckling
sobbing
crying loudly
sighing
groaning
panting
gasping
yawning
snoring
clear throat
```

### 特效

```text
audience laughing
background laughter
crowd laughing
```

不要使用词表之外的表达，例如：

```text
[thoughtful]
[thinking]
[smiling]
```

## 8. 标记分寸

标记应该让声音更自然，而不是让听众注意到 TTS 标记本身。

错误：

```text
[curious][emphasis] 嗯……[sighing] 怎么说呢，就是[emphasis]那个[emphasis]自由导向。
```

更自然：

```text
[curious] 嗯……怎么说呢，就是[emphasis]强烈的自由导向。
```

原则：

> **少而准。**

如果一句话即使不加标记也能自然表达，就不要加。

## 9. 文字纪律

除了：

* 规则 2 中允许添加的 TTS 标记
* 规则 4 中允许的笑声替换
* 规则 5 中允许的「嗯……」
* 规则 6 中的符号转文字

台词正文一个字都不能修改。

不换词、不拆句、不调顺序、不增删内容。

段数、顺序、speaker 一律保持不变。

即使发现：

* 悬空指代
* 立靶缺失
* 模板腔
* 表达不自然
* 内容逻辑问题

也不要修改台词。

这些问题属于上游。

## 10. 输出

只输出这一个 JSON 对象，不要解释，不要增加任何其他字段。

```json
{
  "segments": [
    {
      "speaker": "host",
      "text": "[curious] 嗯……第一个特征，怎么说呢——就是[emphasis]强烈的自由导向。"
    },
    {
      "speaker": "guest",
      "text": "打磨后的台词"
    }
  ]
}
```

要求：

* `segments` 与 system 中输入一一对应
* 条数不变
* 顺序不变
* `speaker` 不变
* 只允许修改 `text` 中的 TTS 标记、允许的符号文字化和规定的笑声处理
* 标记必须写入 `text`
* 输出必须是合法 JSON

## 11. 交付前自查

1. `segments` 的条数、顺序、speaker 与 system 输入完全一致。
2. 台词正文逐字保持一致，除规则允许的修改外，不改变任何字、标点、括号、空格或顺序。
3. 没有为了制造情绪变化而强行添加情绪。
4. 情绪和语气都符合上下文。
5. `[emphasis]` 紧贴被强调的词。
6. 没有连续堆叠无必要的标记。
7. 没有自创词表之外的标记。
8. 没有为了“真人感”大量添加「嗯……」、笑声或音效。
9. 朗读时整体应该像两个人自然交流，而不是两个人在表演脚本。
