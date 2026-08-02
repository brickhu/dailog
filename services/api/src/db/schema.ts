import {
  boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  bio: text("bio"),
  plan: text("plan", { enum: ["free", "pro"] }).notNull().default("free"),
  creditBalance: integer("credit_balance").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const voiceSamples = pgTable("voice_samples", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  audioUrl: text("audio_url").notNull(),
  duration: integer("duration").notNull(),
  status: text("status", { enum: ["ready", "failed"] }).notNull().default("ready"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inviteCodes = pgTable("invite_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  createdBy: uuid("created_by").notNull().references(() => profiles.id),
  usedBy: uuid("used_by").references(() => profiles.id),
  usedAt: timestamp("used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  source: text("source", { enum: ["admin", "reward"] }).notNull(),
  issuedForEpisodeId: uuid("issued_for_episode_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const imports = pgTable(
  "imports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["chatgpt", "claude", "kimi", "doubao", "tongyi", "gemini", "deepseek", "plain"] }).notNull(),
    sourceTitle: text("source_title"),
    sourceConversationId: text("source_conversation_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    rawContent: text("raw_content"),
    parsedDialogue: jsonb("parsed_dialogue"),
    status: text("status", { enum: ["parsed", "failed"] }).notNull().default("parsed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("imports_user_platform_conv").on(t.userId, t.platform, t.sourceConversationId)],
);

export const episodes = pgTable("episodes", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  /** 来源导入（imports.parsed_dialogue 是润色/质量门的对话来源） */
  importId: uuid("import_id").references(() => imports.id),
  slug: text("slug").notNull().unique(),
  title: text("title"),
  description: text("description"),
  coverUrl: text("cover_url"),
  audioUrl: text("audio_url"),
  durationSeconds: integer("duration_seconds"),
  status: text("status", { enum: ["draft", "generating", "published", "failed"] }).notNull().default("draft"),
  qualityStatus: text("quality_status", { enum: ["pending", "passed", "rejected"] }).notNull().default("pending"),
  qualityReason: text("quality_reason"),
  language: text("language"),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export const scripts = pgTable("scripts", {
  id: uuid("id").defaultRandom().primaryKey(),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  segments: jsonb("segments").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const generationJobs = pgTable("generation_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["queued", "tts", "merge", "upload", "done", "failed"] }).notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  stripeSessionId: text("stripe_session_id").notNull().unique(),
  amount: integer("amount").notNull(),
  episodesGranted: integer("episodes_granted").notNull(),
  status: text("status", { enum: ["succeeded", "failed"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull(),
  plan: text("plan", { enum: ["pro"] }).notNull(),
  status: text("status", { enum: ["active", "past_due", "canceled"] }).notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
});
