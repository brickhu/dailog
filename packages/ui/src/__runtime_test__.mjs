import _inject from "@stylexjs/stylex/lib/stylex-inject";
var _inject2 = _inject;
import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { getNextMarker as _$getNextMarker } from "solid-js/web";
import { setAttribute as _$setAttribute } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
import { getNextElement as _$getNextElement } from "solid-js/web";
import { runHydrationEvents as _$runHydrationEvents } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
import { spread as _$spread } from "solid-js/web";
import { mergeProps as _$mergeProps } from "solid-js/web";
import { $$registry as _$$registry, $$refresh as _$$refresh, $$component as _$$component } from "solid-refresh";
const _REGISTRY = _$$registry();
var _tmpl$ = /*#__PURE__*/_$template(`<span>`),
  _tmpl$2 = /*#__PURE__*/_$template(`<div role=group><div><span></span><!$><!/>`),
  _tmpl$3 = /*#__PURE__*/_$template(`<div><div><!$><!/><button type=button data-sidenav-toggle=true></button></div><!$><!/>`),
  _tmpl$4 = /*#__PURE__*/_$template(`<div><!$><!/><!$><!/>`),
  _tmpl$5 = /*#__PURE__*/_$template(`<span><span></span><!$><!/>`),
  _tmpl$6 = /*#__PURE__*/_$template(`<div role=group><!$><!/><div>`),
  _tmpl$7 = /*#__PURE__*/_$template(`<div>`),
  _tmpl$8 = /*#__PURE__*/_$template(`<nav role=navigation><!$><!/><div></div><!$><!/>`);
