import * as stylex from "@stylexjs/stylex";

// 设计 token（StyleX defineVars）唯一源：studio（工作台）与 site（消费端）共享。
// 注意：defineVars 文件必须保持 .stylex.ts 后缀（StyleX 编译器约定）。

// 断点常量（本文件为唯一源）：本地定义——stylex 0.19 babel 插件不支持跨文件常量
// 解析（commonJS 解析不了 ESM import；crossFileParsing 在 TS 源码 monorepo 下多处
// 失败），defineVars 的 key 也要求编译期静态值；业务文件的 stylex.create 需本地写
// 同值字面量（改断点同步本文件 + grid.tsx 等），运行时 key 用下方导出的 constants
const DARK = "@media (prefers-color-scheme: dark)";
const DESKTOP = "@media (min-width: 1025px)";
const TABLET = "@media (min-width: 640px) and (max-width: 1024px)";
const TABLETANDDESKTOP = "@media (min-width: 640px)"


// 颜色
export const colors = stylex.defineVars({
  // 主色调
  primary: {default: "#2b2717", [DARK]: "#acab9c"},
  onPrimary: {default: "#eeeacb", [DARK]: "#2b2717"},
  primaryWeak: {default: "#403d32", [DARK]: "#79776c"},
  onPrimaryWeak: {default: "#eeeacb", [DARK]: "#2b2717"},
  primaryStrong: {default: "#0a0903", [DARK]: "#d4d2c4"},
  onPrimaryStrong: {default: "#eeeacb", [DARK]: "#2b2717"},
  // 次色调
  secondary: {default: "#1a2944", [DARK]: "#9baac7"},
  onSecondary: {default: "#9baac7", [DARK]: "#1a2944"},
  secondaryWeak: {default: "#3e5a88", [DARK]: "#c2d3eb"},
  onSecondaryWeak: {default: "#ffffff", [DARK]: "#1a2944"},
  secondaryStrong: {default: "#101a33", [DARK]: "#7289b0"},
  onSecondaryStrong: {default: "#ffffff", [DARK]: "#1a2944"},
  // 品牌专属色
  brand: {default: "#22cd6f", [DARK]: "#22cd6f"},
  onBrand: {default: "#211e0c", [DARK]: "#211e0c"},
  brandWeak: {default: "#44d786", [DARK]: "#1caa5c"},
  onBrandWeak: {default: "#211e0c", [DARK]: "#211e0c"},
  brandStrong: {default: "#1caa5c", [DARK]: "#44d786"},
  onBrandStrong: {default: "#211e0c", [DARK]: "#211e0c"},

  // 自然色
  neutral: {default: "#3a3b3e", [DARK]: "#9da0a4"},
  onNeutral: {default: "#ffffff", [DARK]: "#2b2b2d"},
  neutralWeak: {default: "#6b6c70", [DARK]: "#c9cbce"},
  onNeutralWeak: {default: "#ffffff", [DARK]: "#161b22"},
  neutralStrong: {default: "#1f2023", [DARK]: "#bbbbbb"},
  onNeutralStrong: {default: "#ffffff", [DARK]: "#161b22"},
  
  // 表面区域色
  surface: {default: "#e4e8e5", [DARK]: "#3b3e3c"},
  onSurface: {default: "#161b22", [DARK]: "#d9e4dd"},
  surfaceWeak: {default: "#e9eaea", [DARK]: "#1d1e1d"},
  onSurfaceWeak: {default: "#161b22", [DARK]: "#d9e4dd"},
  surfaceStrong: {default: "#c2c6c8", [DARK]: "#555956"},
  onSurfaceStrong: {default: "#161b22", [DARK]: "#d9e4dd"},
  
  // 突显区域色
  popover: {default: "#e6e9e9", [DARK]: "#3e4645"},
  onPopover: {default: "#383c3b", [DARK]: "#b4c9c6"},
  popoverWeak: {default: "#f0f2f2", [DARK]: "#232827"},
  onPopoverWeak: {default: "#3e4645", [DARK]: "#b4c9c6"},
  popoverStrong: {default: "#a7aaa9", [DARK]: "#606b6a"},
  onPopoverStrong: {default: "#3e4645", [DARK]: "#b4c9c6"},
  // 背景色
  background: {default: "#f9f9f9", [DARK]: "#0e1116"},
  // 前景色
  foreground: {default: "#222727", [DARK]: "#b8bdc5"},
  // 危险色
  danger: {default: "#f0506e", [DARK]: "#f0506e"},
  onDanger: {default: "#ffdee6", [DARK]: "#ffdee6"},
  dangerWeak: {default: "#ffdee6", [DARK]: "#843a4d"},
  onDangerWeak: {default: "#843a4d", [DARK]: "#ecc2cd"},
  dangerStrong: {default: "#843a4d", [DARK]: "#c53a55"},
  onDangerStrong: {default: "#ffdee6", [DARK]: "#ffffff"},
  // 警告色
  warning: {default: "#e0a23c", [DARK]: "#e0a23c"},
  onWarning: {default: "#ffffff", [DARK]: "#ffffff"},
  warningWeak: {default: "#f1c273", [DARK]: "#9d793b"},
  onWarningWeak: {default: "#211e0c", [DARK]: "#ede3a9"},
  warningStrong: {default: "#b2802d", [DARK]: "#b2802d"},
  onWarningStrong: {default: "#ffffff", [DARK]: "#ffffff"},
  // 成功色
  success: {default: "#3fb68b", [DARK]: "#3fb68b"},
  onSuccess: {default: "#ffffff", [DARK]: "#ffffff"},
  successWeak: {default: "#70c19d", [DARK]: "#70c19d"},
  onSuccessWeak: {default: "#161b22", [DARK]: "#161b22"},
  successStrong: {default: "#2e8b6e", [DARK]: "#2e8b6e"},
  onSuccessStrong: {default: "#ffffff", [DARK]: "#ffffff"},

  // 水墨色,主要用于阴影，分割线，边框等
  ink: {default: "#000000", [DARK]: "#ffffff"},

})

