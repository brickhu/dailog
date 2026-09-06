import { createHash } from "node:crypto";
// 可变配置统一基座：rules / prompts 同属“运行期可变的配置文件”
//   · R2 权威（key 见 keyOf）；本地文件/种子仅作兜底或 dev 旁路
//   · 指纹 sigOf(内容 hash)——替代 md mtime（R2 无 mtime），供反馈/版本回溯
export function keyOf(type, file) {
  if (type === "rules") return "rules/collect.json";
  if (type === "prompts") return "prompts/" + String(file || "").replace(/^\/+/, "");
  return null;
}
export function sigOf(text) {
  return createHash("sha256").update(String(text == null ? "" : text), "utf8").digest("hex").slice(0, 12);
}
