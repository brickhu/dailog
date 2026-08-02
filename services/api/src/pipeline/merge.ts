import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "fluent-ffmpeg";
import type { SynthesizeResult } from "./tts";

export interface MergeDeps {
  ffmpegPath: string;
  assets: { get(key: string): Promise<Uint8Array | null> };
}

export interface MergeInput {
  language: string;
  deps: MergeDeps;
  /** runner 传入：tts 阶段产物（single 或 segments） */
  result?: SynthesizeResult;
  /** 直接传入音频（测试/独立调用）：单段主音频 */
  mainAudio?: Uint8Array;
  /** 直接传入音频（测试/独立调用）：分段列表 */
  segmentAudios?: Uint8Array[];
}

function normalizeResult(input: MergeInput): SynthesizeResult {
  if (input.result) return input.result;
  if (input.mainAudio) return { kind: "single", mainAudio: input.mainAudio };
  if (input.segmentAudios) return { kind: "segments", segmentAudios: input.segmentAudios };
  throw new Error("merge: no audio input");
}

/**
 * ffmpeg 拼接 intro + 主对话 + outro；资产缺失时降级为只拼主对话。
 * 用 concat demuxer + 统一重编码 mp3（128k）——输入在单次调用内格式一致
 * （prod 全为 Fish 产出的 mp3，测试全为同参数 wav），demuxer 按内容探测不受扩展名影响。
 */
export async function mergeEpisodeAudio(args: MergeInput): Promise<Uint8Array> {
  const { language, deps } = args;
  const result = normalizeResult(args);
  ffmpeg.setFfmpegPath(deps.ffmpegPath);
  const dir = await mkdtemp(join(tmpdir(), "dailogues-merge-"));
  try {
    const parts: string[] = [];
    // 片头/片尾资产（缺失 → null，降级）
    const intro = await deps.assets.get(`assets/intro.${language}.mp3`);
    const outro = await deps.assets.get(`assets/outro.${language}.mp3`);
    if (intro) {
      const f = join(dir, "intro.mp3");
      await writeFile(f, intro);
      parts.push(f);
    }
    if (result.kind === "single") {
      const f = join(dir, "main.mp3");
      await writeFile(f, result.mainAudio);
      parts.push(f);
    } else {
      for (let i = 0; i < result.segmentAudios.length; i++) {
        const f = join(dir, `seg-${i}.mp3`);
        await writeFile(f, result.segmentAudios[i]);
        parts.push(f);
      }
    }
    if (outro) {
      const f = join(dir, "outro.mp3");
      await writeFile(f, outro);
      parts.push(f);
    }
    if (parts.length === 0) throw new Error("merge: no audio parts to merge");

    const listFile = join(dir, "list.txt");
    await writeFile(listFile, parts.map((p) => `file '${p}'`).join("\n"));
    const outFile = join(dir, "out.mp3");
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(listFile)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions(["-c:a", "libmp3lame", "-b:a", "128k"])
        .output(outFile)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });
    return new Uint8Array(await readFile(outFile));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
