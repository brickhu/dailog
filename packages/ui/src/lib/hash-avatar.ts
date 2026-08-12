// hash-avatar（CJS，无内置类型）：哈希确定性生成 SVG 头像字符串。
// 集中类型化 wrapper——引用方（site/studio/admin）编译本文件即获得类型，无需各自补 d.ts
// @ts-expect-error hash-avatar 无类型声明（老 CJS 包）
import hashAvatarImpl from "hash-avatar";

export const hashAvatar = hashAvatarImpl as (uid: string, opts: { size: number }) => string;