import * as stylex from "@stylexjs/stylex";
import { type StyleXStyles } from "@stylexjs/stylex";
import { createEffect, createSignal, createUniqueId, splitProps, type Component, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { colors, dimensions, durations, easings, fontfamilies } from "../theme.stylex";
import { Icon } from "./icon";
import { useI18n } from "@dailogues/i18n";

/**
 * SideNav 家族（复刻 Astryx SideNav/SideNavSection/SideNavItem：
 * https://astryx.atmeta.com/components/SideNav，行为对齐参考实现
 * github.com/facebook/astryx，MIT）
 * - SideNav：纵向导航容器，五个区域——header + topContent（顶部吸顶）、children（可滚动）、
 *   footer + footerIcons（底部吸顶）。本复刻不含桌面侧栏的折叠（collapsible）/拖拽调宽
 *   （resizable）特性（移动端抽屉场景不需要），接口保持精简
 * - SideNavSection：一级分组——带标题（role="group" + aria-labelledby）的导航条目组
 * - SideNavItem：二级条目——链接（href，可经 as 传入路由组件）或按钮，支持图标/选中态/
 *   （aria-current="page"）/禁用态/尾部内容，以及可折叠的嵌套子项（二级纵向菜单：
 *   父条目点击展开/收起子条目，aria-expanded + aria-controls + grid-rows 动画，
 *   尊重 prefers-reduced-motion）。折叠触发器带 data-sidenav-toggle 标记，
 *   消费方"点击关闭 drawer"的监听可用它排除折叠切换（同 data-menu-trigger 约定）
 * - 选中视觉沿用站点品牌绿（brandStrong + 浅绿底），与桌面行内导航高亮一致
 */

// ============ 共享样式 ============

const HOVER_BG = `color-mix(in srgb, ${colors.surfaceStrong} 55%, transparent)`;
const PRESSED_BG = `color-mix(in srgb, ${colors.surfaceStrong} 75%, transparent)`;
const SELECTED_BG = `color-mix(in srgb, ${colors.brand} 14%, transparent)`;
const SELECTED_BG_HOVER = `color-mix(in srgb, ${colors.brand} 22%, transparent)`;
_inject2({
  ltr: ".x78zum5{display:flex}",
  priority: 3000
});
_inject2({
  ltr: ".x6s0dn4{align-items:center}",
  priority: 3000
});
_inject2({
  ltr: ".x1vx7gux{gap:var(--x1w2l9rq)}",
  priority: 2000
});
_inject2({
  ltr: ".xh8yej3{width:100%}",
  priority: 4000
});
_inject2({
  ltr: ".xx1qar5{height:var(--xvhmz7o)}",
  priority: 4000
});
_inject2({
  ltr: ".xszhx5m{padding-inline:var(--x1w2l9rq)}",
  priority: 2000
});
_inject2({
  ltr: ".xt970qd{padding-block:0}",
  priority: 2000
});
_inject2({
  ltr: ".x152hztr{border-radius:var(--xzwqcyf)}",
  priority: 2000
});
_inject2({
  ltr: ".xc342km{border-width:0}",
  priority: 2000
});
_inject2({
  ltr: ".xng3xce{border-style:none}",
  priority: 2000
});
_inject2({
  ltr: ".xjbqb8w{background-color:transparent}",
  priority: 3000
});
_inject2({
  ltr: ".x5tyqbo{color:var(--x10p8w1n)}",
  priority: 3000
});
_inject2({
  ltr: ".x1hl2dhg{text-decoration:none}",
  priority: 2000
});
_inject2({
  ltr: ".x1ypdohk{cursor:pointer}",
  priority: 3000
});
_inject2({
  ltr: ".x4p1qki{font-family:var(--xg9iu6b)}",
  priority: 3000
});
_inject2({
  ltr: ".xuqmp58{font-size:var(--x1jinp65)}",
  priority: 3000
});
_inject2({
  ltr: ".x1rvpd6e{font-weight:var(--x1tiuyv8)}",
  priority: 3000
});
_inject2({
  ltr: ".x1evy7pa{line-height:1.5}",
  priority: 3000
});
_inject2({
  ltr: ".x1yc453h{text-align:start}",
  priority: 3000
});
_inject2({
  ltr: ".x9f619{box-sizing:border-box}",
  priority: 3000
});
_inject2({
  ltr: "@media (hover: hover){.x12rquoj.x12rquoj:hover:not(:disabled):not([aria-disabled]){background-color:color-mix(in srgb,var(--xqhmhgy) 55%,transparent)}}",
  priority: 3240
});
_inject2({
  ltr: ".x1hr9mbk:active{background-color:color-mix(in srgb,var(--xqhmhgy) 75%,transparent)}",
  priority: 3170
});
_inject2({
  ltr: ".x1b7ukwv{background-color:color-mix(in srgb,var(--xuk44qc) 14%,transparent)}",
  priority: 3000
});
_inject2({
  ltr: ".xruzc30{color:var(--x3n5kjv)}",
  priority: 3000
});
_inject2({
  ltr: ".x8dqey{font-weight:var(--xcidq1w)}",
  priority: 3000
});
_inject2({
  ltr: "@media (hover: hover){.x1ai18qa.x1ai18qa:hover:not(:disabled):not([aria-disabled]){background-color:color-mix(in srgb,var(--xuk44qc) 22%,transparent)}}",
  priority: 3240
});
_inject2({
  ltr: ".xxivwq3:active{background-color:color-mix(in srgb,var(--xuk44qc) 22%,transparent)}",
  priority: 3170
});
_inject2({
  ltr: ".x1iodyof{color:var(--x7aqa17)}",
  priority: 3000
});
_inject2({
  ltr: ".x1h6gzvc{cursor:not-allowed}",
  priority: 3000
});
_inject2({
  ltr: ".x47corl{pointer-events:none}",
  priority: 3000
});
_inject2({
  ltr: ".xg8bwab{height:var(--xvhb4ky)}",
  priority: 4000
});
_inject2({
  ltr: ".xjpp0h2{padding-inline:var(--xg80cub)}",
  priority: 2000
});
_inject2({
  ltr: ".x18e07pp{font-size:var(--x1eukyj7)}",
  priority: 3000
});
_inject2({
  ltr: ".x1yvynz2{height:var(--x6ihb2o)}",
  priority: 4000
});
_inject2({
  ltr: ".x1338i4g{font-size:var(--x1dhsxda)}",
  priority: 3000
});
_inject2({
  ltr: ".x98rzlu{flex:1}",
  priority: 2000
});
_inject2({
  ltr: ".xeuugli{min-width:0}",
  priority: 4000
});
_inject2({
  ltr: ".xb3r6kr{overflow:hidden}",
  priority: 2000
});
_inject2({
  ltr: ".xlyipyv{text-overflow:ellipsis}",
  priority: 3000
});
_inject2({
  ltr: ".xuxw1ft{white-space:nowrap}",
  priority: 3000
});
_inject2({
  ltr: ".x2lah0s{flex-shrink:0}",
  priority: 3000
});
_inject2({
  ltr: ".x3nfvp2{display:inline-flex}",
  priority: 3000
});
_inject2({
  ltr: ".xl56j7k{justify-content:center}",
  priority: 3000
});
_inject2({
  ltr: ".x14w6tuz{width:var(--x1nzu9xv)}",
  priority: 4000
});
_inject2({
  ltr: ".x1j85zdz{height:var(--x1nzu9xv)}",
  priority: 4000
});
_inject2({
  ltr: ".x1qlqyl8{font-size:inherit}",
  priority: 3000
});
_inject2({
  ltr: ".x11xpdln{transition-property:transform}",
  priority: 3000
});
_inject2({
  ltr: ".xlnvzhz{transition-duration:var(--xdtthya)}",
  priority: 3000
});
_inject2({
  ltr: ".xw9ctdt{transition-timing-function:var(--x1693rav)}",
  priority: 3000
});
_inject2({
  ltr: "@media (prefers-reduced-motion: reduce){.x12w9bfk.x12w9bfk{transition-duration:0s}}",
  priority: 3200
});
_inject2({
  ltr: ".x19jd1h0{transform:rotate(180deg)}",
  priority: 3000
});
_inject2({
  ltr: ".x1717udv{padding:0}",
  priority: 1000
});
_inject2({
  ltr: ".x1ghz6dp{margin:0}",
  priority: 1000
});
_inject2({
  ltr: ".x1heor9g{color:inherit}",
  priority: 3000
});
_inject2({
  ltr: ".xvs28yh{border-radius:var(--x1fyfsy3)}",
  priority: 2000
});
_inject2({
  ltr: ".x164b3m3:hover{background-color:color-mix(in srgb,var(--xqhmhgy) 55%,transparent)}",
  priority: 3130
});
_inject2({
  ltr: ".xdt5ytf{flex-direction:column}",
  priority: 3000
});
_inject2({
  ltr: ".xkh2ocl{align-self:stretch}",
  priority: 3000
});
_inject2({
  ltr: ".xrvj5dj{display:grid}",
  priority: 3000
});
_inject2({
  ltr: ".x1tu4anv{grid-template-rows:1fr}",
  priority: 3000
});
_inject2({
  ltr: ".x1qn9uv2{transition-property:grid-template-rows}",
  priority: 3000
});
_inject2({
  ltr: ".xdseb81{transition-duration:var(--x1v2h1sx)}",
  priority: 3000
});
_inject2({
  ltr: ".xihq33y{grid-template-rows:0fr}",
  priority: 3000
});
_inject2({
  ltr: ".x2lwn1j{min-height:0}",
  priority: 4000
});
_inject2({
  ltr: ".xo30wce{padding-inline-start:var(--x1nzu9xv)}",
  priority: 3000
});
_inject2({
  ltr: ".x1s85apg{display:none}",
  priority: 3000
});
const navItemStyles = {
  item: {
    "side-nav__navItemStyles.item": "side-nav__navItemStyles.item",
    "display-k1xSpc": "x78zum5",
    "alignItems-kGNEyG": "x6s0dn4",
    "gap-kOIVth": "x1vx7gux",
    "width-kzqmXN": "xh8yej3",
    "height-kZKoxP": "xx1qar5",
    "paddingInline-kg3NbH": "xszhx5m",
    "paddingBlock-k8WAf4": "xt970qd",
    "borderRadius-kaIpWk": "x152hztr",
    "borderWidth-kMzoRj": "xc342km",
    "borderStyle-ksu8eU": "xng3xce",
    "backgroundColor-kWkggS": "xjbqb8w",
    "color-kMwMTN": "x5tyqbo",
    "textDecoration-kybGjl": "x1hl2dhg",
    "cursor-kkrTdU": "x1ypdohk",
    "fontFamily-kMv6JI": "x4p1qki",
    "fontSize-kGuDYH": "xuqmp58",
    "fontWeight-k63SB2": "x1rvpd6e",
    "lineHeight-kLWn49": "x1evy7pa",
    "textAlign-k9WMMc": "x1yc453h",
    "boxSizing-kB7OPa": "x9f619",
    ":hover:not(:disabled):not([aria-disabled])_@media (hover: hover)_backgroundColor-k9j26s": "x12rquoj",
    ":active_backgroundColor-kSReZ0": "x1hr9mbk",
    $$css: "@dailogues/ui:src/components/side-nav.tsx:53"
  },
  selected: {
    "side-nav__navItemStyles.selected": "side-nav__navItemStyles.selected",
    "backgroundColor-kWkggS": "x1b7ukwv",
    "color-kMwMTN": "xruzc30",
    "fontWeight-k63SB2": "x8dqey",
    ":hover:not(:disabled):not([aria-disabled])_@media (hover: hover)_backgroundColor-k9j26s": "x1ai18qa",
    ":active_backgroundColor-kSReZ0": "xxivwq3",
    $$css: "@dailogues/ui:src/components/side-nav.tsx:83"
  },
  disabled: {
    "side-nav__navItemStyles.disabled": "side-nav__navItemStyles.disabled",
    "color-kMwMTN": "x1iodyof",
    "cursor-kkrTdU": "x1h6gzvc",
    "pointerEvents-kfzvcC": "x47corl",
    $$css: "@dailogues/ui:src/components/side-nav.tsx:96"
  },
  sm: {
    "side-nav__navItemStyles.sm": "side-nav__navItemStyles.sm",
    "height-kZKoxP": "xg8bwab",
    "paddingInline-kg3NbH": "xjpp0h2",
    "fontSize-kGuDYH": "x18e07pp",
    $$css: "@dailogues/ui:src/components/side-nav.tsx:101"
  },
  lg: {
    "side-nav__navItemStyles.lg": "side-nav__navItemStyles.lg",
    "height-kZKoxP": "x1yvynz2",
    "paddingInline-kg3NbH": "xszhx5m",
    "fontSize-kGuDYH": "x1338i4g",
    $$css: "@dailogues/ui:src/components/side-nav.tsx:110"
  },
  splitAction: {
    "side-nav__navItemStyles.splitAction": "side-nav__navItemStyles.splitAction",
    "display-k1xSpc": "x78zum5",
    "alignItems-kGNEyG": "x6s0dn4",
    "alignSelf-kSGwAc": "xkh2ocl",
    "gap-kOIVth": "x1vx7gux",
    "flex-kUk6DE": "x98rzlu",
    "minWidth-k7Eaqz": "xeuugli",
    $$css: "@dailogues/ui:src/components/side-nav.tsx:183"
  }
};
_inject2({
  ltr: ".x78zum5{display:flex}",
  priority: 3000
});
_inject2({
  ltr: ".xdt5ytf{flex-direction:column}",
  priority: 3000
});
_inject2({
  ltr: ".x4l3xes{padding-block:var(--xg80cub)}",
  priority: 2000
});
_inject2({
  ltr: ".x6s0dn4{align-items:center}",
  priority: 3000
});
_inject2({
  ltr: ".x1vx7gux{gap:var(--x1w2l9rq)}",
  priority: 2000
});
_inject2({
  ltr: ".xszhx5m{padding-inline:var(--x1w2l9rq)}",
  priority: 2000
});
_inject2({
  ltr: ".xt0e3qv{cursor:default}",
  priority: 3000
});
_inject2({
  ltr: ".x87ps6o{user-select:none}",
  priority: 3000
});
_inject2({
  ltr: ".x98rzlu{flex:1}",
  priority: 2000
});
_inject2({
  ltr: ".xeuugli{min-width:0}",
  priority: 4000
});
_inject2({
  ltr: ".x18e07pp{font-size:var(--x1eukyj7)}",
  priority: 3000
});
_inject2({
  ltr: ".xe621hv{font-weight:var(--xbarj82)}",
  priority: 3000
});
_inject2({
  ltr: ".x1evy7pa{line-height:1.5}",
  priority: 3000
});
_inject2({
  ltr: ".x1iodyof{color:var(--x7aqa17)}",
  priority: 3000
});
_inject2({
  ltr: ".xb3r6kr{overflow:hidden}",
  priority: 2000
});
_inject2({
  ltr: ".xlyipyv{text-overflow:ellipsis}",
  priority: 3000
});
_inject2({
  ltr: ".xuxw1ft{white-space:nowrap}",
  priority: 3000
});
_inject2({
  ltr: ".x2lah0s{flex-shrink:0}",
  priority: 3000
});
_inject2({
  ltr: ".x1ef3i4p{gap:var(--xg80cub)}",
  priority: 2000
});
_inject2({
  ltr: ".x10l6tqk{position:absolute}",
  priority: 3000
});
_inject2({
  ltr: ".x1i1rx1s{width:1px}",
  priority: 4000
});
_inject2({
  ltr: ".xjm9jq1{height:1px}",
  priority: 4000
});
_inject2({
  ltr: ".xeh89do{clip:rect(0 0 0 0)}",
  priority: 3000
});
_inject2({
  ltr: ".x1hyvwdk{clip-path:inset(50%)}",
  priority: 3000
});
const sectionStyles = {
  root: {
    "side-nav__sectionStyles.root": "side-nav__sectionStyles.root",
    "display-k1xSpc": "x78zum5",
    "flexDirection-kXwgrk": "xdt5ytf",
    "paddingBlock-k8WAf4": "x4l3xes",
    $$css: "@dailogues/ui:src/components/side-nav.tsx:214"
  }
};
_inject2({
  ltr: ".x78zum5{display:flex}",
  priority: 3000
});
_inject2({
  ltr: ".xdt5ytf{flex-direction:column}",
  priority: 3000
});
_inject2({
  ltr: ".x5yr21d{height:100%}",
  priority: 4000
});
_inject2({
  ltr: ".x1hfn5x7{width:260px}",
  priority: 4000
});
_inject2({
  ltr: ".x9f619{box-sizing:border-box}",
  priority: 3000
});
_inject2({
  ltr: ".xb3r6kr{overflow:hidden}",
  priority: 2000
});
_inject2({
  ltr: ".x2lah0s{flex-shrink:0}",
  priority: 3000
});
_inject2({
  ltr: ".x7wzq59{position:sticky}",
  priority: 3000
});
_inject2({
  ltr: ".x13vifvy{top:0}",
  priority: 4000
});
_inject2({
  ltr: ".x1vjfegm{z-index:1}",
  priority: 3000
});
_inject2({
  ltr: ".x1vx7gux{gap:var(--x1w2l9rq)}",
  priority: 2000
});
_inject2({
  ltr: ".xbykjne{padding-top:var(--x1w2l9rq)}",
  priority: 4000
});
_inject2({
  ltr: ".x1bk2504{padding-bottom:var(--x1w2l9rq)}",
  priority: 4000
});
_inject2({
  ltr: ".xszhx5m{padding-inline:var(--x1w2l9rq)}",
  priority: 2000
});
_inject2({
  ltr: ".x98rzlu{flex:1}",
  priority: 2000
});
_inject2({
  ltr: ".x2lwn1j{min-height:0}",
  priority: 4000
});
_inject2({
  ltr: ".x1odjw0f{overflow-y:auto}",
  priority: 4000
});
_inject2({
  ltr: ".x6ikm8r{overflow-x:hidden}",
  priority: 4000
});
_inject2({
  ltr: ".xr0cbkh{padding-top:var(--xg80cub)}",
  priority: 4000
});
_inject2({
  ltr: ".x18jzscu{padding-bottom:var(--xg80cub)}",
  priority: 4000
});
_inject2({
  ltr: ".xr1yuqi{margin-top:auto}",
  priority: 4000
});
_inject2({
  ltr: ".x1ey2m1c{bottom:0}",
  priority: 4000
});
_inject2({
  ltr: ".x6s0dn4{align-items:center}",
  priority: 3000
});
_inject2({
  ltr: ".x1ef3i4p{gap:var(--xg80cub)}",
  priority: 2000
});
const navStyles = {
  root: {
    "side-nav__navStyles.root": "side-nav__navStyles.root",
    "display-k1xSpc": "x78zum5",
    "flexDirection-kXwgrk": "xdt5ytf",
    "height-kZKoxP": "x5yr21d",
    "width-kzqmXN": "x1hfn5x7",
    "boxSizing-kB7OPa": "x9f619",
    "overflow-kVQacm": "xb3r6kr",
    $$css: "@dailogues/ui:src/components/side-nav.tsx:272"
  }
};

// ============ Types ============

export interface SideNavProps {
  /** 顶部吸顶区（通常放品牌标题） */
  header?: JSX.Element;
  /** 顶部吸顶区下方的固定内容（如创建按钮） */
  topContent?: JSX.Element;
  /** 导航分区与条目（可滚动） */
  children: JSX.Element;
  /** 底部吸顶区（页脚内容） */
  footer?: JSX.Element;
  /** 底部图标行 */
  footerIcons?: JSX.Element;
  /** 导航地标可访问名称 @default t("mobileNav.navigation") */
  label?: string;
  /** 外部注入的 StyleX 样式（最后合并、冲突时覆盖内部）；抽屉内可用它覆盖宽度为 100% */
  xstyle?: StyleXStyles;
  class?: string;
  className?: string;
  style?: JSX.CSSProperties;
}
export interface SideNavSectionProps {
  /** 一级分组标题 */
  title: string;
  /** 标题副文本 */
  subtitle?: string;
  /** 分组内条目 */
  children: JSX.Element;
  /** 标题行右侧内容 */
  endContent?: JSX.Element;
  /** 标题视觉隐藏（屏幕阅读器仍可读）@default false */
  isHeaderHidden?: boolean;
  /** 外部注入的 StyleX 样式 */
  xstyle?: StyleXStyles;
}
export type SideNavItemSize = "sm" | "md" | "lg";
export interface SideNavItemCollapsibleConfig {
  /** 初始是否收起 @default false */
  defaultIsCollapsed?: boolean;
  /** 受控收起态 */
  isCollapsed?: boolean;
  onCollapsedChange?: (isCollapsed: boolean) => void;
}
export interface SideNavItemProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "children" | "onClick" | "label" | "ref"> {
  /** 条目文本 */
  label: string;
  /** 图标（JSX 元素，如 <Icon/>） */
  icon?: JSX.Element;
  /** 选中态图标（可选，选中时替换 icon） */
  selectedIcon?: JSX.Element;
  /** 当前页指示（aria-current="page"）@default false */
  isSelected?: boolean;
  /** 禁用 @default false */
  isDisabled?: boolean;
  /** 链接地址；提供时渲染为链接（as 提供时用 as），否则为按钮 */
  href?: string;
  /** 自定义链接组件（如 @solidjs/router 的 A，SPA 导航用） */
  as?: Component<any>;
  onClick?: (e: MouseEvent) => void;
  /** 尾部内容（角标/计数） */
  endContent?: JSX.Element;
  /** 嵌套子条目（二级纵向菜单）；默认可折叠 */
  children?: JSX.Element;
  /** 折叠配置：true=可折叠（默认展开）；对象=受控/初始收起；false=禁用折叠 */
  collapsible?: boolean | SideNavItemCollapsibleConfig;
  /** 尺寸 @default "md" */
  size?: SideNavItemSize;
  /** 外部注入的 StyleX 样式 */
  xstyle?: StyleXStyles;
  /** 外部 class（与内部 stylex 类名拼接不覆盖） */
  class?: string;
  /** 外部 class（Solid 别名，与 class 等价） */
  className?: string;
}
const NAV_ITEM_SPLIT_KEYS = ["label", "icon", "selectedIcon", "isSelected", "isDisabled", "href", "as", "onClick", "endContent", "children", "collapsible", "size", "xstyle", "class", "className", "style"] as const;

// ============ SideNavItem ============

/**
 * 纵向导航条目（二级）：链接或按钮，支持图标/选中/禁用/尾部内容/嵌套子项。
 * 子项默认可折叠（collapsible !== false）：无独立主操作时点击整行切换，
 * 有 href/onClick 时点击行触发主操作、点右侧箭头切换（split-action）。
 */
export const SideNavItem = _$$component(_REGISTRY, "SideNavItem", function SideNavItem(props: SideNavItemProps) {
  const {
    t
  } = useI18n();
  const [local, rest] = splitProps(props, NAV_ITEM_SPLIT_KEYS);
  const id = createUniqueId();
  const config = () => typeof local.collapsible === "object" ? local.collapsible : {};
  const hasChildren = () => local.children != null;
  const isItemCollapsible = () => hasChildren() && local.collapsible !== false;
  const [collapsed, setCollapsed] = createSignal(config().isCollapsed ?? config().defaultIsCollapsed ?? false);
  // 受控模式：外部 isCollapsed 变化时同步内部信号
  createEffect(() => {
    const controlled = config().isCollapsed;
    if (controlled !== undefined) setCollapsed(controlled);
  });
  const toggle = () => {
    const next = !collapsed();
    if (config().isCollapsed === undefined) setCollapsed(next);
    config().onCollapsedChange?.(next);
  };
  // stylex.props 条件：取正判断包成调用表达式（0.19 不支持一元 ! / 调用开头的 3 元链）
  const isCollapsedState = () => collapsed() === true;
  const isExpanded = () => collapsed() === false;
  const isSize = (s: SideNavItemSize) => (props.size ?? "md") === s;
  const isSelected = () => props.isSelected === true;
  const isDisabled = () => props.isDisabled === true;
  const hasPrimaryAction = () => local.href != null || local.onClick != null;
  const hasIndependentToggle = () => isItemCollapsible() && hasPrimaryAction();
  // 折叠触发器元素标记：消费方"点击关闭 drawer"的监听用它排除折叠切换
  const toggleMarker = () => isItemCollapsible() ? {
    "data-sidenav-toggle": "true"
  } : {};
  const handleClick = (e: MouseEvent) => {
    if (isDisabled()) {
      e.preventDefault();
      return;
    }
    // 无独立主操作的可折叠条目：整行点击切换展开/收起（不触发 onClick）
    if (isItemCollapsible() && !hasIndependentToggle()) {
      e.preventDefault();
      toggle();
      return;
    }
    local.onClick?.(e);
  };
  const handleToggleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  };
  const displayIcon = () => isSelected() && local.selectedIcon != null ? local.selectedIcon : local.icon;
  // stylex.props 条件不支持一元 ! / 调用开头的 3 元链——正判断包成调用表达式
  const isRowToggle = () => isItemCollapsible() && hasIndependentToggle() === false;
  const chevron = (isExpanded: boolean) => (() => {
    var _el$ = _$getNextElement(_tmpl$);
    _$spread(_el$, _$mergeProps(() => ({
      0: {
        className: "side-nav__navItemStyles.chevron x3nfvp2 x6s0dn4 xl56j7k x14w6tuz x1j85zdz x2lah0s x1qlqyl8 x11xpdln xlnvzhz xw9ctdt x12w9bfk",
        "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:133"
      },
      1: {
        className: "side-nav__navItemStyles.chevron x3nfvp2 x6s0dn4 xl56j7k x14w6tuz x1j85zdz x2lah0s x1qlqyl8 x11xpdln xlnvzhz xw9ctdt x12w9bfk side-nav__navItemStyles.chevronExpanded x19jd1h0",
        "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:133; @dailogues/ui:src/components/side-nav.tsx:148"
      }
    })[!!isExpanded << 0]), false, true);
    _$insert(_el$, _$createComponent(Icon, {
      icon: "iconoir:nav-arrow-down",
      width: 14,
      height: 14
    }));
    _$runHydrationEvents();
    return _el$;
  })();
  const itemContent = () => [_$memo(() => _$memo(() => displayIcon() != null)() && (() => {
    var _el$3 = _$getNextElement(_tmpl$);
    _$spread(_el$3, _$mergeProps(() => ({
      className: "side-nav__navItemStyles.iconSlot x3nfvp2 x6s0dn4 xl56j7k x2lah0s",
      "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:127"
    })), false, true);
    _$insert(_el$3, displayIcon);
    _$runHydrationEvents();
    return _el$3;
  })()), (() => {
    var _el$2 = _$getNextElement(_tmpl$);
    _$spread(_el$2, _$mergeProps(() => ({
      className: "side-nav__navItemStyles.label x98rzlu xeuugli xb3r6kr xlyipyv xuxw1ft",
      "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:115"
    })), false, true);
    _$insert(_el$2, () => local.label);
    _$runHydrationEvents();
    return _el$2;
  })(), _$memo(() => _$memo(() => local.endContent != null)() && (() => {
    var _el$4 = _$getNextElement(_tmpl$);
    _$spread(_el$4, _$mergeProps(() => ({
      className: "side-nav__navItemStyles.endContent x2lah0s x78zum5 x6s0dn4",
      "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:122"
    })), false, true);
    _$insert(_el$4, () => local.endContent);
    _$runHydrationEvents();
    return _el$4;
  })()), _$memo(() => _$memo(() => !!isRowToggle())() && chevron(isExpanded()))];
  const ariaProps = () => ({
    "aria-current": isSelected() ? "page" as const : undefined,
    "aria-disabled": isDisabled() || undefined,
    "aria-expanded": isItemCollapsible() ? isExpanded() : undefined,
    "aria-controls": isItemCollapsible() ? `${id}-children` : undefined
  });

  // 链接 vs 按钮：href 且未禁用 → as ?? <a>；否则 <button>
  const element = () => local.href != null && !isDisabled() ? local.as ?? "a" : "button";
  const elementAttrs = () => ({
    ...(rest as Record<string, unknown>),
    ...(local.href != null && !isDisabled() ? {
      href: local.href
    } : {
      type: "button",
      disabled: isDisabled() || undefined
    }),
    onClick: handleClick,
    ...ariaProps(),
    ...toggleMarker()
  });

  // 外部 class/className 不能走 rest 透传：与内部 stylex 生成的 className 拼接
  const mergeExternalClass = (attrs: Record<string, unknown>) => {
    const external = local.class ?? local.className;
    if (external == null) return attrs;
    const className = attrs.className ? `${attrs.className} ${external}` : external;
    return {
      ...attrs,
      className
    };
  };

  // 条目行样式（普通路径）；split-action 路径额外叠加 splitAction 布局
  const itemRowStyles = () => mergeExternalClass(stylex.props(navItemStyles.item, isSize("sm") && navItemStyles.sm, isSize("lg") && navItemStyles.lg, isSelected() && navItemStyles.selected, isDisabled() && navItemStyles.disabled, local.xstyle));
  const splitRowStyles = () => mergeExternalClass(stylex.props(navItemStyles.splitAction, navItemStyles.item, isSize("sm") && navItemStyles.sm, isSize("lg") && navItemStyles.lg, isSelected() && navItemStyles.selected, isDisabled() && navItemStyles.disabled, local.xstyle));
  const nestedGroup = () => hasChildren() ? (() => {
    var _el$5 = _$getNextElement(_tmpl$2),
      _el$6 = _el$5.firstChild,
      _el$7 = _el$6.firstChild,
      _el$8 = _el$7.nextSibling,
      [_el$9, _co$] = _$getNextMarker(_el$8.nextSibling);
    _$setAttribute(_el$5, "id", `${id}-children`);
    _$setAttribute(_el$5, "aria-labelledby", `${id}-label`);
    _$spread(_el$5, _$mergeProps({
      get ["aria-hidden"]() {
        return isCollapsedState() || undefined;
      }
    }, () => isCollapsedState() ? {
      inert: true
    } : {}, () => ({
      0: {
        className: "side-nav__navItemStyles.children xrvj5dj x1tu4anv x1qn9uv2 xdseb81 xw9ctdt x12w9bfk",
        "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:191"
      },
      1: {
        className: "side-nav__navItemStyles.children xrvj5dj x1qn9uv2 xdseb81 xw9ctdt x12w9bfk side-nav__navItemStyles.childrenCollapsed xihq33y",
        "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:191; @dailogues/ui:src/components/side-nav.tsx:201"
      }
    })[!!isCollapsedState() << 0]), false, true);
    _$spread(_el$6, _$mergeProps(() => ({
      className: "side-nav__navItemStyles.childrenInner xb3r6kr x2lwn1j xo30wce",
      "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:204"
    })), false, true);
    _$setAttribute(_el$7, "id", `${id}-label`);
    _$spread(_el$7, _$mergeProps(() => ({
      className: "side-nav__navItemStyles.childrenLabel x1s85apg",
      "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:209"
    })), false, true);
    _$insert(_el$7, () => local.label);
    _$insert(_el$6, () => local.children, _el$9, _co$);
    _$runHydrationEvents();
    return _el$5;
  })() : null;

  // 有独立主操作的可折叠条目：主操作元素 + 独立折叠按钮（split-action 行）
  if (hasIndependentToggle()) {
    return (() => {
      var _el$0 = _$getNextElement(_tmpl$3),
        _el$1 = _el$0.firstChild,
        _el$11 = _el$1.firstChild,
        [_el$12, _co$2] = _$getNextMarker(_el$11.nextSibling),
        _el$10 = _el$12.nextSibling,
        _el$13 = _el$1.nextSibling,
        [_el$14, _co$3] = _$getNextMarker(_el$13.nextSibling);
      _$spread(_el$0, _$mergeProps(() => ({
        className: "side-nav__navItemStyles.itemRoot x78zum5 xdt5ytf xh8yej3",
        "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:172"
      })), false, true);
      _$spread(_el$1, _$mergeProps(() => ({
        className: "side-nav__navItemStyles.splitRow x78zum5 x6s0dn4 xh8yej3",
        "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:178"
      })), false, true);
      _$insert(_el$1, _$createComponent(Dynamic, _$mergeProps({
        get component() {
          return element();
        }
      }, elementAttrs, splitRowStyles, {
        get children() {
          return itemContent();
        }
      })), _el$12, _co$2);
      _el$10.$$click = handleToggleClick;
      _$setAttribute(_el$10, "aria-controls", `${id}-children`);
      _$spread(_el$10, _$mergeProps({
        get ["aria-label"]() {
          return _$memo(() => !!isExpanded())() ? t("sideNavItem.collapse", {
            label: local.label
          }) : t("sideNavItem.expand", {
            label: local.label
          });
        },
        get ["aria-expanded"]() {
          return isExpanded();
        }
      }, () => ({
        className: "side-nav__navItemStyles.expandToggle x3nfvp2 x6s0dn4 xl56j7k x2lah0s x1717udv x1ghz6dp xc342km xng3xce xjbqb8w x1heor9g x1ypdohk xvs28yh x164b3m3 x1hr9mbk",
        "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:151"
      })), false, true);
      _$insert(_el$10, () => chevron(isExpanded()));
      _$insert(_el$0, nestedGroup, _el$14, _co$3);
      _$runHydrationEvents();
      return _el$0;
    })();
  }
  return (() => {
    var _el$15 = _$getNextElement(_tmpl$4),
      _el$16 = _el$15.firstChild,
      [_el$17, _co$4] = _$getNextMarker(_el$16.nextSibling),
      _el$18 = _el$17.nextSibling,
      [_el$19, _co$5] = _$getNextMarker(_el$18.nextSibling);
    _$spread(_el$15, _$mergeProps(() => ({
      className: "side-nav__navItemStyles.itemRoot x78zum5 xdt5ytf xh8yej3",
      "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:172"
    })), false, true);
    _$insert(_el$15, _$createComponent(Dynamic, _$mergeProps({
      get component() {
        return element();
      }
    }, elementAttrs, itemRowStyles, {
      get children() {
        return itemContent();
      }
    })), _el$17, _co$4);
    _$insert(_el$15, nestedGroup, _el$19, _co$5);
    _$runHydrationEvents();
    return _el$15;
  })();
}, {
  location: "packages/ui/src/components/side-nav.tsx:354:7"
});