// 尺寸
export const dimensions = stylex.defineVars({
  // 间距
  spacing0: "0px",
  spacing1: "4px",
  spacing2: "8px",
  spacing3: "12px",
  spacing4: "16px",
  spacing5: "20px",
  spacing6: "24px",
  spacing7: "28px",
  spacing8: "32px",
  spacing9: "36px",
  spacing10: "40px",
  spacing11: "44px",
  spacing12: "48px",
  // 区块
  size0: "0px",
  sizeXs: "16px",
  sizeSm: "24px",
  sizeMd: "32px",
  sizeLg: "40px",
  sizeXl: "48px",
  size2xl: "56px",
  // 圆角
  radius0: "0px",
  radiusSm: "4px",
  radiusMd: "8px",
  radiusLg: "12px",
  radiusXl: "16px",
  radius2xl: "24px",
  radiusFull: "9999px",
  // 字号
  fontSize4xs: "0.375rem", // 6px
  fontSize3xs: "0.5rem", // 8px
  fontSize2xs: "0.625rem", // 10px
  fontSizeXs: "0.75rem", // 12px
  fontSizeSm: "0.875rem", // 14px
  fontSizeMd: "1rem", // default 16px
  fontSizeLg: "1.125rem", // 18px
  fontSizeXl: "1.25rem", // 20px
  fontSize2xl: "1.5rem", // 24px
  fontSize3xl: "1.875rem", // 30px
  fontSize4xl: "2.25rem", // 36px
  fontSize5xl: "3rem", // 48px
  fontSizeMax: "4rem", // 72px
  // 字重
  fontWeightThin: "100",
  fontWeightExtraLight: "200",
  fontWeightLight: "300",
  fontWeightNormal: "400",
  fontWeightMedium: "500",
  fontWeightSemiBold: "600",
  fontWeightBold: "700",

  // 间隔线
  borderWidthThin: "1px",
  borderWidthThick: "2px",
  borderWidthExtraThick: "4px",

  //最大页面尺寸
  desktop: "1128px",
  tablet: "820px",
  mobile : "360px"
})

// 过渡
export const durations = stylex.defineVars({
  durationFast: "120ms",
  durationMediumMin: "150ms",
});

// 字体
export const fontfamilies = stylex.defineVars({
  body: "Figtree, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji' ",
  heading: "Figtree, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
  code: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
});

// 阴影
export const shadows = stylex.defineVars({
  shadowLow: "0 2px 4px rgba(25, 30, 40, 0.04),0 10px 20px rgba(25, 30, 40, 0.08),0 20px 40px rgba(25, 30, 40, 0.06)",
  shadowMed: "0 4px 12px rgba(0, 0, 0, 0.4)",
  shadowHigh: "0 8px 24px rgba(0, 0, 0, 0.55)",
});

// 动效曲线
export const easings = stylex.defineVars({
  easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
  easeIn: "cubic-bezier(0.4, 0, 1, 1)",
  easeOut: "cubic-bezier(0, 0, 0.2, 1)",
});

