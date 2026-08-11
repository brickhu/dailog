# Spike 发现记录：Fish Audio TTS 集成

> 日期：2026-08-02 · 状态：**完成**（实测通过） · 脚本：`scripts/spikes/fish-audio.mjs`（`npm run fish` / `npm run fish:limits`）
> 前置：`docs/spikes/tts-comparison.md`（供应商选定 Fish Audio）· 配套：ARC §3.3（管线）

## 结论摘要（TL;DR）

- **多说话人单次调用可用**：一次请求混排「克隆音色 + 固定音色」，形态为 `text` 内嵌 `<|speaker:N|>` 标签 + `reference_id` 数组（不是 text/chunks 数组——与任务预期不同，见 §2）
- **零样本按需克隆可用**：`application/msgpack` + `references: [{audio: 原始音频字节, text: 转录}]` 每请求内联，无需预注册音色——**产品核心刚需（重录即时生效）验证通过**
- **响应形态**：成功 = 原始音频字节流（`Transfer-Encoding: chunked`，无 JSON 包装），`audio/mpeg`；失败 = JSON 错误体
- **单请求字符上限**：实测 3000/6000/12000 中文全部成功 → **上限 ≥ 12000 字符（36000 UTF-8 字节）**，未再上探（§5）
- **计费**：官方定价页确认 s2-pro/s2.1-pro/s1 = **$15/百万 UTF-8 字节**（与 tts-comparison.md 口径一致）；本账号 **0 API 额度** → 付费模型全部 `402 Insufficient API credit`，所有 spike 均在免费模型 **`s2.1-pro-free`（$0）** 上完成
- **网络**：`api.fish.audio` 本网络直连超时，必须走本地 SOCKS5（`127.0.0.1:1081`，远端 DNS）
- **坑**：参考音频转录文本无法自动获取（`/v1/asr` 同样 402）→ 用了占位文本；默认 `temperature=0.7` 下同文本两次合成节奏/时长波动明显（§6）；JSON 无法携带原始音频（无 base64 字段），零样本必须 msgpack

## 1. 认证与端点

| 项 | 值 |
|---|---|
| 端点 | `POST https://api.fish.audio/v1/tts` |
| 认证 | `Authorization: Bearer <FISH_API_KEY>`（控制台 `fish.audio/app/api-keys`） |
| 必需 header | `model`：`s1` \| `s2-pro` \| `s2.1-pro` \| `s2.1-pro-free`；`Content-Type: application/json` 或 `application/msgpack` |
| 错误形态 | 401/402/404 → JSON `{status, message}`；422 → 数组 `[{loc, type, msg}]`（`loc` 指向违规字段） |
| 零额度错误原文（实测） | `{"message":"Insufficient API credit. API credit is managed independently from platform credit. Please visit https://fish.audio/app/developers to view your API credit balance or add funds.","status":402}` |

额度查询：`GET /wallet/self/api-credit?check_free_credit=true`（实测返回 `credit=0.0 free_credit=false`）。

## 2. 多说话人请求结构（最终确认形态）

**实测可用**（s2.1-pro-free，一次调用 6 段对话，200 / 440,946 bytes / 27.6s / ~9s 完成）：

```json
// POST /v1/tts  application/json
{
  "text": "<|speaker:0|>欢迎收听 dailog，今天我们聊聊如何把 AI 对话变成播客。<|speaker:1|>这个想法很有意思，核心就是把真实的对话变成可订阅的内容。<|speaker:0|>……",
  "reference_id": ["<主持人音色模型id>", "<嘉宾固定音色id>"],
  "format": "mp3",
  "mp3_bitrate": 128
}
```

