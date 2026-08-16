import { submissionIdFromUrl } from "../src/routes/submissions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { createRepo } from "../src/repo";
import type { Env } from "../src/config/env";
import {
  authUsers, episodes, guestVoiceSamples, notifications, profiles, submissions, voiceSamples,
} from "../src/db/schema";

const hasDb = Boolean(process.env.DATABASE_URL);

// profiles.id 引用 better-auth user.id（text），测试用户 id 用固定值
const REPO_USER = "11111111-1111-4111-8111-111111111111";

function makeEnv(): Env {
  return {
    DATABASE_URL: process.env.DATABASE_URL!,
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost:8787",
    PORT: 8787,
    FISH_API_KEY: "",
    STORAGE_DRIVER: "fs",
    STORAGE_DIR: "./data",
    APP_ORIGINS: "",
    RESEND_API_KEY: "",
    EMAIL_FROM: "dailog <no-reply@dailog.fm>",
    ADMIN_EMAILS: "",
    SITE_BASE_URL: "https://dailog.fm",
  };
}

describe.skipIf(!hasDb)("drizzle repo (integration, local PG)", () => {
  const { db, client } = createDb(makeEnv());
  const repo = createRepo(db);

  beforeAll(async () => {
    const now = new Date();
    await db.insert(authUsers).values([
      { id: REPO_USER, name: "Repo Test", email: "repo-test@test.local", emailVerified: true, createdAt: now, updatedAt: now },
    ]).onConflictDoNothing();
    await db.insert(profiles).values([
      { id: REPO_USER, displayName: "Repo Test", channelActivatedAt: new Date() },
    ]).onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(episodes).where(eq(episodes.userId, REPO_USER)).catch(() => {});
    await db.delete(submissions).where(eq(submissions.userId, REPO_USER)).catch(() => {});
    await client.end().catch(() => {});
  });

  describe("submissions repo（投稿 = URL + 采样，落库待审核）", () => {
    it("create → submitted；同 user+url 重复提交撞唯一约束返回空 id", async () => {
      const url = `https://example.com/share/repo-${Date.now()}`;
      const created = await repo.submissions.create(submissionIdFromUrl(url), REPO_USER, url, "我的对话");
      expect(created.id).toBeTruthy();

      const dup = await repo.submissions.create(submissionIdFromUrl(url), REPO_USER, url, null);
      expect(dup.id).toBe("");

      await db.delete(submissions).where(eq(submissions.id, created.id));
    });

    it("findByUserUrl / countPendingByUser / reject / markPublished 状态流转", async () => {
      const url = `https://claude.ai/share/repo-${Date.now()}`;
      const { id } = await repo.submissions.create(submissionIdFromUrl(url), REPO_USER, url, null);
      expect((await repo.submissions.findByUserUrl(REPO_USER, url))?.status).toBe("submitted");
      expect(await repo.submissions.countPendingByUser(REPO_USER)).toBeGreaterThan(0);

      await repo.submissions.reject(id, "内容不符合要求");
      expect((await repo.submissions.findByUserUrl(REPO_USER, url))?.status).toBe("rejected");

      // 另一条 → published 流转 + 详情聚合投稿人信息
      const url2 = `https://claude.ai/share/repo2-${Date.now()}`;
      const { id: id2 } = await repo.submissions.create(submissionIdFromUrl(url2), REPO_USER, url2, null);
      await repo.submissions.markPublished(id2);
      const detail = await repo.submissions.getDetail(id2);
      expect(detail?.status).toBe("published");
      expect(detail?.userEmail).toBe("repo-test@test.local");

      await db.delete(submissions).where(eq(submissions.id, id));
      await db.delete(submissions).where(eq(submissions.id, id2));
    });

    it("listQueue 附带投稿人信息与采样就绪标记", async () => {
      const url = `https://chatgpt.com/share/repo-${Date.now()}`;
      const { id } = await repo.submissions.create(submissionIdFromUrl(url), REPO_USER, url, null);
      const rows = await repo.submissions.listQueue("submitted");
      const row = rows.find((r) => r.id === id);
      expect(row).toMatchObject({ url, userEmail: "repo-test@test.local", hasVoiceSample: false });
      await db.delete(submissions).where(eq(submissions.id, id));
    });

    it("listByUser 返回 url/status/rejectedReason + 最新节目状态", async () => {
      const { id: subId } = await repo.submissions.create(submissionIdFromUrl(`https://example.com/share/lb-${Date.now()}`), REPO_USER, `https://example.com/share/lb-${Date.now()}`, null);
      await repo.episodes.createPublished({
        submissionId: subId,
        userId: REPO_USER,
        title: "已上线",
        audioUrl: `episodes/${REPO_USER}/${subId}.mp3`,
      });
      const rows = await repo.submissions.listByUser(REPO_USER);
      const row = rows.find((r) => r.id === subId);
      expect(row?.status).toBe("submitted");
      expect(row?.episodeStatus).toBe("published");
      await db.delete(episodes).where(eq(episodes.submissionId, subId));
      await db.delete(submissions).where(eq(submissions.id, subId));
    });
  });

  describe("episodes repo（编辑上传成品 → 发布，期号 max+1）", () => {
    it("createPublished：期号递增 + published + isPublic + 公开音频 key", async () => {
      const { id: subId } = await repo.submissions.create(submissionIdFromUrl(`https://example.com/share/ep-${Date.now()}`), REPO_USER, `https://example.com/share/ep-${Date.now()}`, null);
      const first = await repo.episodes.createPublished({
        submissionId: subId,
        userId: REPO_USER,
        profileId: REPO_USER,
        title: "第一期",
        audioUrl: `episodes/${REPO_USER}/${subId}.mp3`,
        audioSize: 100,
        durationSeconds: 300,
        language: "zh",
        tags: ["AI"],
      });
      expect(first.number).toBeGreaterThan(0);

      const second = await repo.episodes.createPublished({
        submissionId: subId,
        userId: REPO_USER,
        title: "第二期",
        audioUrl: `episodes/${REPO_USER}/${subId}-2.mp3`,
      });
      expect(second.number).toBe(first.number + 1);

      // 公开读：仅 published + isPublic
      const audio = await repo.episodes.getPublicAudioKey(first.id);
      expect(audio?.audioKey).toBe(`episodes/${REPO_USER}/${subId}.mp3`);
      // 投稿下节目列表
      const list = await repo.episodes.listBySubmission(subId);
      expect(list).toHaveLength(2);
      // 编辑端已发布清单
      const published = await repo.episodes.listPublished();
      expect(published.some((e) => e.id === first.id)).toBe(true);

      await db.delete(episodes).where(eq(episodes.submissionId, subId));
      await db.delete(submissions).where(eq(submissions.id, subId));
    });

    it("getPublicAudioKey 对非公开节目返回 null", async () => {
      const { id: subId } = await repo.submissions.create(submissionIdFromUrl(`https://example.com/share/hidden-${Date.now()}`), REPO_USER, `https://example.com/share/hidden-${Date.now()}`, null);
      const { id: epId } = await repo.episodes.createPublished({
        submissionId: subId,
        userId: REPO_USER,
        title: "隐藏",
        audioUrl: `episodes/${REPO_USER}/${subId}.mp3`,
      });
      await db.update(episodes).set({ isPublic: false }).where(eq(episodes.id, epId));
      expect(await repo.episodes.getPublicAudioKey(epId)).toBeNull();
      await db.delete(episodes).where(eq(episodes.id, epId));
      await db.delete(submissions).where(eq(submissions.id, subId));
    });
  });

  describe("guests repo（品牌声线宿主）", () => {
    it("list + voiceSampleByLanguage + upsert（guest×language 唯一）", async () => {
      // guests 是固定平台表（id = platform 枚举）；复用 claude 做采样 upsert，测试后清理采样行
      await repo.guests.upsertVoiceSample({ guestId: "claude", language: "zz", audioKey: "guests/claude/zz.mp3", referenceId: "ref-zz", transcript: "你好" });
      const sample = await repo.guests.voiceSampleByLanguage("claude", "zz");
      expect(sample?.referenceId).toBe("ref-zz");
      expect((await repo.guests.list()).some((g) => g.id === "claude")).toBe(true);
      await db.delete(guestVoiceSamples).where(and(eq(guestVoiceSamples.guestId, "claude"), eq(guestVoiceSamples.language, "zz")));
    });
  });

  describe("profile 档案 + voice sample", () => {
    it("updateChannel（档案字段）读写 + personaSnapshot 快照", async () => {
      await repo.episodes.updateChannel(REPO_USER, { displayName: "小北", gender: "男", profession: "产品经理", nationality: "中国", socialLinks: { github: "fei" } });
      const profile = await repo.episodes.getProfile(REPO_USER);
      expect(profile?.displayName).toBe("小北");
      expect(profile?.gender).toBe("男");
      expect(profile?.nationality).toBe("中国");
      expect(profile?.socialLinks?.github).toBe("fei");
      const snap = await repo.episodes.getPersonaSnapshot(REPO_USER);
      expect(snap?.displayName).toBe("小北");
      expect(snap?.profession).toBe("产品经理");
    });

    it("saveVoiceSample + getVoiceSample（user×language upsert）", async () => {
      await repo.episodes.saveVoiceSample({
        userId: REPO_USER, language: "zh", audioUrl: "voices/repo/zh.webm", transcript: "大家好", duration: 10, status: "ready",
      });
      const sample = await repo.episodes.getVoiceSample(REPO_USER);
      expect(sample?.audioUrl).toBe("voices/repo/zh.webm");
      expect(sample?.transcript).toBe("大家好");
      await db.delete(voiceSamples).where(eq(voiceSamples.userId, REPO_USER));
    });
  });

  describe("notifications repo", () => {
    it("create/list/unread/markAllRead", async () => {
      await repo.notifications.create({ userId: REPO_USER, type: "rejected", title: "投稿未通过", body: "原因", link: "/me/submits" });
      const list = await repo.notifications.listByUser(REPO_USER);
      expect(list.some((n) => n.type === "rejected" && n.title === "投稿未通过")).toBe(true);
      expect(await repo.notifications.unreadCount(REPO_USER)).toBeGreaterThan(0);
      await repo.notifications.markAllRead(REPO_USER);
      expect(await repo.notifications.unreadCount(REPO_USER)).toBe(0);
      await db.delete(notifications).where(eq(notifications.userId, REPO_USER));
    });
  });
});