// 通用排版样式
export const typography = stylex.create({
  headingXl: {
    fontFamily: fontfamilies.heading,
    fontSize: dimensions.fontSize5xl,
     [DESKTOP]: {
      fontSize: dimensions.fontSize5xl,
    },
    fontWeight: dimensions.fontWeightBold,
    lineHeight: "1.2",
  },
  headingLg: {
    fontFamily: fontfamilies.heading,
    fontSize: dimensions.fontSize4xl,
     [DESKTOP]: {
      fontSize: dimensions.fontSize5xl,
    },
    fontWeight: dimensions.fontWeightBold,
    lineHeight: "1.2",
  },
  headingMd: {
    fontFamily: fontfamilies.heading,
    fontSize: dimensions.fontSize3xl,
     [DESKTOP]: {
      fontSize: dimensions.fontSize4xl,
    },
    fontWeight: dimensions.fontWeightBold,
    lineHeight: "1.2",
  },
  headingSm: {
    fontFamily: fontfamilies.heading,
    fontSize: dimensions.fontSize2xl,
     [DESKTOP]: {
      fontSize: dimensions.fontSize3xl,
    },
    fontWeight: dimensions.fontWeightBold,
    lineHeight: "1.2",
  },
  headingXs: {
    fontFamily: fontfamilies.heading,
    fontSize: dimensions.fontSizeXl,
     [DESKTOP]: {
      fontSize: dimensions.fontSize2xl,
    },
    fontWeight: dimensions.fontWeightBold,
    lineHeight: "1.2",
  },
  bodyXl: {
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSizeXl,
     [DESKTOP]: {
      fontSize: dimensions.fontSize2xl,
    },
    fontWeight: dimensions.fontWeightNormal,
    lineHeight: "1.5",
  },
  bodyLg: {
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSizeMd,
     [DESKTOP]: {
      fontSize: dimensions.fontSizeLg,
    },
    fontWeight: dimensions.fontWeightNormal,
    lineHeight: "1.5",
  },
  bodyMd: {
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSizeSm,
     [DESKTOP]: {
      fontSize: dimensions.fontSizeMd,
    },
    fontWeight: dimensions.fontWeightNormal,
    lineHeight: "1.5",
  },
  label:{
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSizeSm,
     [DESKTOP]: {
      fontSize: dimensions.fontSizeMd,
    },
    fontWeight: dimensions.fontWeightMedium,
    lineHeight: "1.5",
  },
  caption: {
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSizeXs,
    fontWeight: dimensions.fontWeightNormal,
    lineHeight: "1.5",
    [DESKTOP]: {
      fontSize: dimensions.fontSizeSm,
    },
  },
  code: {
    fontFamily: fontfamilies.code,
    fontSize: dimensions.fontSizeSm,
    fontWeight: dimensions.fontWeightNormal,
    lineHeight: "1.5",
    [DESKTOP]: {
      fontSize: dimensions.fontSizeMd,
    },
  },
  displayLg: {
    fontFamily: fontfamilies.heading,
    fontSize: dimensions.fontSizeLg,
    fontWeight: dimensions.fontWeightBold,
    lineHeight: "1.2",
    [DESKTOP]: {
      fontSize: dimensions.fontSizeMax,
    },
  },
  displayMd: {
    fontFamily: fontfamilies.heading,
    fontWeight: dimensions.fontWeightBold,
    lineHeight: "1.2",
    // 移动优先：base（<640 手机）与 TABLET（640-1023 平板）同为 4xl，桌面 5xl
    fontSize: dimensions.fontSize4xl,
    [DESKTOP]: {
      fontSize: dimensions.fontSize5xl,
    },
  },
  displaySm: {
    fontFamily: fontfamilies.heading,
    fontSize: dimensions.fontSize3xl,
    fontWeight: dimensions.fontWeightBold,
    lineHeight: "1.2",
    [DESKTOP]: {
      fontSize: dimensions.fontSize4xl,
    },
  },
})