- **与任务预期的差异**：不是 `text`/`chunks` 数组（每个 chunk 带 reference），而是 **`text` 内嵌 `<|speaker:0|>` / `<|speaker:1|>` 标签 + `reference_id` 数组（顺序对应 speaker 序号）**。多说话人仅 S2-Pro 系模型（`s2-pro`/`s2.1-pro*`），`s1` 不支持（422）。
- **主持人（克隆音色）**：需要先有音色模型 `_id` → `POST /model` 上传参考音频（fast 训练）拿到（见 §3-b）。
- **嘉宾（固定音色）**：`reference_id` 直接用音色库模型 `_id`（获取方式见 §8）。
- 零样本多说话人（两方都内联音频）：`references` 二维数组 `[[speaker0 的 samples], [speaker1 的 samples]]`（官方文档；**2026-08-04 已实测通过**——`scripts/spikes/fish-references2d.mjs`，s2.1-pro-free，一次请求出双人音频 13.4s；**MediaRecorder WebM 样本直接内联也被接受**，无需转码）。

## 3. 参考音频传法（两条路都实测可用）

**a) 零样本按需（每请求内联，推荐）——产品核心路径**

```bash
# Content-Type: application/msgpack（JSON 无法携带原始音频，官方无 base64 字段）
# body = msgpack { text, references: [{audio: <WAV 原始字节>, text: "<参考音频转录文本>"}], format: "mp3" }
```

- `ReferenceAudio = {audio: 原始音频字节, text: 转录文本}`（两者必填）；官方建议 10–30s 干净人声（`sample-voice.wav` 19.2s 符合）
- 实测：单说话人 200；逐段 3 次主持人调用全部 200
- **是零样本按需、每请求生效**：参考音频随请求携带，无预注册/训练环节，重录即时生效 ✓

**b) 先上传建音色 → `reference_id`（官方 endpoint 是 `/model`，不是 `/v1/voices`）**

```bash
curl -X POST https://api.fish.audio/model \
  -H "Authorization: Bearer $FISH_API_KEY" \
  -F "type=tts" -F "train_mode=fast" -F "title=my-voice" -F "visibility=private" \
  -F "voices=@sample-voice.wav" -F "tags=zh"
# 201 → { "_id": "...", "state": "trained", ... }
```

- 实测：**0 额度下也可用**；上传 1.7MB WAV 到返回 `state=trained` 约 5–8s（fast 训练即时完成）
- 之后 TTS 用 `reference_id=<_id>`（JSON 即可，无需再带音频）
- 不传 `texts` 转录时服务端会自动跑 ASR（训练时内部处理，未计费），但转录不对外暴露（`GET /model/{id}` 的 `samples` 为空）
- 第三方教程中的 `/v1/references/add`（base64 上传）**不在官方 OpenAPI 中**，不采用

## 4. 响应形态

- 成功：**原始音频字节流**，`Transfer-Encoding: chunked`，无 JSON 包装；直接落盘即得文件
- `format`：`mp3`（默认，实测 128kbps 44.1kHz 单声道）/ `wav` / `pcm` / `opus`；`sample_rate` 默认 44100
- 失败：JSON 错误体（§1）

## 5. 单请求字符上限（实测）

OpenAPI schema 对 `text` 无 `maxLength` 约束 → 服务端限制，实测为准。测试条件：s2.1-pro-free + 主持人音色 `reference_id`（JSON），中文占位句重复至目标字数：

| 请求字符数 | UTF-8 bytes | 结果 | 生成耗时 | 输出音频时长 | 文件 |
|---|---|---|---|---|---|
| 3000 | 9000 | **200 ✅** | 137s | 426.7s（7.1 分钟） | `out-limits/limit-3000.mp3`（6.8MB） |
| 6000 | 18000 | **200 ✅** | 288s | 827.1s（13.8 分钟） | `out-limits/limit-6000.mp3`（13.2MB） |
| 12000 | 36000 | **200 ✅** | 518s | 1665.9s（27.8 分钟） | `out-limits/limit-12000.mp3`（26.7MB） |

