import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** @ffmpeg-installer/ffmpeg 提供跨平台二进制路径（fluent-ffmpeg 需要真实可执行文件） */
export function getFfmpegPath(): string {
  return (require("@ffmpeg-installer/ffmpeg") as { path: string }).path;
}

/** 生成 0.3s 静音 wav（16k mono s16）用于拼接测试 */
export function makeSilenceWav(): Uint8Array {
  const sampleRate = 16000;
  const seconds = 0.3;
  const dataSize = sampleRate * seconds * 2; // 16-bit mono
  const buf = new Uint8Array(44 + dataSize);
  const dv = new DataView(buf.buffer);
  // RIFF header
  dv.setUint32(0, 0x46464952, true); // "RIFF"
  dv.setUint32(4, 36 + dataSize, true);
  dv.setUint32(8, 0x45564157, true); // "WAVE"
  dv.setUint32(12, 0x20746d66, true); // "fmt "
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  dv.setUint32(36, 0x61746164, true); // "data"
  dv.setUint32(40, dataSize, true);
  return buf;
}
