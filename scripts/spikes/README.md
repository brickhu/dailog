# spikes：探索性脚本环境

> 日期：2026-08-02 · 用途：dailogues 技术验证 spike（探索性脚本，不进入产品代码）

## 用途

`scripts/spikes/` 存放 dailogues 的探索性 spike 脚本，用于在接入产品代码之前验证关键不确定点（TTS 集成、平台数据采集可行性等）。每个 spike 的结论记录在 `docs/spikes/*.md`。

## 命令

| 命令 | 脚本 | 说明 |
|---|---|---|
| `npm run fish` | `fish-audio.mjs` | Fish Audio TTS 集成验证（多说话人结构、零样本克隆、计费实测），详见 `docs/spikes/fish-audio.md` |
| `npm run fish:limits` | `fish-audio.mjs --boundary` | 单请求字符上限测试（3000/6000/12000 字符），产物在 `out-limits/` |

> 无头浏览器抓取方案（`headless-cf.mjs`）已废弃：被 CF Turnstile 拦截，见 `docs/spikes/headless-cf.md`，对应 npm script 已移除。

在 `scripts/spikes/` 目录下运行：

```bash
npm run fish
```

## 环境变量

复制 `.env.example` 为 `.env` 并填入真实值：

| 变量 | 说明 |
|---|---|
| `FISH_API_KEY` | Fish Audio API Key（控制台获取） |
| `REFERENCE_FILE` | 主持人克隆参考音频路径，相对 `scripts/spikes/`，指向仓库根目录的 `sample-voice.wav` |
| `GUEST_REFERENCE_ID` | 嘉宾固定音色 reference_id（Fish Audio 控制台获取），可留空 |

## 注意

- **`.env` 存放真实密钥，已被 `.gitignore` 忽略，切勿提交**；密钥只应通过 `.env.example` 模板传递
- 本环境**无任何依赖**（Node >= 20.6：`node --env-file` 自 20.6 起可用，网络仅用内置 `net`/`tls`/`https` 模块），不要运行 `npm install` / `pnpm install`
- 访问被墙平台（如 Claude 分享页）时使用本地 SOCKS 代理 `127.0.0.1:1081`