- **结论：单请求字符上限 ≥ 12000 中文（36000 UTF-8 字节）**，未继续上探（免费模型再大的请求无产品意义；如需确认硬上限可加测 20000+，单次 ~15 分钟生成）
- 服务端按 `chunk_length=300`（默认）自动切块合成，响应仍为单条音频流
- 语速实测 ≈ **7.2 字/秒**（3000 字→426.7s，12000 字→1665.9s，线性）→ 与官方「1M UTF-8 字节 ≈ 12 小时语音」口径吻合（333k 字 / 7.2c/s ≈ 12.9h）✓
- **付费模型下费用参考**：12k 字符 ≈ 36KB = 36,000 字节 = 0.036 × 10⁶ → `$15/M × 0.036` = **$0.54/次**；一个 10 分钟节目约 3000 字 = 9,000 字节 → `$15/M × 0.009` ≈ **$0.135 ≈ ¥0.97**，与 tts-comparison.md 每期 ≈¥0.97 一致 ✓（2026-08-11 修正：原稿此处有 1000 倍算术错误——36KB 应为 $0.54 而非 $0.00054，3000 字应为 $0.135 而非 $0.00014）

## 6. 克隆质量（相似度与一致性）

> 诚实声明：本 spike 由文本代理执行，**无法试听**。下列为「可客观验证的替代指标」；主观相似度需人工试听 `out-host-1.mp3`（零样本克隆）对比 `sample-voice.wav` 打分。

- **合成文件有效性**：全部 200 且为合法 MP3（44.1kHz / 128kbps / 单声道，afinfo 验证）
- **一致性（同文本两次合成，同一参考音频）**：

| 合成 | 文本 | 时长 | 字节 |
|---|---|---|---|
| `out-host-1.mp3` | 主持人第 1 段 | 7.81s | 124,968 |
| `out-host-1-repeat.mp3` | 同左 | 6.90s | 110,340 |
| `out-host-zeroshot.mp3` | 同左（独立会话） | 11.49s | 183,901 |

- 同文本时长波动 **~12%–46%**：默认 `temperature=0.7` 随机采样，口播节奏/停顿存在明显随机性；schema 无 `seed` 参数，未见确定性输出手段 → **长节目如需稳定节奏，建议调低 `temperature`（0.3 量级）做 A/B 或按段重试**
- **转录文本影响**：`/v1/asr` 在 0 额度下 402，无法自动获取参考音频转录 → 使用了占位文本「你好，欢迎收听 dailog。这是参考音频的转录文本，用于声音克隆测试。」。官方文档明确「转录准确度对克隆质量重要」，**音质评测请以人工复听为准**（转录修正后克隆质量预期更好）

## 7. 计费（实测 vs 文档）

> ⚠️ 首例真实账单已实测（2026-08-11）：**195,000 字节 = $1.89 → 实际费率 ≈ $9.7/百万字节**（约为官方价 $15/M 的 65%；**账单全部来自付费层模型、无免费额度抵扣**，为干净的付费层费率）；折算一期 3000 字 ≈ $0.087 ≈ **¥0.63**，5000 字上限 ≈ ¥1.05。样本仅一例（未按模型拆分），建议上线前按模型维度复核费率与计费口径（见本节约费校验项）——**计费/定价决策以实测为准，官方价 $15/M 作为保守上限**。

- 官方定价页确认：`s2-pro` / `s2.1-pro` / `s1` = **$15/百万 UTF-8 字节**（≈18 万英文单词或约 12 小时语音）；`s2.1-pro-free` = **$0**。与 `tts-comparison.md` 的 $15/M 口径一致 ✓
- **计费依据 = 输入文本 UTF-8 字节**（非输出时长/字符数）；中文 1 字 = 3 字节
- 实测：0 额度下付费模型 → 402（错误原文见 §1）；免费模型全流程 200 且额度不变（credit 0 → 0）
- 响应头无计费/用量字段（仅 Cloudflare 标准头）→ **真实扣费无法在 0 额度账号直接观察**；建议：充值后调用 `GET /wallet/self/api-credit` 对比调用前后 `credit` 差值，验证与 `输入字节数 × $15/M` 一致
- 免费模型限制：官方定价页未给出 s2.1-pro-free 的额外限制说明（仅价格 $0），实测多说话人与零样本均可用

