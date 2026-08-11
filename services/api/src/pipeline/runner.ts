import type { JobHandler } from "./queue";
import { synthesizeEpisode, type SynthesizeResult, GUEST_TRANSCRIPTS } from "./tts";
import { mergeEpisodeAudio, type MergeDeps } from "./merge";
import { spawn } from "node:child_process";
import type { TtsClient } from "../tts/client";
import type { AudioStorage } from "../storage";

export interface RunnerDeps {
  repo: {
    getEpisodeUserId(episodeId: string): Promise<string | null>;
    getEpisodeLanguage(episodeId: string): Promise<string | null>;
    /** 生成来源脚本：经 episodes.transcript_id → transcripts.segments */
    getEpisodeScript(episodeId: string): Promise<{ segments: { speaker: "host" | "guest"; text: string }[] } | null>;
    /** 节目元数据（ID3 标签用）：标题 + 期号 */
    getEpisodeMeta(episodeId: string): Promise<{ title: string | null; number: number | null } | null>;
    /** 生成来源嘉宾：经 episodes.transcript_id → transcripts.guest_id（无引用 → null） */
    getEpisodeGuest(episodeId: string): Promise<{ guestId: string | null } | null>;
    /** 嘉宾音频采样：按语种取（同语种优先）；无该语种 → null（用 voiceSampleAny 兜底） */
    getGuestVoiceSample(guestId: string, language: string): Promise<{
      audioKey: string; referenceId: string | null; transcript: string | null;
    } | null>;
    /** 兜底：该嘉宾任意语种采样 */
    getGuestVoiceSampleAny(guestId: string): Promise<{
      audioKey: string; referenceId: string | null; transcript: string | null;
    } | null>;
    /** 资产兜底音色 id（无表采样时的逐段降级 reference_id） */
    getGuestModelId(): Promise<string | null>;
    /** 按语种读录音样本（同语种注入 TTS）；无该语种 → null */
    getVoiceSampleByLanguage(userId: string, language: string): Promise<{ audioUrl: string; transcript: string | null } | null>;
    /** 兜底：最新录音样本（任意语种）——缺语种时不强求，用兜底样本 */
    getVoiceSample(userId: string): Promise<{ audioUrl: string; transcript: string | null } | null>;
    markJobProgress(jobId: string, status: string, progress: number): Promise<void>;
    markJobDone(jobId: string): Promise<void>;
    insertTrack(episodeId: string, language: string, audioKey: string, durationSeconds: number, size?: number | null): Promise<void>;
  };
  tts: TtsClient;
  storage: AudioStorage;
  assets: MergeDeps["assets"];
  ffmpegPath: string;
}

/** 生成管线执行器：queued → tts → merge → upload → done/failed */
/**
 * Fish 零样本参考音频格式要求（wav/mp3/flac/m4a）——浏览器录音产物是 webm/opus，
 * 直接传给 Fish 会 400 "Reference Audio is not valid"。按扩展名判断，webm/opus/ogg → ffmpeg 转 wav。
 */
async function toFishReferenceAudio(
  bytes: Uint8Array,
  audioUrl: string,
  ffmpegPath: string,
): Promise<Uint8Array> {
  const ext = audioUrl.split(".").pop()?.toLowerCase() ?? "";
  if (ext !== "webm" && ext !== "opus" && ext !== "ogg") return bytes;
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-i", "pipe:0", "-f", "wav", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg transcode failed (${code}): ${err.slice(-200)}`));
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    // stdin 必须监听 error——ffmpeg 提前退出时 EPIPE 会变成未捕获异常导致进程崩溃
    child.stdin.on("error", (e) => {
      if ((e as NodeJS.ErrnoException).code !== "EPIPE") reject(e);
    });
    child.stdin.write(bytes);
    child.stdin.end();
  });
}

