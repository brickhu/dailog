import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp, type AppDeps } from "../src/app";
import { createFavoritesRepo } from "../src/routes/favorites";
import { createDb } from "../src/db/client";
import { createRepo } from "../src/repo";
import type { Env } from "../src/config/env";
import {
  authUsers, episodes, generationJobs, guestVoiceSamples, polishes, profiles, snapshots, tracks, transcripts, voiceSamples,
} from "../src/db/schema";

const hasDb = Boolean(process.env.DATABASE_URL);

// profiles.id 引用 better-auth user.id（text），测试用户 id 用固定值
const REPO_USER = "11111111-1111-4111-8111-111111111111";
const API_USER = "22222222-2222-4222-8222-222222222222";
const QUOTA_USER = "33333333-3333-4333-8333-333333333333";

function makeEnv(): Env {
  return {
    DATABASE_URL: process.env.DATABASE_URL!,
    BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: "http://localhost:8787",
    PORT: 8787,
    DEEPSEEK_API_KEY: "",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
    DEEPSEEK_MODEL: "deepseek-chat",
    FISH_API_KEY: "",
    STORAGE_DRIVER: "fs",
    STORAGE_DIR: "./data",
    ASSETS_DIR: "assets/audio",
    APP_ORIGINS: "",
    POLISH_MAX_VERSIONS: 5,
      RESEND_API_KEY: "",
      EMAIL_FROM: "dailog <no-reply@dailog.fm>",
      ADMIN_EMAILS: "",
      SITE_BASE_URL: "https://site.dailog.fm",
  };
}