## 8. 嘉宾固定音色 reference_id 获取

- **控制台**：fish.audio 音色库（Voice Library）浏览 → 复制模型 `_id` → 填入 `GUEST_REFERENCE_ID`
- **API**：`GET /model?language=zh&page_size=20&sort_by=task_count` → `items[]._id`（本次实测挑选：`7f92f8afb8ec43bf81429cc1c9199cb1`（AD学姐，任务量 372k），脚本会打印所选 id/title）
- `GUEST_REFERENCE_ID` 留空时脚本自动从音色库挑选；无效 id 会得到 404

## 9. 阻碍 / 坑（Gotchas）

1. **网络**：`api.fish.audio` 直连超时（本网络），必须走本地 SOCKS5 `127.0.0.1:1081` 且需**远端 DNS**（`socks5h`；`socks5` 本地解析也会超时）。脚本内置 SOCKS5 握手，`SOCKS_PROXY` 可覆盖（设 `none` 直连）
2. **0 额度**：付费模型 402；免费模型 `s2.1-pro-free` 全功能（含多说话人、零样本）实测可用
3. **msgpack 严格解析**：服务器对 msgpack body 严格校验，编码错误返回 `400 Failed to parse msgpack request body: invalid type: ...`（本次修过一版短字符串丢字节的 bug）；脚本内置最小 msgpack 编码器，注意短字符串分支
4. **参考转录文本**：ASR 付费（$0.36/音频小时）且 0 额度不可用 → 自动获取转录不可行；零样本克隆请自行提供正确转录
5. **一致性**：默认 `temperature=0.7`，同文本两次合成时长差 ~12–46%（见 §6）
6. **混合模式不支持（实测）**：单次多说话人调用里「主持人零样本内联 `references` + 嘉宾固定 `reference_id`」混搭不可行——实测 `references` 2D + `reference_id: [null, guest]` → 400（`data did not match any variant of untagged enum ClientSideReferenceId`）；`reference_id: ["", guest]` → 400（`reference_id[0] must be 1..=128 chars of [A-Za-z0-9_-]`）。多说话人只支持两种纯模式：全模型 id（`reference_id` 数组）或全内联音频（`references` 2D）。产品需要混排时走「先建主持人音色模型（§3-b，5–8s，免费）→ `reference_id` 数组」路径（本次 `out-multi.mp3` 即此路径）
7. **多说话人仅限 S2-Pro 系**：`s1` 报 422；`s2.1-pro-free` 实测支持（官方 SKILL.md 写「S2-Pro only」指 S2 架构，free 变体实测可用）

## 10. 复现与产物

```bash
cd scripts/spikes
npm run fish          # 主流程：建主持人音色 + 多说话人 + 零样本 + 逐段（全部零成本，免费模型）
npm run fish:limits   # 字符上限测试（3000/6000/12000，产物 out-limits/，已 gitignore）
```

产物（本次已提交，可试听）：

| 文件 | 内容 | 时长 |
|---|---|---|
| `out-multi.mp3` | 多说话人单次调用（6 段：主持人克隆 + 嘉宾 AD学姐） | 27.6s |
| `out-host-zeroshot.mp3` | 主持人零样本克隆（msgpack 内联，第 1 段文本） | 11.5s |
| `out-host-1/2/3.mp3` | 主持人逐段零样本克隆 | 7.8s / 3.7s / 3.4s |
| `out-guest-1/2/3.mp3` | 嘉宾固定音色逐段 | 5.1s / 4.8s / 3.5s |
| `out-host-1-repeat.mp3` | 主持人第 1 段重复合成（一致性对比） | 6.9s |

复用音色模型：`HOST_MODEL_ID=<id>` 环境变量跳过重新创建；本次主持人模型 `_id=7bff89aa7ab446c0a3e6c4c690eeec71`（private，可在控制台删除）。