// ============ SideNavSection ============

/**
 * 一级分组：带标题（role="group" + aria-labelledby）的导航条目组。
 */
export const SideNavSection = _$$component(_REGISTRY, "SideNavSection", function SideNavSection(props: SideNavSectionProps) {
  const titleId = createUniqueId();
  const headerContent = () => [(() => {
    var _el$20 = _$getNextElement(_tmpl$5),
      _el$21 = _el$20.firstChild,
      _el$22 = _el$21.nextSibling,
      [_el$23, _co$6] = _$getNextMarker(_el$22.nextSibling);
    _$spread(_el$20, _$mergeProps(() => ({
      className: "side-nav__sectionStyles.titleContainer x78zum5 xdt5ytf x98rzlu xeuugli",
      "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:228"
    })), false, true);
    _$setAttribute(_el$21, "id", titleId);
    _$spread(_el$21, _$mergeProps(() => ({
      className: "side-nav__sectionStyles.title x18e07pp xe621hv x1evy7pa x1iodyof xb3r6kr xlyipyv xuxw1ft",
      "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:234"
    })), false, true);
    _$insert(_el$21, () => props.title);
    _$insert(_el$20, (() => {
      var _c$ = _$memo(() => props.subtitle != null);
      return () => _c$() && (() => {
        var _el$24 = _$getNextElement(_tmpl$);
        _$spread(_el$24, _$mergeProps(() => ({
          className: "side-nav__sectionStyles.subtitle x18e07pp x1evy7pa x1iodyof xb3r6kr xlyipyv xuxw1ft",
          "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:243"
        })), false, true);
        _$insert(_el$24, () => props.subtitle);
        _$runHydrationEvents();
        return _el$24;
      })();
    })(), _el$23, _co$6);
    _$runHydrationEvents();
    return _el$20;
  })(), _$memo(() => _$memo(() => props.endContent != null)() && (() => {
    var _el$25 = _$getNextElement(_tmpl$);
    _$spread(_el$25, _$mergeProps(() => ({
      className: "side-nav__sectionStyles.endContent x2lah0s x78zum5 x6s0dn4",
      "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:251"
    })), false, true);
    _$insert(_el$25, () => props.endContent);
    _$runHydrationEvents();
    return _el$25;
  })())];
  return (() => {
    var _el$26 = _$getNextElement(_tmpl$6),
      _el$28 = _el$26.firstChild,
      [_el$29, _co$7] = _$getNextMarker(_el$28.nextSibling),
      _el$27 = _el$29.nextSibling;
    _$setAttribute(_el$26, "aria-labelledby", titleId);
    _$spread(_el$26, _$mergeProps(() => stylex.props(sectionStyles.root, props.xstyle)), false, true);
    _$insert(_el$26, (() => {
      var _c$2 = _$memo(() => !!props.isHeaderHidden);
      return () => _c$2() ? (() => {
        var _el$30 = _$getNextElement(_tmpl$);
        _$spread(_el$30, _$mergeProps(() => ({
          className: "side-nav__sectionStyles.visuallyHidden x10l6tqk x1i1rx1s xjm9jq1 xb3r6kr xeh89do x1hyvwdk xuxw1ft",
          "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:261"
        })), false, true);
        _$insert(_el$30, headerContent);
        _$runHydrationEvents();
        return _el$30;
      })() : (() => {
        var _el$31 = _$getNextElement(_tmpl$7);
        _$spread(_el$31, _$mergeProps(() => ({
          className: "side-nav__sectionStyles.header x78zum5 x6s0dn4 x1vx7gux xszhx5m x4l3xes xt0e3qv x87ps6o",
          "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:219"
        })), false, true);
        _$insert(_el$31, headerContent);
        _$runHydrationEvents();
        return _el$31;
      })();
    })(), _el$29, _co$7);
    _$spread(_el$27, _$mergeProps(() => ({
      className: "side-nav__sectionStyles.items x78zum5 xdt5ytf x1ef3i4p",
      "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:256"
    })), false, true);
    _$insert(_el$27, () => props.children);
    _$runHydrationEvents();
    return _el$26;
  })();
}, {
  location: "packages/ui/src/components/side-nav.tsx:546:7"
});

