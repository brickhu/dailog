import { createHash } from "node:crypto";
// 对话 R2 key 推导（纯函数）——必须与 services/api 侧同一公式：
//   "dialogues/" + sha256(url) 十六进制前 32 位 + ".json"
// 原实现位于 dailog-cli/dist/r2.js（已随 CLI 退役内联于此）；改动前请同步确认 api 侧推导。
export function dialogueR2Key(url) {
  return "dialogues/" + createHash("sha256").update(Buffer.from(String(url), "utf8")).digest("hex").slice(0, 32) + ".json";
}