describe.skipIf(!hasDb)("drizzle repo (integration, local PG)", () => {
  const { db, client } = createDb(makeEnv());
  const repo = createRepo(db);

  beforeAll(async () => {
    // M5：profiles.id 引用 better-auth user.id，先建 user 行
    const now = new Date();
    await db.insert(authUsers).values([
      { id: REPO_USER, name: "Repo Test", email: "repo-test@test.local", emailVerified: true, createdAt: now, updatedAt: now },
      { id: API_USER, name: "API Test", email: "api-test@test.local", emailVerified: true, createdAt: now, updatedAt: now },
      { id: QUOTA_USER, name: "Quota Test", email: "quota-test@test.local", emailVerified: true, createdAt: now, updatedAt: now },
    ]).onConflictDoNothing();
    await db.insert(profiles).values([
      { id: REPO_USER, username: "repo-test-user", displayName: "Repo Test", channelActivatedAt: new Date() },
      { id: API_USER, username: "api-test-user", displayName: "API Test", channelActivatedAt: new Date() },
      // 配额测试种子：free + 5 积分（已开通频道）
      { id: QUOTA_USER, username: "quota-test-user", displayName: "Quota Test", plan: "free", creditBalance: 5, channelActivatedAt: new Date() },
    ]).onConflictDoNothing();
  });

  afterAll(async () => {
    // profile 级联删除 voice_samples/polishes→transcripts→episodes→generation_jobs；user 级联 profiles
    // （snapshots 为全局资源无 user 关联，测试数据按 url 唯一自然留存）
    await db.delete(profiles).where(eq(profiles.id, REPO_USER));
    await db.delete(profiles).where(eq(profiles.id, API_USER));
    await db.delete(profiles).where(eq(profiles.id, QUOTA_USER));
    await db.delete(authUsers).where(eq(authUsers.id, REPO_USER));
    await db.delete(authUsers).where(eq(authUsers.id, API_USER));
    await db.delete(authUsers).where(eq(authUsers.id, QUOTA_USER));
    await client.end();
  });

  /** 五层链路：snapshot → polish → transcript → episode，返回各层 id */
  async function makeEpisode(
    userId: string, title: string, language: string | null = "zh",
  ): Promise<{ episodeId: string; snapshotId: string; polishId: string; transcriptId: string }> {
    const snap = await repo.snapshots.create({
      url: `https://test.local/share/${crypto.randomUUID()}`,
      platform: "plain",
      sourceTitle: title,
      sourceConversationId: null,
      parsedDialogue: [{ role: "user", content: "你好" }],
    });
    const polish = await repo.polishes.create({ userId, snapshotId: snap.id, title });
    if (!polish.id) throw new Error("polish create failed");
    const transcript = await repo.transcripts.create(
      polish.id, [{ speaker: "host", text: "你好" }], language,
    );
    const episode = await repo.episodes.create({ userId, transcriptId: transcript.id, polishId: polish.id, title });
    return { episodeId: episode.id, snapshotId: snap.id, polishId: polish.id, transcriptId: transcript.id };
  }

  describe("snapshots repo", () => {
    it("getByUrl returns null for unknown url", async () => {
      expect(await repo.snapshots.getByUrl(`https://test.local/missing-${Date.now()}`)).toBeNull();
    });

    it("create then getByUrl roundtrip (url 唯一命中；status=ok)", async () => {
      const url = `https://test.local/share/${crypto.randomUUID()}`;
      const created = await repo.snapshots.create({
        url, platform: "claude", sourceTitle: "集成测试", sourceConversationId: "conv-1",
        parsedDialogue: [{ role: "user", content: "你好" }],
      });
      const found = await repo.snapshots.getByUrl(url);
      expect(found).toMatchObject({
        id: created.id, platform: "claude", sourceTitle: "集成测试",
        sourceConversationId: "conv-1", status: "ok", quality: null, lastError: null,
      });
      expect((found?.parsedDialogue as { role: string; content: string }[])[0]).toEqual({ role: "user", content: "你好" });
      // getById 返回内容 + 标题
      expect(await repo.snapshots.getById(created.id)).toMatchObject({
        sourceTitle: "集成测试",
      });
      expect((await repo.snapshots.getById(created.id))?.parsedDialogue).toEqual(found?.parsedDialogue);
    });

    it("updateContent 覆盖内容并把状态重置为 ok（清 retryAfter/lastError）", async () => {
      const url = `https://test.local/share/${crypto.randomUUID()}`;
      const { id } = await repo.snapshots.create({
        url, platform: "plain", sourceTitle: null, sourceConversationId: null, parsedDialogue: null,
      });
      await repo.snapshots.markParseFailed(id, "解析失败");
      expect((await repo.snapshots.getByUrl(url))?.status).toBe("parse_failed");
      await repo.snapshots.updateContent(id, {
        url, platform: "deepseek", sourceTitle: "重采", sourceConversationId: "conv-2",
        parsedDialogue: [{ role: "assistant", content: "hi" }],
      });
      const after = await repo.snapshots.getByUrl(url);
      expect(after).toMatchObject({ platform: "deepseek", sourceTitle: "重采", status: "ok", lastError: null, retryAfter: null });
      expect((after?.parsedDialogue as { role: string }[])[0]).toEqual({ role: "assistant", content: "hi" });
    });

    it("updateQuality 写入质量结果", async () => {
      const url = `https://test.local/share/${crypto.randomUUID()}`;
      const { id } = await repo.snapshots.create({
        url, platform: "plain", sourceTitle: null, sourceConversationId: null, parsedDialogue: [],
      });
      await repo.snapshots.updateQuality(id, { pass: true, language: "zh" });
      expect((await repo.snapshots.getByUrl(url))?.quality).toEqual({ pass: true, language: "zh" });
    });

    it("markUnreachable 标注状态 + retryAfter 未来时间", async () => {
      const url = `https://test.local/share/${crypto.randomUUID()}`;
      const { id } = await repo.snapshots.create({
        url, platform: "plain", sourceTitle: null, sourceConversationId: null, parsedDialogue: null,
      });
      await repo.snapshots.markUnreachable(id, "平台不可达");
      const found = await repo.snapshots.getByUrl(url);
      expect(found).toMatchObject({ status: "unreachable", lastError: "平台不可达" });
      expect(found!.retryAfter!.getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
    });

    it("markParseFailed 标注解析失败", async () => {
      const url = `https://test.local/share/${crypto.randomUUID()}`;
      const { id } = await repo.snapshots.create({
        url, platform: "plain", sourceTitle: null, sourceConversationId: null, parsedDialogue: null,
      });
      await repo.snapshots.markParseFailed(id, "页面结构异常");
      expect(await repo.snapshots.getByUrl(url)).toMatchObject({ status: "parse_failed", lastError: "页面结构异常" });
    });
  });

  describe("polishes repo", () => {
    it("create + findByUserSnapshot roundtrip（status 默认 editing）", async () => {
      const url = `https://test.local/share/${crypto.randomUUID()}`;
      const { id: snapshotId } = await repo.snapshots.create({
        url, platform: "plain", sourceTitle: "容器测试", sourceConversationId: null, parsedDialogue: [],
      });
      const { id } = await repo.polishes.create({ userId: REPO_USER, snapshotId, title: "容器测试" });
      expect(id).toBeTruthy();
      const found = await repo.polishes.findByUserSnapshot(REPO_USER, snapshotId);
      expect(found).toMatchObject({ id, title: "容器测试", status: "editing" });
      // 其他用户不可见
      expect(await repo.polishes.findByUserSnapshot(API_USER, snapshotId)).toBeNull();
    });

    it("用户 × 快照唯一：重复 create 返回空 id（竞态语义）", async () => {
      const url = `https://test.local/share/${crypto.randomUUID()}`;
      const { id: snapshotId } = await repo.snapshots.create({
        url, platform: "plain", sourceTitle: null, sourceConversationId: null, parsedDialogue: [],
      });
      const first = await repo.polishes.create({ userId: REPO_USER, snapshotId, title: null });
      expect(first.id).toBeTruthy();
      const dup = await repo.polishes.create({ userId: REPO_USER, snapshotId, title: "重复" });
      expect(dup.id).toBe("");
      // 其他用户不受影响（唯一键是 userId + snapshotId）
      const other = await repo.polishes.create({ userId: API_USER, snapshotId, title: null });
      expect(other.id).toBeTruthy();
    });

    it("getOwned 归属校验（防 IDOR）", async () => {
      const url = `https://test.local/share/${crypto.randomUUID()}`;
      const { id: snapshotId } = await repo.snapshots.create({
        url, platform: "plain", sourceTitle: null, sourceConversationId: null, parsedDialogue: [],
      });
      const { id } = await repo.polishes.create({ userId: REPO_USER, snapshotId, title: "归属" });
      expect(await repo.polishes.getOwned(id, REPO_USER)).toMatchObject({ id, snapshotId, title: "归属" });
      expect(await repo.polishes.getOwned(id, API_USER)).toBeNull();
    });

    it("getPolishDetail 返回快照 meta + transcripts；他人不可见", async () => {
      const url = `https://test.local/share/${crypto.randomUUID()}`;
      const { id: snapshotId } = await repo.snapshots.create({
        url, platform: "plain", sourceTitle: "详情标题", sourceConversationId: null, parsedDialogue: [],
      });
      const { id } = await repo.polishes.create({ userId: REPO_USER, snapshotId, title: "容器" });
      await repo.transcripts.create(id, [{ speaker: "host", text: "你好" }], "zh");
      const detail = await repo.polishes.getPolishDetail(id, REPO_USER);
      expect(detail).toMatchObject({ id, title: "容器", snapshotTitle: "详情标题", snapshotUrl: url });
      expect(detail!.transcripts).toHaveLength(1);
      expect(detail!.transcripts[0].segments).toEqual([{ speaker: "host", text: "你好" }]);
      expect(await repo.polishes.getPolishDetail(id, API_USER)).toBeNull();
    });

    it("listByUser 返回 polish + 快照标题/平台 + 脚本列表（title/status）", async () => {
      const { polishId, episodeId } = await makeEpisode(REPO_USER, "工作台列表", "zh");
      const rows = await repo.polishes.listByUser(REPO_USER);
      const row = rows.find((r) => r.id === polishId);
      expect(row).toMatchObject({ id: polishId, title: "工作台列表", snapshotTitle: "工作台列表", episodeId, episodeStatus: "generating" });
      // makeEpisode 的平台是 "plain"（无 guests 映射）→ aiName null
      expect(row?.platform).toBe("plain");
      expect(row?.aiName).toBeNull();
      expect(row?.scripts).toHaveLength(1);
      expect(row?.scripts[0]).toMatchObject({ title: null, topic: null, status: "unused" });
    });
  });

  describe("guest voice samples repo", () => {
    // 共享 dev DB：测试数据跑完即清，避免污染管线（假 referenceId/缺失音频会打到生产生成）
    afterEach(async () => {
      await db.delete(guestVoiceSamples);
    });

    it("upsert 按 guest×language 唯一：重复录入覆盖 audio_key/transcript", async () => {
      await repo.guests.upsertVoiceSample({
        guestId: "claude", language: "zh", audioKey: "guest-voices/claude/zh.mp3", transcript: "第一版文案",
      });
      await repo.guests.upsertVoiceSample({
        guestId: "claude", language: "zh", audioKey: "guest-voices/claude/zh-v2.mp3", transcript: "第二版文案",
      });
      const rows = await repo.guests.listVoiceSamples();
      const zh = rows.filter((r) => r.guestId === "claude" && r.language === "zh");
      expect(zh).toHaveLength(1);
      expect(zh[0]).toMatchObject({ audioKey: "guest-voices/claude/zh-v2.mp3", transcript: "第二版文案", guestName: "Claude" });
    });

    it("voiceSampleByLanguage 按语种取；无该语种 → voiceSampleAny 兜底", async () => {
      await repo.guests.upsertVoiceSample({ guestId: "deepseek", language: "en", audioKey: "guest-voices/deepseek/en.mp3", referenceId: "ref-en" });
      expect((await repo.guests.voiceSampleByLanguage("deepseek", "en"))?.audioKey).toBe("guest-voices/deepseek/en.mp3");
      // 目标语种 zh 无采样 → null → any 兜底取 en
      expect(await repo.guests.voiceSampleByLanguage("deepseek", "zh")).toBeNull();
      expect((await repo.guests.voiceSampleAny("deepseek"))?.language).toBe("en");
      // 无任何采样的嘉宾
      expect(await repo.guests.voiceSampleAny("kimi")).toBeNull();
    });
  });

  describe("transcripts repo", () => {
    it("create + listByPolish roundtrip（同秒创建时顺序不保证，仅断言集合）", async () => {
      // 自建容器（makeEpisode 自带 1 条脚本，会让计数漂移）
      const snap = await repo.snapshots.create({
        url: `https://test.local/share/${crypto.randomUUID()}`,
        platform: "plain", sourceTitle: "脚本列表", sourceConversationId: null,
        parsedDialogue: [{ role: "user", content: "你好" }],
      });
      const polish = await repo.polishes.create({ userId: REPO_USER, snapshotId: snap.id, title: "脚本列表" });
      await repo.transcripts.create(polish.id, [{ speaker: "host", text: "第一版" }], "zh");
      await repo.transcripts.create(polish.id, [{ speaker: "host", text: "第二版" }], "en");
      const rows = await repo.transcripts.listByPolish(polish.id);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.language).sort()).toEqual(["en", "zh"]);
    });

    it("getOwned 归属校验（join polish.user_id）", async () => {
      const { polishId, transcriptId } = await makeEpisode(REPO_USER, "脚本归属", "zh");
      expect(await repo.transcripts.getOwned(transcriptId, REPO_USER)).toMatchObject({
        id: transcriptId, polishId,
      });
      expect(await repo.transcripts.getOwned(transcriptId, API_USER)).toBeNull();
    });

    it("updateSegments 写 updated_segments：原始 segments 保留，getOwned 读有效脚本", async () => {
      const { transcriptId, polishId } = await makeEpisode(REPO_USER, "脚本编辑", "zh");
      await repo.transcripts.updateSegments(transcriptId, [{ speaker: "guest", text: "改后" }]);
      // 生成/详情读编辑后的有效脚本（updated ?? 原始）
      expect((await repo.transcripts.getOwned(transcriptId, REPO_USER))!.segments).toEqual([{ speaker: "guest", text: "改后" }]);
      // 原始 segments（LLM 生成）保留，供对比/恢复
      const rows = await repo.transcripts.listByPolish(polishId);
      expect(rows.find((r) => r.id === transcriptId)!.segments).toEqual([{ speaker: "host", text: "你好" }]);
    });
  });

  describe("episodes repo", () => {
    it("create + getOwned + listByUser roundtrip（status 默认 generating）", async () => {
      const { episodeId, transcriptId, polishId } = await makeEpisode(REPO_USER, "节目测试", "zh");
      expect(await repo.episodes.getOwned(episodeId, REPO_USER)).toMatchObject({
        id: episodeId, transcriptId, polishId, title: "节目测试", status: "generating",
      });
      expect(await repo.episodes.getOwned(episodeId, API_USER)).toBeNull(); // IDOR 过滤
      const list = await repo.episodes.listByUser(REPO_USER);
      expect(list.some((e) => e.id === episodeId && e.title === "节目测试")).toBe(true);
      expect(await repo.episodes.listByUser(API_USER)).toEqual([]);
    });

    it("getEpisodeScript 经 transcript join 返回 segments；无节目返回 null", async () => {
      const { episodeId } = await makeEpisode(REPO_USER, "来源脚本", "zh");
      expect(await repo.episodes.getEpisodeScript(episodeId)).toEqual({
        segments: [{ speaker: "host", text: "你好" }],
      });
      expect(await repo.episodes.getEpisodeScript("00000000-0000-4000-8000-000000000000")).toBeNull();
    });

    it("getEpisodeAudio 无音频返回 null；updateEpisodeAudio 后返回 key", async () => {
      const { episodeId } = await makeEpisode(REPO_USER, "试听", "zh");
      expect(await repo.episodes.getEpisodeAudio(episodeId, REPO_USER)).toBeNull();
      expect(await repo.episodes.getEpisodeAudio(episodeId, API_USER)).toBeNull();
      await repo.episodes.insertTrack(episodeId, "zh", "episodes/u/ep.mp3", 123);
      expect(await repo.episodes.getEpisodeAudio(episodeId, REPO_USER)).toBe("episodes/u/ep.mp3");
    });

    it("getPublishedDialogue：发布前 null，发布后返回对话来源 meta（snapshots join 链）", async () => {
      const url = `https://test.local/share/${crypto.randomUUID()}`;
      const { id: snapshotId } = await repo.snapshots.create({
        url, platform: "deepseek", sourceTitle: "公开原文", sourceConversationId: "pub-1",
        parsedDialogue: [{ role: "user", content: "hi" }],
      });
      const { id: polishId } = await repo.polishes.create({ userId: REPO_USER, snapshotId, title: "公开原文" });
      const { id: transcriptId } = await repo.transcripts.create(polishId, [{ speaker: "host", text: "hi" }], "zh");
      const { id: episodeId } = await repo.episodes.create({
        userId: REPO_USER, transcriptId, polishId, title: "公开原文",
      });
      expect(await repo.episodes.getPublishedDialogue(episodeId)).toBeNull(); // 未发布不可见
      await repo.episodes.setPublished(episodeId);
      const out = await repo.episodes.getPublishedDialogue(episodeId);
      expect(out).toMatchObject({
        platform: "deepseek", sourceTitle: "公开原文", sourceUrl: url,
      });
      expect((out?.parsedDialogue as { role: string }[])[0]).toEqual({ role: "user", content: "hi" });
    });

    it("setPublished 更新 status/publishedAt/isPublic", async () => {
      const { episodeId } = await makeEpisode(REPO_USER, "发布测试", "zh");
      await repo.episodes.setPublished(episodeId);
      expect((await repo.episodes.getOwned(episodeId, REPO_USER))?.status).toBe("published");
      const row = await db
        .select({ publishedAt: episodes.publishedAt, isPublic: episodes.isPublic })
        .from(episodes).where(eq(episodes.id, episodeId));
      expect(row[0].publishedAt).toBeInstanceOf(Date);
      expect(row[0].isPublic).toBe(true);
    });
  });

  describe("jobs repo", () => {
    it("getQuotaInfo returns plan/credit_balance and counts only done jobs", async () => {
      const { episodeId } = await makeEpisode(QUOTA_USER, "配额统计", "zh");
      const before = await repo.jobs.getQuotaInfo(QUOTA_USER);
      expect(before).toMatchObject({ plan: "free", generatedCount: 0, creditBalance: 5 });

      const job = await repo.jobs.createJob(episodeId);
      expect(job).toMatchObject({ episodeId, status: "queued", progress: 0 });
      // queued 未完成：不计入 generatedCount
      expect((await repo.jobs.getQuotaInfo(QUOTA_USER)).generatedCount).toBe(0);

      await db.update(generationJobs).set({ status: "done" }).where(eq(generationJobs.id, job.id));
      expect((await repo.jobs.getQuotaInfo(QUOTA_USER)).generatedCount).toBe(1);
      // 其他用户 job 不计入（归属过滤）
      expect((await repo.jobs.getQuotaInfo(REPO_USER)).generatedCount).toBe(0);
    });

    it("consumeQuota decrements credit_balance for free; pro no-op", async () => {
      await repo.jobs.consumeQuota(QUOTA_USER, 1);
      let row = await db.select({ balance: profiles.creditBalance }).from(profiles).where(eq(profiles.id, QUOTA_USER));
      expect(row[0].balance).toBe(4);

      await db.update(profiles).set({ plan: "pro" }).where(eq(profiles.id, QUOTA_USER));
      await repo.jobs.consumeQuota(QUOTA_USER, 1);
      row = await db.select({ balance: profiles.creditBalance }).from(profiles).where(eq(profiles.id, QUOTA_USER));
      expect(row[0].balance).toBe(4);

      // 恢复 free 供后续用例使用
      await db.update(profiles).set({ plan: "free" }).where(eq(profiles.id, QUOTA_USER));
    });

    it("getLatestJob returns newest job by created_at desc, or null", async () => {
      const { episodeId } = await makeEpisode(QUOTA_USER, "最新 job", "zh");
      expect(await repo.jobs.getLatestJob(episodeId)).toBeNull();

      const j1 = await repo.jobs.createJob(episodeId);
      await db.update(generationJobs)
        .set({ createdAt: new Date(Date.now() - 60_000) })
        .where(eq(generationJobs.id, j1.id));
      const j2 = await repo.jobs.createJob(episodeId);

      const latest = await repo.jobs.getLatestJob(episodeId);
      expect(latest?.id).toBe(j2.id);
      expect(latest).toMatchObject({ status: "queued", progress: 0, error: null });
    });

    it("listRecoverableJobs returns only queued/tts/merge/upload jobs", async () => {
      const { episodeId } = await makeEpisode(QUOTA_USER, "启动恢复", "zh");
      const q = await repo.jobs.createJob(episodeId);
      await repo.jobs.markJobProgress(q.id, "tts", 10);

      // done / failed 不入恢复集
      const done = await repo.jobs.createJob(episodeId);
      await repo.jobs.markJobDone(done.id);
      const failed = await repo.jobs.createJob(episodeId);
      await db.update(generationJobs).set({ status: "failed" }).where(eq(generationJobs.id, failed.id));

      const recoverable = await repo.jobs.listRecoverableJobs();
      const ids = recoverable.map((j) => j.id);
      expect(ids).toContain(q.id);
      expect(ids).not.toContain(done.id);
      expect(ids).not.toContain(failed.id);
      const qRow = recoverable.find((j) => j.id === q.id);
      expect(qRow).toEqual({ id: q.id, episodeId });
    });

    it("markJobProgress updates status and progress", async () => {
      const { episodeId } = await makeEpisode(QUOTA_USER, "进度推进", "zh");
      const job = await repo.jobs.createJob(episodeId);
      await repo.jobs.markJobProgress(job.id, "merge", 60);
      expect(await repo.jobs.getLatestJob(episodeId)).toMatchObject({ status: "merge", progress: 60, error: null });
    });

    it("markJobDone sets status done and progress 100", async () => {
      const { episodeId } = await makeEpisode(QUOTA_USER, "完成标记", "zh");
      const job = await repo.jobs.createJob(episodeId);
      await repo.jobs.markJobProgress(job.id, "upload", 90);
      await repo.jobs.markJobDone(job.id);
      expect(await repo.jobs.getLatestJob(episodeId)).toMatchObject({ status: "done", progress: 100, error: null });
    });

    it("updateEpisodeAudio writes audio_url and duration_seconds", async () => {
      const { episodeId } = await makeEpisode(QUOTA_USER, "音频落库", "zh");
      await repo.episodes.insertTrack(episodeId, "zh", "audio/ep-1.mp3", 123);
      const row = await db
        .select({ audioUrl: tracks.audioUrl, durationSeconds: tracks.durationSeconds })
        .from(tracks)
        .where(eq(tracks.episodeId, episodeId));
      expect(row[0]).toEqual({ audioUrl: "audio/ep-1.mp3", durationSeconds: 123 });
    });
  });

  describe("voice pipeline repo (Task 7)", () => {
    it("getEpisodeUserId / getEpisodeLanguage return episode owner and language", async () => {
      const { episodeId } = await makeEpisode(REPO_USER, "管线归属", "zh");
      expect(await repo.episodes.getEpisodeUserId(episodeId)).toBe(REPO_USER);
      expect(await repo.episodes.getEpisodeLanguage(episodeId)).toBe("zh");
      expect(await repo.episodes.getEpisodeUserId("00000000-0000-4000-8000-000000000000")).toBeNull();
      expect(await repo.episodes.getEpisodeLanguage("00000000-0000-4000-8000-000000000000")).toBeNull();
    });

    it("getHostModelId / getVoiceSampleKey read latest ready voice sample (reference_id)", async () => {
      // 幂等：清掉可能残留的样本行再断言空态
      await db.delete(voiceSamples).where(eq(voiceSamples.userId, REPO_USER));
      expect(await repo.episodes.getHostModelId(REPO_USER)).toBeNull();
      expect(await repo.episodes.getVoiceSampleKey(REPO_USER)).toBeNull();

      await db.insert(voiceSamples).values([
        // (user_id, language) 唯一：三条样本各占一个语种
        { userId: REPO_USER, language: "zh", audioUrl: "voice/old.wav", duration: 3, status: "ready", referenceId: "old-model", transcript: null, createdAt: new Date(Date.now() - 60_000) },
        { userId: REPO_USER, language: "en", audioUrl: "voice/latest.wav", duration: 4, status: "ready", referenceId: "latest-model", transcript: null, createdAt: new Date() },
        // failed 样本不参与（最新但状态失败）
        { userId: REPO_USER, language: "fr", audioUrl: "voice/failed.wav", duration: 2, status: "failed", referenceId: "failed-model", transcript: null, createdAt: new Date(Date.now() + 60_000) },
      ]);

      expect(await repo.episodes.getHostModelId(REPO_USER)).toBe("latest-model");
      expect(await repo.episodes.getVoiceSampleKey(REPO_USER)).toBe("voice/latest.wav");
      // 其他用户无样本
      expect(await repo.episodes.getHostModelId(API_USER)).toBeNull();
      expect(await repo.episodes.getVoiceSampleKey(API_USER)).toBeNull();
    });

    it("saveVoiceSample upserts: 同 user 覆盖旧行，仅留最新一条", async () => {
      // 幂等：清掉可能残留的样本行
      await db.delete(voiceSamples).where(eq(voiceSamples.userId, REPO_USER));
      await repo.episodes.saveVoiceSample({
        userId: REPO_USER, language: "zh", audioUrl: "voice/one.wav", referenceId: "m-one", transcript: null, duration: 3, status: "ready",
      });
      await repo.episodes.saveVoiceSample({
        userId: REPO_USER, language: "zh", audioUrl: "voice/two.wav", referenceId: "m-two", transcript: null, duration: 4, status: "ready",
      });
      const rows = await db.select().from(voiceSamples).where(eq(voiceSamples.userId, REPO_USER));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        audioUrl: "voice/two.wav", referenceId: "m-two", duration: 4, status: "ready",
      });
      // failed 覆盖也生效（status 可写失败态）
      await repo.episodes.saveVoiceSample({
        userId: REPO_USER, language: "zh", audioUrl: "voice/broken.wav", referenceId: null, transcript: null, duration: 0, status: "failed",
      });
      const failed = await db.select().from(voiceSamples).where(eq(voiceSamples.userId, REPO_USER));
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ audioUrl: "voice/broken.wav", referenceId: null, status: "failed" });
      // 其他用户不受影响
      await repo.episodes.saveVoiceSample({
        userId: API_USER, language: "zh", audioUrl: "voice/other.wav", referenceId: "m-other", transcript: null, duration: 1, status: "ready",
      });
      expect(await db.select().from(voiceSamples).where(eq(voiceSamples.userId, API_USER))).toHaveLength(1);
      expect(await db.select().from(voiceSamples).where(eq(voiceSamples.userId, REPO_USER))).toHaveLength(1);
    });
  });

  describe("api via real repo", () => {
    const importDeps: AppDeps["importDeps"] = {
      getSnapshotByUrl: (url) => repo.snapshots.getByUrl(url),
      createSnapshot: (row) => repo.snapshots.create(row),
      // ImportDeps 的 content row 不含 url（url 不变），repo.updateContent 的 SnapshotRow.url 为遗留字段
      updateSnapshotContent: (id, row) => repo.snapshots.updateContent(id, { url: "", ...row }),
      markSnapshotUnreachable: (id, error) => repo.snapshots.markUnreachable(id, error),
      markSnapshotParseFailed: (id, error) => repo.snapshots.markParseFailed(id, error),
      findPolishByUserSnapshot: (userId, snapshotId) => repo.polishes.findByUserSnapshot(userId, snapshotId),
    };
    const polishesDeps: AppDeps["polishesDeps"] = {
      getChannelActivatedAt: (userId) => repo.episodes.getChannelActivatedAt(userId),
      findPolishByUserSnapshot: (userId, snapshotId) => repo.polishes.findByUserSnapshot(userId, snapshotId),
      createPolish: (row) => repo.polishes.create(row),
      getPolishDetail: (id, userId) => repo.polishes.getPolishDetail(id, userId),
      listByUser: async () => [],
    };
    const transcriptsDeps: AppDeps["transcriptsDeps"] = {
      getDialogueForPolish: async (polishId, userId) => {
        const polish = await repo.polishes.getOwned(polishId, userId);
        if (!polish) return null;
        const snapshot = await repo.snapshots.getById(polish.snapshotId);
        if (!snapshot?.parsedDialogue) return null;
        return {
          messages: (snapshot.parsedDialogue as { role: string; content: string }[]).map((m) => ({ role: m.role, content: m.content })),
          platform: snapshot.platform,
        };
      },
      getTranscriptCount: async (polishId) => (await repo.transcripts.listByPolish(polishId)).length,
      getPolishLimit: async () => 5,
      createTranscript: (polishId, segments, language) => repo.transcripts.create(polishId, segments, language),
      getOwnedTranscript: (id, userId) => repo.transcripts.getOwned(id, userId),
      guestsByPlatform: {},
      updateTranscriptSegments: (id, segments) => repo.transcripts.updateSegments(id, segments),
      llm: {
        complete: async () => "",
        stream: async (_msgs, onDelta) => {
          const json = '{"language":"zh","segments":[{"speaker":"host","text":"你好"},{"speaker":"guest","text":"你好！"}]}';
          onDelta(json);
          return json;
        },
      },
    };
    const episodesDeps: AppDeps["episodesDeps"] = {
      listByUser: (userId) => repo.episodes.listByUser(userId),
      getOwned: (id, userId) => repo.episodes.getOwned(id, userId),
      getEpisodeAudio: (id, userId) => repo.episodes.getEpisodeAudio(id, userId),
      getOwnedTranscript: (id, userId) => repo.transcripts.getOwned(id, userId),
      getEpisodeByTranscript: (transcriptId) => repo.episodes.getByTranscript(transcriptId),
      createEpisode: (row) => repo.episodes.create(row),
      safetyCheck: async () => ({ pass: true }),
      getChannelActive: async (userId) => (await repo.episodes.getChannelActivatedAt(userId)) !== null,
      getQuota: (userId) => repo.jobs.getQuotaInfo(userId),
      consumeQuota: (userId, credit) => repo.jobs.consumeQuota(userId, credit),
      createJob: (episodeId) => repo.jobs.createJob(episodeId),
      getLatestJob: async () => null,
      enqueueJob: async () => {},
      setPublished: (id) => repo.episodes.setPublished(id),
      getChannelActivatedAt: (userId) => repo.episodes.getChannelActivatedAt(userId),
      getHostModelId: (userId) => repo.episodes.getHostModelId(userId),
      getVoiceSampleKey: (userId) => repo.episodes.getVoiceSampleKey(userId),
      getVoiceSample: (userId) => repo.episodes.getVoiceSample(userId),
      getVoiceSampleByLanguage: (userId, language) => repo.episodes.getVoiceSampleByLanguage(userId, language),
      markUsed: (transcriptId) => repo.transcripts.markUsed(transcriptId),
      saveVoiceSample: (row) => repo.episodes.saveVoiceSample(row),
    };
    const job: AppDeps["job"] = {
      getOwnedEpisode: (episodeId, userId) => repo.jobs.getOwnedEpisode(episodeId, userId),
      getLatestJob: (episodeId) => repo.jobs.getLatestJob(episodeId),
    };
    const voice: AppDeps["voice"] = {
      saveVoiceSample: (row) => repo.episodes.saveVoiceSample(row),
            storage: { put: async () => {}, get: async () => new Uint8Array(), delete: async () => {} },
    };
    const channel: AppDeps["channel"] = { activateChannel: async () => ({ ok: true }) };
    const favorites = createFavoritesRepo(db);
    const app = createApp({
      env: makeEnv(),
      auth: {
        handler: async () => new Response("", { status: 404 }),
        api: { getSession: async () => ({ user: { id: API_USER } }) },
      },
      channel,
      favorites,
      repo,
      importDeps,
      polishesDeps,
      transcriptsDeps,
      episodesDeps,
      job,
      voice,
      admin: {
        isAdmin: async () => false,
        createInviteCode: async () => ({ ok: true, code: "fake", expiresAt: null }),
        storage: { put: async () => {} },
        upsertGuestVoiceSample: async () => {},
        listGuestVoiceSamples: async () => [],
        listGuests: async () => [],
      },
    });

    /** 预置五层链（snapshot 预置 → import 命中缓存），返回 url + transcriptId */
    async function seedChain(title: string): Promise<{ url: string; transcriptId: string; polishId: string }> {
      const url = `https://claude.ai/chat/api-${crypto.randomUUID()}`;
      // 对话需过导入规则门槛（≥3 轮用户问答且总字数 ≥500）——短对话会被 422 too_short 拒绝
      const longAnswer = "是的，这个问题的关键在于理解它的本质。".repeat(25);
      await repo.snapshots.create({
        url, platform: "claude", sourceTitle: title, sourceConversationId: `conv-${crypto.randomUUID()}`,
        parsedDialogue: [
          { role: "user", content: "你好，我有一个问题想请教。" },
          { role: "assistant", content: longAnswer },
          { role: "user", content: "明白了，那第二个问题呢？" },
          { role: "assistant", content: "第二个问题同样值得深入探讨。" },
          { role: "user", content: "好的，最后一个问题。" },
          { role: "assistant", content: longAnswer },
        ],
      });
      const importRes = await app.request("/v1/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token" },
        body: JSON.stringify({ url }),
      });
      expect(importRes.status).toBe(200);
      const { snapshotId } = (await importRes.json()) as { snapshotId: string };
      const polishRes = await app.request("/v1/polishes/new", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token" },
        body: JSON.stringify({ snapshotId, title }),
      });
      expect(polishRes.status).toBe(200);
      const { polishId } = (await polishRes.json()) as { polishId: string };
      const transcriptRes = await app.request("/v1/transcripts/new", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token" },
        body: JSON.stringify({ polishId }),
      });
      expect(transcriptRes.status).toBe(200);
      const sseText = await transcriptRes.text();
      expect(sseText).toContain("event: done");
      const transcriptId = sseText.match(/"transcriptIds":\["([^"]+)"/)?.[1];
      expect(transcriptId).toBeTruthy();
      return { url, transcriptId: transcriptId!, polishId };
    }

    it("import → polish(409 duplicate) → transcript SSE → episode 202 → list/detail/publish/job", async () => {
      const { url, transcriptId } = await seedChain("HTTP 集成");

      // 重复导入：import 短路检测到已有容器 → 200 { existing: true, polishId }（前端直接跳编辑页）
      const importAgain = await app.request("/v1/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token" },
        body: JSON.stringify({ url }),
      });
      expect(importAgain.status).toBe(200);
      const againBody = (await importAgain.json()) as { existing?: boolean; polishId?: string };
      expect(againBody).toMatchObject({ existing: true });
      // 绕过 import 短路直接调 polish/new（重复创建同一快照）→ 409 返回已有容器
      const snapshot = await repo.snapshots.getByUrl(url);
      const polishAgain = await app.request("/v1/polishes/new", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token" },
        body: JSON.stringify({ snapshotId: snapshot!.id }),
      });
      expect(polishAgain.status).toBe(409);
      expect(await polishAgain.json()).toMatchObject({ existing: true });

      // transcript 落库（语言 zh——生成管线必填默认）
      const t = await repo.transcripts.getOwned(transcriptId, API_USER);
      expect(t).toMatchObject({ language: "zh" });
      expect(t?.segments).toEqual([
        { speaker: "host", text: "你好" },
        { speaker: "guest", text: "你好！" },
      ]);

      // 创建节目 → 202 + job
      const genRes = await app.request("/v1/episodes/new", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token" },
        body: JSON.stringify({ transcriptId, title: "HTTP 集成" }),
      });
      expect(genRes.status).toBe(202);
      const { episodeId, jobId } = (await genRes.json()) as { episodeId: string; jobId: string; status: string };

      // 列表 / 详情 / 音频（无音频 404）
      const list = await app.request("/v1/episodes", { headers: { Authorization: "Bearer valid-token" } });
      expect(list.status).toBe(200);
      const listJson = (await list.json()) as Array<{ id: string; title: string | null }>;
      expect(listJson).toEqual(expect.arrayContaining([expect.objectContaining({ id: episodeId, title: "HTTP 集成" })]));

      const detail = await app.request(`/v1/episodes/${episodeId}`, { headers: { Authorization: "Bearer valid-token" } });
      expect(detail.status).toBe(200);
      expect((await detail.json()) as { status: string }).toMatchObject({ status: "generating" });

      const audio = await app.request(`/v1/episodes/${episodeId}/audio`, { headers: { Authorization: "Bearer valid-token" } });
      expect(audio.status).toBe(404);

      // job 可查（queued）
      const jobRes = await app.request(`/v1/episodes/${episodeId}/job`, {
        headers: { Authorization: "Bearer valid-token" },
      });
      expect(jobRes.status).toBe(200);
      expect(await jobRes.json()).toMatchObject({ id: jobId, status: "queued", progress: 0, error: null });

      // 发布 → 详情 status published
      const publish = await app.request(`/v1/episodes/${episodeId}/publish`, {
        method: "POST", headers: { Authorization: "Bearer valid-token" },
      });
      expect(publish.status).toBe(200);
      expect(await publish.json()).toEqual({ ok: true });
      const after = await app.request(`/v1/episodes/${episodeId}`, { headers: { Authorization: "Bearer valid-token" } });
      expect((await after.json()) as { status: string }).toMatchObject({ status: "published" });

      // 配额视角：job 尚未 done，generatedCount 仍为 0；free 首期不扣 credit
      const quota = await repo.jobs.getQuotaInfo(API_USER);
      expect(quota.generatedCount).toBe(0);
      expect(quota.creditBalance).toBe(0);
    });

    it("episodes/new rejects missing/unknown transcript", async () => {
      const missing = await app.request("/v1/episodes/new", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token" },
        body: JSON.stringify({}),
      });
      expect(missing.status).toBe(400);

      const unknown = await app.request("/v1/episodes/new", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token" },
        body: JSON.stringify({ transcriptId: "00000000-0000-4000-8000-000000000000" }),
      });
      expect(unknown.status).toBe(404);
    });

    it("GET /api/episodes/:id/job returns 404 when no job", async () => {
      const { episodeId } = await makeEpisode(API_USER, "无 job 集成", "zh");
      const jobRes = await app.request(`/v1/episodes/${episodeId}/job`, {
        headers: { Authorization: "Bearer valid-token" },
      });
      expect(jobRes.status).toBe(404);
      expect(await jobRes.json()).toEqual({ error: "not_found" });
    });

    it("PUT /api/transcripts/:id edits segments with ownership check", async () => {
      const { transcriptId } = await seedChain("脚本编辑集成");
      const res = await app.request(`/v1/transcripts/${transcriptId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token" },
        body: JSON.stringify({ segments: [{ speaker: "host", text: "编辑后" }] }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      const t = await repo.transcripts.getOwned(transcriptId, API_USER);
      expect(t?.segments).toEqual([{ speaker: "host", text: "编辑后" }]);

      // 他人 transcript 不可编辑（IDOR）
      const { transcriptId: theirs } = await makeEpisode(REPO_USER, "他人脚本", "zh");
      const forbidden = await app.request(`/v1/transcripts/${theirs}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token" },
        body: JSON.stringify({ segments: [{ speaker: "host", text: "x" }] }),
      });
      expect(forbidden.status).toBe(404);

      // 非法 segments → 400
      const bad = await app.request(`/v1/transcripts/${transcriptId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token" },
        body: JSON.stringify({ segments: [{ speaker: "robot", text: "x" }] }),
      });
      expect(bad.status).toBe(400);
    });
  });
});
