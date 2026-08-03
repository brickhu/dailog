import * as stylex from "@stylexjs/stylex";

// 设计 token（StyleX defineVars）唯一源：studio（工作台）与 site（消费端）共享。
// 注意：defineVars 文件必须保持 .stylex.ts 后缀（StyleX 编译器约定）。
export const tokens = stylex.defineVars({
  // 品牌
  colorBg: "#0e1116",
  colorSurface: "#161b22",
  colorSurfaceHover: "#1c2330",
  colorBorder: "#2a3242",
  colorText: "#e6e9ef",
  colorTextMuted: "#8b95a7",
  colorPrimary: "#5b8cff",
  colorPrimaryHover: "#6f9aff",
  colorDanger: "#f0506e",
  colorSuccess: "#3fb68b",
  colorWarning: "#e0a23c",
  // 空间
  space1: "4px",
  space2: "8px",
  space3: "12px",
  space4: "16px",
  space5: "24px",
  space6: "32px",
  space7: "48px",
  // 圆角
  radiusSm: "6px",
  radiusMd: "10px",
  radiusLg: "16px",
  radiusFull: "999px",
  // 字体
  fontSizeSm: "13px",
  fontSizeMd: "15px",
  fontSizeLg: "18px",
  fontSizeXl: "24px",
  fontWeightNormal: "400",
  fontWeightMedium: "500",
  fontWeightBold: "700",
});
