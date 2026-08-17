// stylex 跨文件断点常量（唯一源）：
// - 纯 JS 语法（无 TS 类型注解）——stylex babel 插件的 experimental_crossFileParsing
//   用默认 parser 解析导入文件，TS 语法会 parse 失败（theme.stylex.ts 是 TS 源，
//   不能直接作为常量源）；.stylex.const 后缀是 babel 插件识别的常量文件约定
// - theme.stylex.ts 与其他业务文件都从这里导入（真正统一，一处修改全局生效）
export const DARK = "@media (prefers-color-scheme: dark)";
export const DESKTOP = "@media (width >= 1024px)";
export const TABLET = "@media (640px <= width < 1024px)";
