# Figma 设计令牌导入包(Design Tokens)

由 `packages/ui/src/theme.stylex.ts`(设计 token 唯一源)生成,可直接导入 Figma 的设计令牌 JSON。

- `figma-light.json` — 浅色模式全量令牌(115 个)
- `figma-dark.json` — 暗色模式全量令牌(115 个)
- `figma-free.json` — 免费版单文件(172 个:浅色 + `Dark/` 前缀暗色副本)
- `tokens-styles.json` — 样式文件(128 个:含 `boxShadow` × 3、`typography` × 13,供插件生成 Effect/Text styles)
- `generate.mjs` — 生成脚本,源码 token 变更后重新运行:`node docs/figma/generate.mjs`

格式为 **W3C DTCG(Design Tokens Community Group)** 标准,即 Figma 原生导入接受的格式
(官方文档:"Modes for variables" → Import modes)。

## 导入步骤(官方方式:拖拽)

1. 打开 Figma 设计文件,打开 **Variables** 视图(右侧边栏 → Variables,或顶部工具栏 `⋯` → Variables)。
2. 点击侧边栏的 **More options → Create collection**,新建一个集合(名字随意,如 `Design Tokens`)。
3. **把 JSON 文件拖进 Variables 视图**:
   - **免费计划**:拖入 `figma-free.json`(导入后只有 1 个模式,暗色值在 `Color/Dark/` 分组下);
   - **付费计划**:依次拖入 `figma-light.json` 和 `figma-dark.json`,每个文件会生成一个模式,浅色/暗色值即可切换。
4. 模式名通常取自文件名(如 `figma-light`),可在面板中重命名(如 `Light` / `Dark`)。
5. 之后 token 更新:右键对应模式 → **Import mode** 重新导入覆盖(仅更新名称与类型匹配的变量)。

> 注意:免费计划每个集合只能有 1 个模式,所以暗色值在免费版里做成了 `Color/Dark/...` 分组下的独立变量,
> 使用时手动选取;升级付费后改用 light/dark 双文件导入,获得真正的模式切换。

## 分组与类型映射

| 顶层分组 | 子分组 | 令牌数 | DTCG 类型 | 说明 |
|---|---|---|---|---|
| `Color` | Primary / Secondary / Brand / Neutral / Surface / Popover / Background / Foreground / Danger / Warning / Success / Ink | 57 | `color` | 免费版另含 `Dark/` 暗色副本 |
| `Dimension` | Spacing(13) / Size(7) / Radius(7) / Font Size(13) / Border Width(3) | 43 | `dimension`(px) | rem 已按 16px 基准换算 |
| `Dimension` | Font Weight | 7 | `number` | 100~700 |
| `Font Family` | body / heading / code | 3 | `fontFamily` | 只保留首选字体,fallback 链在描述里 |
| `Duration` | — | 2 | `duration`(s) | 120ms → 0.12s |
| `Shadow` | — | 3 | `string` | CSS 参考值,Figma 无阴影变量类型 |

令牌命名保留源码 token 名(如 `Color/Primary/primary`、`Dimension/Spacing/spacing4`),与代码一一对应;
嵌套层级会在导入时自动转为 `/` 分组。令牌描述($description)为中文。

## 导入样式(Effect / Text styles)

**Figma 原生不支持从 JSON 导入 styles**(只有 variables 支持 DTCG 导入)。阴影和文本样式需要:

1. **插件方式(推荐,免费可用)**:`tokens-styles.json` 已按 DTCG 格式把阴影转成 `boxShadow` 类型、把排版转成 `typography` 类型。
   安装社区插件(如 [DTCG Design Token Manager](https://figma.pluginsage.com/plugins/1602387835479491374) 或 [Tokens Studio](https://tokens.studio/)),粘贴/上传 `tokens-styles.json`,
   插件会自动生成 **Drop Shadow Effect styles**(Shadow 组)和 **Text styles**(Typography 组)。
2. **手动方式**:三个阴影参数如下(Effect → 添加 drop shadow):

   | 样式 | X | Y | Blur | Spread | 颜色 |
   |---|---|---|---|---|---|
   | shadowLow | 0 | 1px | 2px | 0 | #000000 @ 40% |
   | shadowMed | 0 | 4px | 12px | 0 | #000000 @ 40% |
   | shadowHigh | 0 | 8px | 24px | 0 | #000000 @ 55% |

   文本样式按 Typography 组的 13 个样式逐一手动创建(字体族/字号/字重/行高均已换算为 px)。
3. **API 方式(需付费计划)**:REST API 支持创建 styles,需要 Professional 以上计划和访问令牌。

> 提示:颜色不建议重复做成 Paint styles——变量已可直接用于填充/描边,且支持明暗切换;
> 插件生成的文本样式字体栈只保留首选字体(Figtree / SFMono-Regular)。

## 注意事项

1. **`fontSizeMax` 换算存疑**:源码为 `4rem`(注释写 72px),4rem = 64px,已按 64px 生成。请与作者确认是改回 `4.5rem` 还是修正注释。
2. **Easing 未包含**:cubic-bezier 不是 Figma 支持的令牌类型,如需要可在 Figma Motion 中手动创建缓动预设。
3. **Shadow 只是字符串参考**:Figma 没有阴影变量类型,`Shadow` 组仅作参考,实际效果请手动创建 shadowLow/Med/High 三个 Effect style。
4. **免费版多模式限制**:免费计划每集合 1 个模式,双文件导入需付费计划(Starter/Pro 及以上)。
5. **导入失败排查**:若拖入后提示格式无效,确认导入的是 Variables 视图(而非画布或文件导入),且文件未经过修改(保持 UTF-8 无 BOM)。

## 参考文档

- [Modes for variables(含 Import modes 格式说明)](https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables)
- [Guide to variables in Figma](https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma)
- [Overview of variables, collections, and modes](https://help.figma.com/hc/en-us/articles/14506821864087)
- [DTCG Design Tokens 规范](https://www.w3.org/community/design-tokens/)
