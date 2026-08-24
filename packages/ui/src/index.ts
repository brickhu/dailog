// 共享设计系统（studio 工作台 + site 消费端共用）
// 注意：tokens 不从此 barrel 导出——StyleX 编译器要求变量导入路径以 .stylex 结尾，
// 请用 `import { tokens } from "@dailogues/ui/theme.stylex"`
export {
  Button,
  type ButtonProps,
  type ButtonVariant,
  type ButtonAppear,
  type ButtonSize,
  type ButtonRound,
  type ButtonElevation,
} from "./components/button";
export { ButtonGroup, useButtonGroup, type ButtonGroupProps, type ButtonGroupOrientation } from "./components/button-group";
export { Banner, type BannerProps, type BannerStatus, type BannerContainer, type BannerElevation } from "./components/banner";
export {
  Dialog,
  DialogContext,
  useDialogContext,
  pushEscapeLayer,
  isTopEscapeLayer,
  type DialogProps,
  type DialogVariant,
  type DialogPurpose,
  type DialogPosition,
  type DialogContextValue,
  type SpacingStep,
} from "./components/dialog";
export {
  Carousel,
  type CarouselProps,
  type CarouselHandle,
  type CarouselHandleRef,
  type CarouselGap,
  type CarouselPadding,
} from "./components/carousel";
export { Card } from "./components/card";
export { Center, type CenterProps, type CenterAxis } from "./components/center";
export { Skeleton, type SkeletonProps, type SkeletonRadius } from "./components/skeleton";
export {
  TextInput,
  type TextInputProps,
  type TextInputType,
  type TextInputSize,
  type TextInputStatus,
  type TextInputStatusType,
  type TextInputStatusVariant,
  type TextInputColorVars,
} from "./components/text-input";
export {
  Slider,
  type SliderProps,
  type SliderBaseProps,
  type SliderSingleProps,
  type SliderRangeProps,
  type SliderOrientation,
  type SliderValueDisplay,
  type SliderStatus,
  type SliderStatusType,
  type SliderMark,
} from "./components/slider";
export { Spinner } from "./components/spinner";
export { Tooltip, tooltipStyles, type TooltipProps, type TooltipPlacement } from "./components/tooltip";
export { Avatar, type AvatarProps } from "./components/avatar";
export { Badge, type BadgeProps, type BadgeVariant } from "./components/badge";
export { default as Examples } from "./examples";
export { Icon, type IconProps } from "./components/icon";
export { Logo, type LogoColorVars } from "./components/logo";
export { Drawer, type DrawerProps, type DrawerSide } from "./components/drawer";

export { registerDirective, getDirective } from "./directives";