// ============ SideNav ============

/**
 * 纵向导航容器：顶部吸顶（header + topContent）、中间可滚动（children）、
 * 底部吸顶（footer + footerIcons）。
 */
export const SideNav = _$$component(_REGISTRY, "SideNav", function SideNav(props: SideNavProps) {
  const {
    t
  } = useI18n();
  const hasTop = () => props.header != null || props.topContent != null;
  const hasBottom = () => props.footer != null || props.footerIcons != null;
  return (() => {
    var _el$32 = _$getNextElement(_tmpl$8),
      _el$34 = _el$32.firstChild,
      [_el$35, _co$8] = _$getNextMarker(_el$34.nextSibling),
      _el$33 = _el$35.nextSibling,
      _el$36 = _el$33.nextSibling,
      [_el$37, _co$9] = _$getNextMarker(_el$36.nextSibling);
    _$spread(_el$32, _$mergeProps({
      get ["aria-label"]() {
        return props.label ?? t("mobileNav.navigation");
      }
    }, () => stylex.props(navStyles.root, props.xstyle)), false, true);
    _$insert(_el$32, (() => {
      var _c$3 = _$memo(() => !!hasTop());
      return () => _c$3() && (() => {
        var _el$38 = _$getNextElement(_tmpl$4),
          _el$39 = _el$38.firstChild,
          [_el$40, _co$0] = _$getNextMarker(_el$39.nextSibling),
          _el$41 = _el$40.nextSibling,
          [_el$42, _co$1] = _$getNextMarker(_el$41.nextSibling);
        _$spread(_el$38, _$mergeProps(() => ({
          className: "side-nav__navStyles.stickyTop x78zum5 xdt5ytf x2lah0s x7wzq59 x13vifvy x1vjfegm x1vx7gux xbykjne x1bk2504 xszhx5m",
          "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:280"
        })), false, true);
        _$insert(_el$38, () => props.header, _el$40, _co$0);
        _$insert(_el$38, (() => {
          var _c$5 = _$memo(() => props.topContent != null);
          return () => _c$5() && (() => {
            var _el$43 = _$getNextElement(_tmpl$7);
            _$spread(_el$43, _$mergeProps(() => ({
              className: "side-nav__navStyles.topContent",
              "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:292"
            })), false, true);
            _$insert(_el$43, () => props.topContent);
            _$runHydrationEvents();
            return _el$43;
          })();
        })(), _el$42, _co$1);
        _$runHydrationEvents();
        return _el$38;
      })();
    })(), _el$35, _co$8);
    _$spread(_el$33, _$mergeProps(() => ({
      0: {
        className: "side-nav__navStyles.scrollable x98rzlu x2lwn1j x1odjw0f x6ikm8r xszhx5m xbykjne x1bk2504",
        "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:293"
      },
      2: {
        className: "side-nav__navStyles.scrollable x98rzlu x2lwn1j x1odjw0f x6ikm8r xszhx5m x1bk2504 side-nav__navStyles.scrollableWithTop xr0cbkh",
        "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:293; @dailogues/ui:src/components/side-nav.tsx:302"
      },
      1: {
        className: "side-nav__navStyles.scrollable x98rzlu x2lwn1j x1odjw0f x6ikm8r xszhx5m xbykjne side-nav__navStyles.scrollableWithBottom x18jzscu",
        "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:293; @dailogues/ui:src/components/side-nav.tsx:305"
      },
      3: {
        className: "side-nav__navStyles.scrollable x98rzlu x2lwn1j x1odjw0f x6ikm8r xszhx5m side-nav__navStyles.scrollableWithTop xr0cbkh side-nav__navStyles.scrollableWithBottom x18jzscu",
        "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:293; @dailogues/ui:src/components/side-nav.tsx:302; @dailogues/ui:src/components/side-nav.tsx:305"
      }
    })[!!hasTop() << 1 | !!hasBottom() << 0]), false, true);
    _$insert(_el$33, () => props.children);
    _$insert(_el$32, (() => {
      var _c$4 = _$memo(() => !!hasBottom());
      return () => _c$4() && (() => {
        var _el$44 = _$getNextElement(_tmpl$4),
          _el$45 = _el$44.firstChild,
          [_el$46, _co$10] = _$getNextMarker(_el$45.nextSibling),
          _el$47 = _el$46.nextSibling,
          [_el$48, _co$11] = _$getNextMarker(_el$47.nextSibling);
        _$spread(_el$44, _$mergeProps(() => ({
          className: "side-nav__navStyles.stickyBottom x78zum5 xdt5ytf x2lah0s xr1yuqi x7wzq59 x1ey2m1c x1vx7gux xszhx5m xr0cbkh x1bk2504",
          "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:308"
        })), false, true);
        _$insert(_el$44, () => props.footer, _el$46, _co$10);
        _$insert(_el$44, (() => {
          var _c$6 = _$memo(() => props.footerIcons != null);
          return () => _c$6() && (() => {
            var _el$49 = _$getNextElement(_tmpl$7);
            _$spread(_el$49, _$mergeProps(() => ({
              className: "side-nav__navStyles.footerRow x78zum5 x6s0dn4 x1ef3i4p",
              "data-style-src": "@dailogues/ui:src/components/side-nav.tsx:320"
            })), false, true);
            _$insert(_el$49, () => props.footerIcons);
            _$runHydrationEvents();
            return _el$49;
          })();
        })(), _el$48, _co$11);
        _$runHydrationEvents();
        return _el$44;
      })();
    })(), _el$37, _co$9);
    _$runHydrationEvents();
    return _el$32;
  })();
}, {
  location: "packages/ui/src/components/side-nav.tsx:579:7"
});
SideNav.displayName = "SideNav";
SideNavSection.displayName = "SideNavSection";
SideNavItem.displayName = "SideNavItem";
if (import.meta.hot) {
  _$$refresh("vite", import.meta.hot, _REGISTRY);
  import.meta.hot.accept();
}
_$delegateEvents(["click"]);