import * as stylex from "@stylexjs/stylex";
import { Show } from "solid-js";
import { hashAvatar } from "../lib/hash-avatar";

/**
 * 圆形头像：有 image（better-auth user.image）显示图片；
 * 无头像用 hash-avatar 库（seed 哈希生成确定性渐变 SVG，data URI 内嵌）。
 * 纯展示组件（无状态、无交互），导航/评论区通用。
 */

export interface AvatarProps {
  /** 头像 URL；缺省用 hash-avatar 生成 */
  image?: string | null;
  /** hash-avatar 种子（优先展示名，其次邮箱） */
  name?: string | null;
  email?: string | null;
  /** 直径 px（默认 32） */
  size?: number;
}

const styles = stylex.create({
  img: {
    borderRadius: "50%",
    objectFit: "cover",
    flexShrink: 0,
  },
});

export function Avatar(props: AvatarProps) {
  const size = () => props.size ?? 32;
  const seed = () => props.name?.trim() || props.email?.trim() || "?";
  // hash-avatar 返回 SVG 字符串；encodeURIComponent 后作 data URI（独立 SVG 文档，多实例无 id 冲突）
  const dataUri = () => `data:image/svg+xml;utf8,${encodeURIComponent(hashAvatar(seed(), { size: size() }))}`;
  return (
    <Show
      when={props.image}
      fallback={
        <img
          src={dataUri()}
          alt={seed()}
          width={size()}
          height={size()}
          {...stylex.props(styles.img)}
        />
      }
    >
      <img
        src={props.image!}
        alt={seed()}
        width={size()}
        height={size()}
        {...stylex.props(styles.img)}
      />
    </Show>
  );
}