// 通用布局样式
// 注意：StyleX 不支持在 stylex.create 内 spread 另一个 create 的结果（编译报错
// "A style value can only contain an array, string or number"）——typography.bodyMd
// 的值（14px/400/1.5/body 字体）在此显式展开
export const layouts = stylex.create({
  // —— 应用壳根（AppShell 框架层 + 全站页面根合并）——
  // 全局顶层容器：fixed 100vw×100vh，自身为纵向滚动容器（内容超高整体滚动）。
  // flex 纵列（默认 align stretch → header/footer 自动全宽）；子项默认横向居中
  // （container* 自带 margin: 0 auto），纵向从顶开始。承担页面根样式
  // （字体/前景/背景/最小宽度/防横向溢出）。
  // 直接子结构：header（site-nav，sticky 吸顶）、container（每页一个）、footer、
  // 以及 fixed 定位的全局组件（如播放条）。
  shellRoot: {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100vw",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    overscrollBehavior: "contain", // 滚动链限制在壳内

    color: colors.foreground,
    backgroundColor: colors.background,
    minWidth: "320px",
    overflowX: "hidden",
    fontFamily: fontfamilies.body,
    fontWeight : dimensions.fontWeightNormal,
    fontSize: dimensions.fontSizeSm,
     [DESKTOP]: {
      fontSize: dimensions.fontSizeMd,
    },
    lineHeight: "1.5",

  },

  // —— 页面层（100vw）——
  // 路由页面的顶层包装：位于 shellRoot 内 header 与 footer 之间，页面内容
  // （container*）居中于其中。不承担字体/背景（shellRoot 已继承）。
  page: {
    width: "100vw",
    flexShrink: "0", // shellRoot 纵向 flex 容器：内容超高时不被压缩
    display: "flex",
    flexDirection: "column",
    alignItems: "center", // 子项（container*）横向居中；container 自带 margin auto 双保险
  },

  // —— 内容容器（grid 布局）——
  // 全部采用 CSS Grid（桌面 12 / 平板 8 / 手机 4 等）。
  // 直接子项默认占 1 列 —— 常规全宽内容块须配合 fullRow（gridColumn: "1 / -1"，
  // 跨满全部显式列；**不要用 span 12**——列数小于 12 时 span 会撑出隐式轨道，
  // subgrid 继承时把隐式轨道也算进去导致错位）；需要多列排布的内容块自行声明列跨度
  // （如 gridColumn: "span 4"，跨度不得超过列数）。

  // 全宽行：内容块的默认跨度（跨满全部可见列，不撑隐式轨道）
  fullRow: {
    gridColumn: "1 / -1",
  },

  // 全屏容器：宽高 100%，单列结构（适合全屏应用/无宽度约束区块）
  containerFull: {
    width: "100%",
  },

  // 大容器：max-width 1128px，居中；网格列数 <640 为 4 列 / 640-1023 为 8 列 / ≥1024 为 12 列
  // （互斥 range 断点，顺序无关）。
  // 轨道用 minmax(0, 1fr)：1fr 默认有 min-content 下限，内容（hero/长标题）会把轨道撑成
  // 非均分（subgrid 继承后卡片不等宽）；minmax(0) 保证轨道严格均分
  containerLg: {
    width: "100%",
    flexShrink: "0",
    maxWidth: "1128px",
    margin: "0 auto",
    display: "grid",
    paddingLeft: dimensions.spacing4,
    paddingRight: dimensions.spacing4,
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    columnGap: dimensions.spacing4,
    // 纵向间距：直接子项（多个 fullRow 块）之间的行距；subgrid 子项不继承 rowGap
    //（subgrid 只继承列轨道，行 gap 需各自显式），所以不影响卡片网格内部行距
    rowGap: dimensions.spacing8,
    alignItems: "start",
    [TABLET]: {
      gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
    },
    [DESKTOP]: {
      gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
    },
  },

  // 中容器：max-width 960px，移动优先：默认 3 列（<640）→ 平板 6 → 桌面 12，居中
  containerMd: {
    width: "100%",
    flexShrink: "0",
    maxWidth: "960px",
    margin: "0 auto",
    paddingLeft: dimensions.spacing4,
    paddingRight: dimensions.spacing4,
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    columnGap: dimensions.spacing4,
    alignItems: "start",
    [TABLET]: {
      gridTemplateColumns: "repeat(6, 1fr)",
      columnGap: dimensions.spacing5,
    },
    [DESKTOP]: {
      gridTemplateColumns: "repeat(12, 1fr)",
      columnGap: dimensions.spacing5,
    },
  },

  // 小容器：max-width 720px，移动优先：默认 3 列（<640）→ 平板/桌面 6 列，居中
  containerSm: {
    width: "100%",
    flexShrink: "0",
    maxWidth: "720px",
    margin: "0 auto",
    paddingLeft: dimensions.spacing4,
    paddingRight: dimensions.spacing4,
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    columnGap: dimensions.spacing4,
    alignItems: "start",
    [TABLET]: {
      gridTemplateColumns: "repeat(6, 1fr)",
      columnGap: dimensions.spacing5,
    },
    [DESKTOP]: {
      gridTemplateColumns: "repeat(6, 1fr)",
      columnGap: dimensions.spacing5,
    },
  },
})

export const global = stylex.create({
  linkText : {
    color : colors.neutral,
    textUnderlineOffset : "0.2em",
    ":hover" : {
      color: colors.neutralStrong
    }
  }
})

// 断点标签命名导出（全站统一引用；<640 无需声明——默认样式即移动端，移动优先）
export { DARK, DESKTOP, TABLET,TABLETANDDESKTOP };

export const constants = {
  DARK,
  DESKTOP,
  TABLET,
  TABLETANDDESKTOP
} as const;

