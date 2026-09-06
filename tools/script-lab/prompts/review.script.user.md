# 本期任务

审题已产出提案列表，编辑选定 **{{proposal.id}}**（评分 {{proposal.score}}）。沿选定提案的**主线问题链**，把对话原文剪成一段能听的二人对谈播客（口语约 5-15 分钟，以内容完整为准，不硬凑时长）。规则见前一条消息（剪辑规则）。

选定提案给的（方向与素材，**不是事实来源**；事实来源 = 对话原文）：
- 主线话题：{{proposal.main_topic}}
- 用户的困惑：{{proposal.confusion}}
- 困惑原话：{{proposal.confusion_quotes}}
- 问题链骨架：{{proposal.chain}}（turns 索引锚定）
- 事件：{{proposal.event.nodeId}} · 模态 {{proposal.event.modal}} · 引文 {{proposal.event.quote}}
- 落点方向：{{proposal.landingHint}}
- 方向建议：{{proposal.advice}}
- 链外可剪：{{proposal.offChain}}
- **成片骨架 storyline（编辑按此选稿——脚本结构必须遵循，见剪辑规则 §2.6）：**
  · 主线：{{proposal.storyline.topic}}
  · 认知事件：{{proposal.storyline.event}}
  · 起承转合：{{proposal.storyline.beats}}（每拍 step/who/text——拍内台词从原文取，拍 text 只是骨架不是台词）
  · 留给听众：{{proposal.storyline.takeawayKind}} / {{proposal.storyline.takeaway}}

# 第 1 步 · 按链认材料（内部进行，不写进最终 JSON）
按 chain 各节的 turns 索引在原文定位：
1. confusion 节：用户困惑原话所在；
2. reframe 节：AI 换框架/重塑那句（= 越界点，近原样保留）；
3. event 节：事件那一拍原话（**必须是原文原话**）。
**任何节点锚不住（turns 对不上 / 找不到原话）→ 停下回报，不要脑补替代。**

# 第 2 步 · 沿链剪
- 按前一条消息的规则剪：链上 host 提问全保留；reframe/event 近原样；困惑颗粒不磨平；guest 先接住再浓缩；长段穿插；offChain 不出现；节间跳跃补现场由头；全程现场时态。
- 落点按 landingHint 收：**移交动作 / 移交问题 / 移交瞬间三选一——不给结论**。
- 直接输出脚本对象（下方输出形状）。

# 数据

对话全文已在前序消息完整提供（唯一事实来源）。
主持人：{{host}}
嘉宾：{{guests}}
投稿建议：{{suggestion}}

# 输出形状

输出 JSON 的最外层就是这个对象（segments 完整非空）：

```json
{"segments": [{"speaker": "host", "text": "开场白台词"}, {"speaker": "guest", "text": "嘉宾回应台词"}, {"speaker": "host", "text": "第一个问题"}], "host": "主持人称呼", "guest": "嘉宾名", "lang": "zh"}
```