export function createPipelineRunner(deps: RunnerDeps): JobHandler {
  return async (job, update) => {
    const progress = async (status: string, p: number) => {
      await deps.repo.markJobProgress(job.id, status, p);
      await update(p);
    };

    // 1. 加载 episode：语言 + 归属用户 + 最新脚本
    await progress("queued", 10);
    const userId = await deps.repo.getEpisodeUserId(job.episodeId);
    if (!userId) throw new Error("episode not found");
    const language = await deps.repo.getEpisodeLanguage(job.episodeId);
    if (!language) throw new Error("episode language not found");
    const script = await deps.repo.getEpisodeScript(job.episodeId);
    if (!script || script.segments.length === 0) throw new Error("script not found");

    // 2. 加载音色：主持人录音样本（同语种优先；无该语种 → 最新样本兜底）
    //    嘉宾采样（guests 表按平台 × 语种；同语种优先 → 任意语种兜底 → 旧资产兜底）
    await progress("tts", 20);
    let sample = language ? await deps.repo.getVoiceSampleByLanguage(userId, language) : null;
    if (!sample) sample = await deps.repo.getVoiceSample(userId); // 兜底：缺该语种采样用最新样本（前端已在创建时提醒）
    const hostBytes = sample ? await deps.storage.get(sample.audioUrl).catch(() => null) : null;
    // webm（浏览器录音）→ ffmpeg 转 wav；Fish 不接受 webm 参考音频
    const hostReferenceAudio = hostBytes ? await toFishReferenceAudio(hostBytes, sample?.audioUrl ?? "", deps.ffmpegPath) : null;
    const hostTranscript = sample?.transcript ?? null;

    const episodeGuest = await deps.repo.getEpisodeGuest(job.episodeId);
    let guestSample = episodeGuest?.guestId
      ? (await deps.repo.getGuestVoiceSample(episodeGuest.guestId, language))
        ?? (await deps.repo.getGuestVoiceSampleAny(episodeGuest.guestId))
      : null;
    let guestModelId: string | null = null;
    let guestReferenceAudio: Uint8Array | null = null;
    let guestTranscript = GUEST_TRANSCRIPTS[language] ?? null;
    if (guestSample) {
      // 表采样：音频 + 转录文本 + 音色 id 都随记录。
      // 采样音频读不到（文件缺失/失效记录）→ 整条采样视为无效，走资产兜底——
      // 否则失效的 referenceId 会打到 Fish 400（Reference not found）
      const guestBytes = await deps.storage.get(guestSample.audioKey).catch(() => null);
      if (guestBytes) {
        guestReferenceAudio = await toFishReferenceAudio(guestBytes, guestSample.audioKey, deps.ffmpegPath);
        guestTranscript = guestSample.transcript ?? guestTranscript;
        guestModelId = guestSample.referenceId ?? null;
      } else {
        guestSample = null;
      }
    }
    if (!guestSample) {
      // 兼容：无平台采样（或采样音频缺失）→ 旧通用资产（assets/guest-voice-<lang>.mp3）+ env 音色 id
      guestReferenceAudio = (await deps.assets.get(`assets/guest-voice-${language}.mp3`))
        ?? (await deps.assets.get("assets/guest-voice-zh.mp3"));
      guestModelId = await deps.repo.getGuestModelId();
    }

    // 3. 合成（主路径：references 2D 一次调用，转录文本精确；失败/缺样本 → 逐段降级），结果留内存供 merge 使用
    await progress("tts", 30);
    const ttsResult: SynthesizeResult = await synthesizeEpisode({
      segments: script.segments,
      deps: { tts: deps.tts, guestModelId, hostReferenceAudio, hostTranscript, guestReferenceAudio, guestTranscript, language },
    });

    // 4. ffmpeg 拼接 + 时长探测：intro + 主对话 + outro（资产缺失自动降级），产物留内存供 upload
    await progress("tts", 40);
    const epMeta = await deps.repo.getEpisodeMeta(job.episodeId);
    const { audio, durationSeconds } = await mergeEpisodeAudio({
      language,
      result: ttsResult,
      meta: epMeta ?? undefined,
      deps: { ffmpegPath: deps.ffmpegPath, assets: deps.assets },
    });

    // 5. upload：产物写入存储（audio/episodes/{userId}/{episodeId}.mp3）+ 落库完成。
    //    先 updateEpisodeAudio 再 markJobDone：job 标记 done 时音频必已可读（轮询方无竞态窗口）
    await progress("merge", 70);
    // R2 目录规划：episodes/{userId}/{episodeId}.mp3
    const audioKey = `episodes/${userId}/${job.episodeId}.mp3`;
    await deps.storage.put(audioKey, audio);
    await progress("upload", 90);
    // size = 音频字节数（RSS enclosure length）
    await deps.repo.insertTrack(job.episodeId, language, audioKey, durationSeconds, audio.length);
    await deps.repo.markJobDone(job.id);
    return { status: "done" };
  };
}
