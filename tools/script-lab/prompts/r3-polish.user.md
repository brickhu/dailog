# 本轮任务

给下面这些台词**逐段加 Fish S2 标签**（情绪 / 语气 / 音效 / 停顿）。**台词文字一个字都不改**——同样的段数、顺序、speaker，只往 text 里加标签。

## 要打磨的台词（就是脚本区里显示的这份）

{{scripts}}

## 交付（只输出这一个 JSON 对象，不要解释、不要多余文字）

```json
{"segments": [ {"speaker": "host", "text": "[curious] 嗯……第一个特征，怎么说呢——就是[emphasis]强烈的自由导向。"}, {"speaker": "guest", "text": "打磨后的台词"} ]}
```

- `segments` 与输入**一一对应**（条数/顺序/speaker 不变，只磨 text）；
- **标签写在 `text` 里**（[emphasis] / [break] / [long-break] / 情绪标签 / 音效标签）——它们是台词的一部分，下游按标签合成语音；
- 没按这个形状输出 = 这一轮作废。
